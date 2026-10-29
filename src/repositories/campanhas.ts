// T-104 (fase2d-campanhas, US-064/US-065/US-066): repositório de campanhas e
// envios. Mesmas regras das demais: tudo passa por `comTenant` (T-040), toda
// query filtra explicitamente por `empresa_id = contexto.empresaId` além do
// RLS (0001), e o CRM nunca grava `ENVIADO`/`ERRO` num destinatário — esse
// contrato é só do motor em Python externo (ASM-075); aqui o máximo que se
// grava é `PENDENTE` (liberar a fila) ou `FINALIZADA`/`PROCESSANDO` na
// campanha.
//
// `normalizarDestinatarios` é a função pura (AC-236) usada tanto pela
// origem "planilha" quanto pela origem "etapa" (ASM-078: join
// oportunidades→leads da etapa escolhida, só leads com e-mail) — trim +
// lowercase + validação de formato + dedup por e-mail, descartando e
// contando os dois jeitos de rejeição separadamente.
//
// `iniciarCampanha` (AC-239/AC-240) faz a transição de status com um UPDATE
// condicional (`WHERE status = 'RASCUNHO'`) na própria campanha ANTES de
// liberar os destinatários — o mesmo truque de lock otimista de
// `moverOportunidade`/`iniciarCadencia`: só uma de duas chamadas
// concorrentes (dois cliques no Play) encontra a linha em RASCUNHO e
// consegue gravar; a outra lê zero linhas afetadas e recebe
// `ErroCampanhaJaIniciada` sem nada ser alterado (a transação inteira é
// desfeita quando qualquer uma das duas etapas lança erro).
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { campanhas, enviosCampanha, leads, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { emailsDescadastrados } from './email-descadastros';

export type Campanha = typeof campanhas.$inferSelect;
export type EnvioCampanha = typeof enviosCampanha.$inferSelect;

/** AC-244: a campanha pedida não existe no tenant do `contexto` — nem em outro tenant, nem em lugar nenhum. */
export class ErroCampanhaNaoEncontrada extends Error {
  constructor() {
    super('Campanha não encontrada.');
    this.name = 'ErroCampanhaNaoEncontrada';
  }
}

/** AC-240: não há nenhum destinatário em RASCUNHO para liberar — nada foi alterado. */
export class ErroSemDestinatarios extends Error {
  constructor() {
    super('A campanha não tem destinatários para iniciar o envio.');
    this.name = 'ErroSemDestinatarios';
  }
}

/** AC-240: a campanha já está PROCESSANDO ou FINALIZADA — nada foi alterado. */
export class ErroCampanhaJaIniciada extends Error {
  constructor() {
    super('A campanha já foi iniciada.');
    this.name = 'ErroCampanhaJaIniciada';
  }
}

/** AC-241: não há nenhum destinatário em ERRO para reenviar — nada foi alterado. */
export class ErroSemFalhas extends Error {
  constructor() {
    super('A campanha não tem falhas para reenviar.');
    this.name = 'ErroSemFalhas';
  }
}

/** AC-245: campanha PROCESSANDO não pode ser excluída. */
export class ErroCampanhaEmEnvio extends Error {
  constructor() {
    super('Uma campanha em envio não pode ser excluída.');
    this.name = 'ErroCampanhaEmEnvio';
  }
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContatoBruto {
  nome: string;
  email: string;
}

export interface Destinatario {
  nome: string;
  email: string;
}

export interface ResultadoNormalizacao {
  destinatarios: Destinatario[];
  /** AC-236: e-mails mal formados descartados. */
  descartadosInvalidos: number;
  /** AC-236: e-mails repetidos (sem diferenciar maiúsculas) descartados — só o primeiro de cada um vira destinatário. */
  descartadosRepetidos: number;
}

/**
 * Função pura (AC-236): `nome` e `email` sempre trimados, `email` sempre em
 * minúsculas (é também a chave de deduplicação — "sem diferenciar
 * maiúsculas"). E-mail que não bate no formato básico `algo@algo.algo` é
 * descartado como inválido antes mesmo de entrar na deduplicação; entre
 * repetidos, só o primeiro da lista original vira destinatário.
 */
export function normalizarDestinatarios(contatos: ContatoBruto[]): ResultadoNormalizacao {
  const vistos = new Set<string>();
  const destinatarios: Destinatario[] = [];
  let descartadosInvalidos = 0;
  let descartadosRepetidos = 0;

  for (const contato of contatos) {
    const email = contato.email.trim().toLowerCase();
    if (!REGEX_EMAIL.test(email)) {
      descartadosInvalidos += 1;
      continue;
    }
    if (vistos.has(email)) {
      descartadosRepetidos += 1;
      continue;
    }
    vistos.add(email);
    destinatarios.push({ nome: contato.nome.trim(), email });
  }

  return { destinatarios, descartadosInvalidos, descartadosRepetidos };
}

/** AC-234: destinatários vindos de uma planilha lida no navegador (ASM-077) — a rota não recebe arquivo, só a lista já extraída. */
export interface OrigemPlanilha {
  tipo: 'planilha';
  contatos: ContatoBruto[];
}

/** AC-235: destinatários vindos dos cards de uma etapa do pipeline (ASM-078) — só os leads com e-mail. */
export interface OrigemEtapa {
  tipo: 'etapa';
  etapaId: number;
}

/** AC-541: destinatários dos cards de várias etapas do pipeline, sem repetir e-mail. */
export interface OrigemEtapas {
  tipo: 'etapas';
  etapaIds: number[];
}

export type OrigemDestinatarios = OrigemPlanilha | OrigemEtapa | OrigemEtapas;

export interface DadosNovaCampanha {
  nome: string;
  assunto: string;
  corpoHtml: string;
  criadoPor?: string | null;
  origem: OrigemDestinatarios;
}

export interface ResultadoCriarCampanha {
  campanha: Campanha;
  totalDestinatarios: number;
  descartadosInvalidos: number;
  descartadosRepetidos: number;
  /** fase5-email-descadastro (AC-718): destinatários que a empresa já descadastrou, deixados de fora. */
  descartadosDescadastrados: number;
}

/**
 * Cria a campanha em RASCUNHO com um destinatário RASCUNHO por contato
 * válido (AC-234/AC-235), numa única transação. Com origem "etapa", só
 * entram os leads do tenant do `contexto` que estão na etapa escolhida e
 * têm e-mail — cards de outra etapa ou de outra empresa nunca chegam a ser
 * lidos (filtro explícito, além do RLS).
 */
export async function criarCampanha(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: DadosNovaCampanha
): Promise<ResultadoCriarCampanha> {
  return comTenant(db, contexto, async (tx) => {
    let contatosBrutos: ContatoBruto[];

    if (dados.origem.tipo === 'planilha') {
      contatosBrutos = dados.origem.contatos;
    } else {
      const linhas = await tx
        .select({ nome: leads.nome, email: leads.email })
        .from(oportunidades)
        .innerJoin(leads, eq(oportunidades.leadId, leads.id))
        .where(
          and(
            eq(oportunidades.empresaId, contexto.empresaId),
            eq(leads.empresaId, contexto.empresaId),
            dados.origem.tipo === 'etapas'
              ? inArray(oportunidades.etapaId, dados.origem.etapaIds)
              : eq(oportunidades.etapaId, dados.origem.etapaId),
            isNotNull(leads.email)
          )
        );
      contatosBrutos = linhas
        .filter((linha) => linha.email !== null && linha.email.trim() !== '')
        .map((linha) => ({ nome: linha.nome, email: linha.email as string }));
    }

    const normalizados = normalizarDestinatarios(contatosBrutos);
    const { descartadosInvalidos, descartadosRepetidos } = normalizados;
    // AC-718: quem a empresa descadastrou nunca vira destinatário.
    const fora = await emailsDescadastrados(tx, contexto.empresaId, normalizados.destinatarios.map((d) => d.email));
    const destinatarios = normalizados.destinatarios.filter((d) => !fora.has(d.email));
    const descartadosDescadastrados = normalizados.destinatarios.length - destinatarios.length;

    const [campanha] = await tx
      .insert(campanhas)
      .values({
        empresaId: contexto.empresaId,
        nome: dados.nome,
        assunto: dados.assunto,
        corpoHtml: dados.corpoHtml,
        criadoPor: dados.criadoPor ?? null,
      })
      .returning();

    if (destinatarios.length > 0) {
      await tx.insert(enviosCampanha).values(
        destinatarios.map((destinatario) => ({
          empresaId: contexto.empresaId,
          campanhaId: campanha.id,
          nomeDestinatario: destinatario.nome,
          emailDestinatario: destinatario.email,
        }))
      );
    }

    return {
      campanha,
      totalDestinatarios: destinatarios.length,
      descartadosInvalidos,
      descartadosRepetidos,
      descartadosDescadastrados,
    };
  });
}

export interface ResumoCampanha {
  campanha: Campanha;
  totalDestinatarios: number;
}

/** AC-243: campanhas do tenant do `contexto`, da mais nova para a mais antiga, com o total de destinatários de cada uma. */
export async function listarCampanhas(db: NodePgDatabase, contexto: ContextoTenant): Promise<ResumoCampanha[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhasCampanhas = await tx
      .select()
      .from(campanhas)
      .where(eq(campanhas.empresaId, contexto.empresaId))
      .orderBy(desc(campanhas.criadoEm), desc(campanhas.id));

    if (linhasCampanhas.length === 0) return [];

    const contagens = await tx
      .select({ campanhaId: enviosCampanha.campanhaId, total: sql<number>`count(*)::int` })
      .from(enviosCampanha)
      .where(
        and(
          eq(enviosCampanha.empresaId, contexto.empresaId),
          inArray(
            enviosCampanha.campanhaId,
            linhasCampanhas.map((campanha) => campanha.id)
          )
        )
      )
      .groupBy(enviosCampanha.campanhaId);

    const totalPorCampanhaId = new Map(contagens.map((linha) => [linha.campanhaId, linha.total]));

    return linhasCampanhas.map((campanha) => ({
      campanha,
      totalDestinatarios: totalPorCampanhaId.get(campanha.id) ?? 0,
    }));
  });
}

