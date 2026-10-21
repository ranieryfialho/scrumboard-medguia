// T-122 (fase3-etl-lp, US-082/US-083/US-084): grava cada cadastro da LP
// (T-121) como lead + card do pipeline, com o mesmo contrato de
// idempotência de `comum.ts` (`buscarIdDestino`/`registrarMigracao`,
// entidade `lead`, `contexto.origem = 'supabase-lp'`).
//
// Status (AC-295) reaproveita `mapearStatusParaEtapa` do ETL do Sheets —
// a LP não tem coluna de "próxima ação", então `dataProximaAcao` nunca é
// passada, e "Recontato"/"Aguardando Ativação" sempre caem em revisão,
// igual ao Sheets hoje (Q-031).
//
// Telefone (AC-296) reaproveita `normalizarTelefone` do Sheets: válido vira
// E.164 (+55 implícito); inválido não bloqueia a criação do lead (ele migra
// sem telefone), só marca o cadastro em `revisao` para o relatório apontar
// — por isso esse item NUNCA soma em `emRevisao` (o lead já foi criado).
//
// Dedupe (AC-300, ASM-096): antes de criar, procura um lead já existente na
// mesma empresa com o mesmo e-mail (sem diferenciar maiúsculas) ou o mesmo
// telefone E.164. Achando, nada é criado nem alterado — o cadastro só entra
// em revisão com o id do lead existente.
//
// Decisões (AC-301): `decisoes[idLp]` resolve, numa execução seguinte, um
// item que ficou bloqueado em revisão (status desconhecido/sem data, ou
// pessoa já existente) — `{ etapaId }` cria o lead/card nessa etapa;
// `{ ignorar: true }` registra o cadastro como `lead_ignorado` em
// `migracao_registros` (com um id de destino só de controle, sem FK) para
// ele sair da fila e uma terceira execução não repetir a revisão.
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../db/schema';
import type { CadastroLpBruto } from './origem';
import { normalizarData, normalizarTelefone } from '../sheets/normalizar';
import { mapearStatusParaEtapa } from '../sheets/status';

export const ENTIDADE_LEAD = 'lead';
export const ENTIDADE_LEAD_IGNORADO = 'lead_ignorado';

/** Origem comercial fixa dos cadastros da LP (AC-294) — mesmo rótulo do legado (`src/app/api/sheets/route.ts`). */
export const ORIGEM_COMERCIAL_LP = 'LP - Aula';

/** Origem usada no evento `migrado_de` (AC-297) — não é `contexto.origem`, que identifica a execução em `migracao_registros`. */
export const ORIGEM_EVENTO_MIGRACAO = 'supabase-lp';

/** Decisão da operação para um cadastro bloqueado na fila de revisão (AC-301). */
export type DecisaoLp = { etapaId: number } | { ignorar: true };

/** `idLp -> decisão`, montado pelo orquestrador (T-123) a partir do arquivo de decisões. */
export type DecisoesLp = Record<string, DecisaoLp>;

export type TipoItemRevisaoLp = 'status_em_revisao' | 'telefone_invalido' | 'pessoa_existente';

export interface ItemRevisaoLp {
  idLp: string;
  tipo: TipoItemRevisaoLp;
  motivo: string;
  /** Só para `pessoa_existente` (AC-300) — id do lead já existente na empresa. */
  leadExistenteId?: string;
}

export interface ResultadoImportacaoLeadsLp {
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  revisao: ItemRevisaoLp[];
}

/** Dados do cadastro preservados no lead (AC-294, AC-298) — nunca `password_hash`. */
export interface DadosCadastroLead {
  crm?: string;
  especialidade?: string;
  anuncio?: string;
  observacoes?: string;
  termosAceitos?: boolean;
  progressoVideo?: number;
  dataCadastro?: string;
  dataAlteracao?: string;
  dataFechamento?: string;
}

function textoOuUndefined(valor: string | null | undefined): string | undefined {
  return valor && valor.trim() ? valor : undefined;
}

/**
 * Monta os dados do cadastro a guardar no lead (AC-294: nome/e-mail ficam em
 * colunas próprias, o resto vai aqui; AC-298: CRM, especialidade, anúncio,
 * aceite dos termos e progresso do vídeo, com as datas já normalizadas para
 * o instante UTC — nunca a string bruta da LP).
 */
export function extrairDadosCadastro(cadastro: CadastroLpBruto): DadosCadastroLead {
  return {
    crm: textoOuUndefined(cadastro.crm),
    especialidade: textoOuUndefined(cadastro.especialidade),
    anuncio: textoOuUndefined(cadastro.anuncio),
    observacoes: textoOuUndefined(cadastro.observacoes),
    termosAceitos: cadastro.termos_aceitos ?? undefined,
    progressoVideo: cadastro.progresso_video ?? undefined,
    dataCadastro: normalizarData(cadastro.created_at),
    dataAlteracao: normalizarData(cadastro.data_alteracao),
    dataFechamento: normalizarData(cadastro.data_fechamento),
  };
}

function dadosSemVazios(dados: DadosCadastroLead): Record<string, string | boolean | number> | null {
  const entradas = Object.entries(dados).filter(
    (par): par is [string, string | boolean | number] => par[1] !== undefined && par[1] !== ''
  );
  if (entradas.length === 0) return null;
  return Object.fromEntries(entradas);
}

/**
 * Procura um lead já existente na empresa com o mesmo e-mail (sem
 * diferenciar maiúsculas) ou o mesmo telefone E.164 (AC-300). Sem e-mail e
 * sem telefone válidos, não há como comparar — devolve `undefined` sem
 * consultar o banco.
 */
