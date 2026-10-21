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
// Decisões (AC-301): `decisoes[idLp]` (formato simples, mantido por
// compatibilidade) resolve, numa execução seguinte, um item que ficou
// bloqueado em revisão (status desconhecido/sem data, ou pessoa já
// existente) — `{ etapaId }` cria o lead/card nessa etapa; `{ ignorar: true
// }` registra o cadastro como `lead_ignorado` em `migracao_registros` (com
// um id de destino só de controle, sem FK) para ele sair da fila e uma
// terceira execução não repetir a revisão.
//
// T-126 (fase3-etl-decisoes, US-089): um cadastro cujo status cai em
// revisão (AC-295) também pode ser resolvido pela planilha de decisões
// comum (T-124, `decisoesValidadas`, casada por `idLp`) — quem valida é o
// orquestrador (T-123), que tem a tabela `etapas`, os motivos de perda e o
// instante da execução. `etapa` cria o lead/card com `proximaAcaoEm`/
// `valor`/`motivoPerdaId` da decisão (AC-316); `ignorar` registra
// `lead_ignorado` sem criar nada; `recusada` mantém o cadastro em revisão
// com o motivo (mesma regra do Sheets, US-088).
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import type { ResultadoValidacao } from '../decisoes';
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

/** `decisao_recusada` (T-126): a planilha de decisões trazia algo para este `idLp`, mas `validarDecisao` recusou — volta para a revisão com o motivo, sem abortar a execução. */
export type TipoItemRevisaoLp = 'status_em_revisao' | 'telefone_invalido' | 'pessoa_existente' | 'decisao_recusada';

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
  /** Decisões de etapa aplicadas nesta execução (AC-317). */
  decisoesAplicadas: number;
  /** Decisões "ignorar" aplicadas nesta execução (AC-317). */
  decisoesIgnoradas: number;
  /** Decisões que `validarDecisao` recusou nesta execução (AC-317). */
  decisoesRecusadas: number;
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
  /** Já resolvido (T-126, decisão da planilha) — tem prioridade sobre `motivoPerdaNome`. */
  motivoPerdaId?: string;
  proximaAcaoEm?: Date;
  valor?: number;
}

/** Cria lead + card + evento `migrado_de` e registra a migração (AC-294, AC-297, AC-298). */
async function criarLeadECard(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  criacao: CriacaoLead
): Promise<void> {
  const { cadastro, idLp, etapaId, motivoPerdaNome, proximaAcaoEm, valor } = criacao;

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

  let motivoPerdaId = criacao.motivoPerdaId;
  if (!motivoPerdaId && motivoPerdaNome) {
    motivoPerdaId = await obterOuCriarMotivoPerda(tx, motivoPerdaNome);
  }

  const [novaOportunidade] = await tx
    .insert(oportunidades)
    .values({
      empresaId,
      leadId: novoLead.id,
      etapaId,
      motivoPerdaId: motivoPerdaId ?? null,
      proximaAcaoEm: proximaAcaoEm ?? null,
      valor: valor !== undefined ? String(valor) : null,
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
 *
 * `decisoesValidadas` (T-126, US-089) traz, por `idLp`, o resultado já
 * validado (`validarDecisao`, T-124) da planilha de decisões para os
 * cadastros que o mapa de status colocaria em revisão — quem casa a linha
 * da planilha com o cadastro e roda a validação é o orquestrador (T-123).
 * `etapa` cria o lead/card com `proximaAcaoEm`/`valor`/`motivoPerdaId` da
 * decisão (AC-316); `ignorar` registra `lead_ignorado` e não cria nada;
 * `recusada` mantém o cadastro em revisão com o motivo (AC-312 a AC-314).
 */
export async function importarLeadsLp(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  decisoes: DecisoesLp = {},
  decisoesValidadas: Map<string, ResultadoValidacao> = new Map()
): Promise<ResultadoImportacaoLeadsLp> {
  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  let decisoesAplicadas = 0;
  let decisoesIgnoradas = 0;
  let decisoesRecusadas = 0;
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
      const decisaoValidada = decisoesValidadas.get(idLp);
      if (decisaoValidada) {
        if (decisaoValidada.tipo === 'ignorar') {
          await registrarIgnorado(tx, contexto, idLp);
          ignoradas++;
          decisoesIgnoradas++;
          continue;
        }
        if (decisaoValidada.tipo === 'recusada') {
          emRevisao++;
          decisoesRecusadas++;
          revisao.push({ idLp, tipo: 'decisao_recusada', motivo: decisaoValidada.motivo });
          continue;
        }
        await criarLeadECard(tx, contexto, empresaId, {
          cadastro,
          idLp,
          etapaId: decisaoValidada.etapaId,
          motivoPerdaId: decisaoValidada.motivoPerdaId,
          proximaAcaoEm: decisaoValidada.proximaAcaoEm,
          valor: decisaoValidada.valor,
        });
        criadas++;
        decisoesAplicadas++;
        continue;
      }

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

  return {
    lidas: cadastros.length,
    criadas,
    ignoradas,
    emRevisao,
    revisao,
    decisoesAplicadas,
    decisoesIgnoradas,
    decisoesRecusadas,
  };
}