export interface DetalheCampanha {
  campanha: Campanha;
  destinatarios: EnvioCampanha[];
  /** AC-244: contagem por `status` dos destinatários (PENDENTE, ENVIADO, ABERTO, CLICADO, ERRO, ...). */
  contagemPorStatus: Record<string, number>;
}

/**
 * Detalhe de uma campanha (AC-244): destinatários ordenados por nome e a
 * contagem por status. Antes de ler, se a campanha está PROCESSANDO e não
 * sobrou nenhum destinatário PENDENTE/RASCUNHO, finaliza no servidor
 * (AC-242/ASM-080) — sem job agendado, só na própria consulta do detalhe.
 * 404 (`ErroCampanhaNaoEncontrada`) para campanha de outra empresa ou
 * inexistente.
 */
export async function buscarDetalheCampanha(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  campanhaId: string
): Promise<DetalheCampanha> {
  return comTenant(db, contexto, async (tx) => {
    const [campanha] = await tx
      .select()
      .from(campanhas)
      .where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)))
      .limit(1);
    if (!campanha) throw new ErroCampanhaNaoEncontrada();

    let campanhaAtual = campanha;

    if (campanha.status === 'PROCESSANDO') {
      const filaRestante = await tx
        .select({ id: enviosCampanha.id })
        .from(enviosCampanha)
        .where(
          and(
            eq(enviosCampanha.campanhaId, campanhaId),
            eq(enviosCampanha.empresaId, contexto.empresaId),
            inArray(enviosCampanha.status, ['PENDENTE', 'RASCUNHO'])
          )
        )
        .limit(1);

      if (filaRestante.length === 0) {
        const [finalizada] = await tx
          .update(campanhas)
          .set({ status: 'FINALIZADA' })
          .where(
            and(
              eq(campanhas.id, campanhaId),
              eq(campanhas.empresaId, contexto.empresaId),
              eq(campanhas.status, 'PROCESSANDO')
            )
          )
          .returning();
        if (finalizada) campanhaAtual = finalizada;
      }
    }

    const destinatarios = await tx
      .select()
      .from(enviosCampanha)
      .where(and(eq(enviosCampanha.campanhaId, campanhaId), eq(enviosCampanha.empresaId, contexto.empresaId)))
      .orderBy(asc(enviosCampanha.nomeDestinatario));

    const contagemPorStatus: Record<string, number> = {};
    for (const destinatario of destinatarios) {
      contagemPorStatus[destinatario.status] = (contagemPorStatus[destinatario.status] ?? 0) + 1;
    }

    return { campanha: campanhaAtual, destinatarios, contagemPorStatus };
  });
}