async function buscarLeadExistente(
  tx: TransacaoEtl,
  empresaId: string,
  email: string | null,
  telefoneE164: string | null
): Promise<string | undefined> {
  const condicoes: SQL[] = [];
  if (email) condicoes.push(sql`lower(${leads.email}) = lower(${email})`);
  if (telefoneE164) condicoes.push(eq(leads.telefoneE164, telefoneE164));
  if (condicoes.length === 0) return undefined;

  const [existente] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.empresaId, empresaId), or(...condicoes)));
  return existente?.id;
}

async function obterOuCriarMotivoPerda(tx: TransacaoEtl, nome: string): Promise<string> {
  const [existente] = await tx.select({ id: motivosPerda.id }).from(motivosPerda).where(eq(motivosPerda.nome, nome));
  if (existente) return existente.id;

  const [criado] = await tx
    .insert(motivosPerda)
    .values({ nome, ativo: true, eSistemico: true })
    .returning({ id: motivosPerda.id });
  return criado.id;
}

interface CriacaoLead {
  cadastro: CadastroLpBruto;
  idLp: string;
  etapaId: number;
  motivoPerdaNome?: string;
}

/** Cria lead + card + evento `migrado_de` e registra a migração (AC-294, AC-297, AC-298). */
async function criarLeadECard(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  criacao: CriacaoLead
): Promise<void> {
  const { cadastro, idLp, etapaId, motivoPerdaNome } = criacao;

  const telefoneE164 = normalizarTelefone(cadastro.whatsapp) ?? null;
  const dados = dadosSemVazios(extrairDadosCadastro(cadastro));

  const [novoLead] = await tx
    .insert(leads)
    .values({
      empresaId,
      nome: cadastro.name ?? '',
      email: cadastro.email || null,
      origem: ORIGEM_COMERCIAL_LP,
      telefoneE164,
      idExterno: idLp,
      dados,
    })
    .returning();

  let motivoPerdaId: string | undefined;
  if (motivoPerdaNome) {
    motivoPerdaId = await obterOuCriarMotivoPerda(tx, motivoPerdaNome);
  }

  const [novaOportunidade] = await tx
    .insert(oportunidades)
    .values({
      empresaId,
      leadId: novoLead.id,
      etapaId,
      motivoPerdaId: motivoPerdaId ?? null,
    })
    .returning();

  await tx.insert(oportunidadeEventos).values({
    empresaId,
    oportunidadeId: novaOportunidade.id,
    tipo: 'migrado_de',
    atorTipo: 'migracao',
    payload: { origem: ORIGEM_EVENTO_MIGRACAO, idExterno: idLp },
  });

  await registrarMigracao(tx, contexto, {
    entidade: ENTIDADE_LEAD,
    idExterno: idLp,
    idDestino: novoLead.id,
  });
}

/** Registra o cadastro como ignorado (AC-301) — sem FK, só para sair da fila de revisão. */
async function registrarIgnorado(tx: TransacaoEtl, contexto: ContextoExecucao, idLp: string): Promise<void> {
  await registrarMigracao(tx, contexto, {
    entidade: ENTIDADE_LEAD_IGNORADO,
    idExterno: idLp,
    idDestino: randomUUID(),
  });
}

/**
 * Importa os cadastros da LP como lead + card (US-082, US-083, US-084).
 * Idempotente via `migracao_registros` (origem `contexto.origem`, qualquer
 * entidade): um `idLp` já registrado — migrado ou ignorado — é só contado
 * como ignorado, nunca duplicado (AC-301, AC-302).
 */
export async function importarLeadsLp(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  decisoes: DecisoesLp = {}
): Promise<ResultadoImportacaoLeadsLp> {
  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  const revisao: ItemRevisaoLp[] = [];

  for (const cadastro of cadastros) {
    const idLp = String(cadastro.id);

    const existente = await buscarIdDestino(tx, contexto.origem, idLp);
    if (existente) {
      ignoradas++;
      continue;
    }

    const decisao = decisoes[idLp];
    if (decisao) {
      if ('ignorar' in decisao) {
        await registrarIgnorado(tx, contexto, idLp);
        ignoradas++;
      } else {
        await criarLeadECard(tx, contexto, empresaId, { cadastro, idLp, etapaId: decisao.etapaId });
        criadas++;
      }
      continue;
    }

    const telefoneE164Dedupe = normalizarTelefone(cadastro.whatsapp) ?? null;
    const emailDedupe = textoOuUndefined(cadastro.email) ?? null;
    const leadExistenteId = await buscarLeadExistente(tx, empresaId, emailDedupe, telefoneE164Dedupe);
    if (leadExistenteId) {
      emRevisao++;
      revisao.push({
        idLp,
        tipo: 'pessoa_existente',
        motivo: `já existe um lead com o mesmo e-mail ou telefone: ${leadExistenteId}`,
        leadExistenteId,
      });
      continue;
    }

    const decisaoStatus = mapearStatusParaEtapa(cadastro.status ?? '', {
      dataFechamento: cadastro.data_fechamento ?? undefined,
    });

    if (decisaoStatus.tipo === 'revisao') {
      emRevisao++;
      revisao.push({ idLp, tipo: 'status_em_revisao', motivo: decisaoStatus.motivo });
      continue;
    }

    if (cadastro.whatsapp && !normalizarTelefone(cadastro.whatsapp)) {
      revisao.push({
        idLp,
        tipo: 'telefone_invalido',
        motivo: `WhatsApp não vira telefone válido: "${cadastro.whatsapp}"`,
      });
    }

    await criarLeadECard(tx, contexto, empresaId, {
      cadastro,
      idLp,
      etapaId: decisaoStatus.etapaId,
      motivoPerdaNome: decisaoStatus.motivoPerdaNome,
    });
    criadas++;
  }

  return { lidas: cadastros.length, criadas, ignoradas, emRevisao, revisao };
}