export interface ResultadoIniciarCampanha {
  campanha: Campanha;
  totalLiberados: number;
}

/**
 * Play (AC-239): dentro de uma única transação, tenta mover a campanha de
 * RASCUNHO para PROCESSANDO com um UPDATE condicional (`WHERE status =
 * 'RASCUNHO'`) — o lock de linha do Postgres garante que, entre dois
 * cliques simultâneos, só um vê a linha ainda em RASCUNHO (AC-240). Sem
 * linha afetada, distingue campanha inexistente (`ErroCampanhaNaoEncontrada`)
 * de campanha já iniciada (`ErroCampanhaJaIniciada`). Só então libera os
 * destinatários RASCUNHO para PENDENTE; sem nenhum destinatário RASCUNHO
 * (`ErroSemDestinatarios`), a função lança e a transação inteira — inclusive
 * a mudança de status da campanha — é desfeita.
 */
export async function iniciarCampanha(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  campanhaId: string
): Promise<ResultadoIniciarCampanha> {
  return comTenant(db, contexto, async (tx) => {
    const [campanhaAtualizada] = await tx
      .update(campanhas)
      .set({ status: 'PROCESSANDO' })
      .where(
        and(
          eq(campanhas.id, campanhaId),
          eq(campanhas.empresaId, contexto.empresaId),
          eq(campanhas.status, 'RASCUNHO')
        )
      )
      .returning();

    if (!campanhaAtualizada) {
      const [existente] = await tx
        .select({ id: campanhas.id })
        .from(campanhas)
        .where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)))
        .limit(1);
      if (!existente) throw new ErroCampanhaNaoEncontrada();
      throw new ErroCampanhaJaIniciada();
    }

    const liberados = await tx
      .update(enviosCampanha)
      .set({ status: 'PENDENTE' })
      .where(
        and(
          eq(enviosCampanha.campanhaId, campanhaId),
          eq(enviosCampanha.empresaId, contexto.empresaId),
          eq(enviosCampanha.status, 'RASCUNHO')
        )
      )
      .returning({ id: enviosCampanha.id });

    if (liberados.length === 0) {
      throw new ErroSemDestinatarios();
    }

    return { campanha: campanhaAtualizada, totalLiberados: liberados.length };
  });
}

export interface ResultadoReenviarFalhas {
  campanha: Campanha;
  totalReenviados: number;
}

/**
 * Reenviar falhas (AC-241): só os destinatários ERRO voltam a PENDENTE, e a
 * campanha volta a PROCESSANDO — mesma transação. Sem nenhum ERRO
 * (`ErroSemFalhas`), nada é alterado.
 */
export async function reenviarFalhas(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  campanhaId: string
): Promise<ResultadoReenviarFalhas> {
  return comTenant(db, contexto, async (tx) => {
    const [campanha] = await tx
      .select({ id: campanhas.id })
      .from(campanhas)
      .where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)))
      .limit(1);
    if (!campanha) throw new ErroCampanhaNaoEncontrada();

    const reenviados = await tx
      .update(enviosCampanha)
      .set({ status: 'PENDENTE' })
      .where(
        and(
          eq(enviosCampanha.campanhaId, campanhaId),
          eq(enviosCampanha.empresaId, contexto.empresaId),
          eq(enviosCampanha.status, 'ERRO')
        )
      )
      .returning({ id: enviosCampanha.id });

    if (reenviados.length === 0) {
      throw new ErroSemFalhas();
    }

    const [campanhaAtualizada] = await tx
      .update(campanhas)
      .set({ status: 'PROCESSANDO' })
      .where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)))
      .returning();

    return { campanha: campanhaAtualizada, totalReenviados: reenviados.length };
  });
}

/**
 * Exclui a campanha e todos os seus destinatários (AC-245) — o `ON DELETE
 * CASCADE` de `envios_campanha.campanha_id` (schema) cuida da segunda parte
 * sozinho. Campanha PROCESSANDO não pode ser excluída (`ErroCampanhaEmEnvio`).
 */
export async function excluirCampanha(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  campanhaId: string
): Promise<void> {
  return comTenant(db, contexto, async (tx) => {
    const [campanha] = await tx
      .select()
      .from(campanhas)
      .where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)))
      .limit(1);
    if (!campanha) throw new ErroCampanhaNaoEncontrada();
    if (campanha.status === 'PROCESSANDO') throw new ErroCampanhaEmEnvio();

    await tx.delete(campanhas).where(and(eq(campanhas.id, campanhaId), eq(campanhas.empresaId, contexto.empresaId)));
  });
}
