// T-042 (fase1-repositorios-isolamento, US-026/US-027/US-028): repositório
// de oportunidades. Mesmas regras de leads.ts: tudo passa por `comTenant`
// (T-040), toda query filtra explicitamente por
// `empresa_id = contexto.empresaId` além do RLS, e `atualizarOportunidade`
// nunca finge sucesso quando o id pertence a outro tenant (AC-070) — reporta
// zero linhas afetadas.
//
// T-045 (fase2-kanban, US-031) acrescenta `moverOportunidade`: único ponto
// deste repositório que chama a função SQL `mover_oportunidade` (0006,
// estendida por T-043). Quem decide SE a transição é permitida é o domínio
// (`validarTransicao`, fase1-dominio-pipeline) — chamado pela rota (T-047)
// ANTES deste repositório. Este repositório só grava o que já foi validado
// e traduz o conflito de lock otimista do Postgres (`ERRCODE = 'P0001'`) num
// erro tipado; o código HTTP (409/422) é decisão da rota, não daqui.
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type Oportunidade = typeof oportunidades.$inferSelect;

const LIMITE_PADRAO = 20;

// AC-079: toda oportunidade nova nasce na primeira etapa do playbook.
const ETAPA_ENTRADA_DE_LEADS = 1;

/** T-044 (US-030): `leadId` não existe no tenant do `contexto` (AC-081) — nem em outro tenant, nem em lugar nenhum. */
export class ErroLeadNaoEncontrado extends Error {
  constructor() {
    super('Lead informado não existe no tenant da sessão.');
    this.name = 'ErroLeadNaoEncontrado';
  }
}

/** T-045 (US-031): `version` informada não bate com a `version` atual da linha (AC-086) — lock otimista rejeitado pelo Postgres. */
export class ErroConflitoDeVersao extends Error {
  constructor() {
    super('A oportunidade foi alterada por outra ação; recarregue e tente novamente.');
    this.name = 'ErroConflitoDeVersao';
  }
}

// ERRCODE usado por `RAISE EXCEPTION ... USING ERRCODE = 'P0001'` dentro de
// `mover_oportunidade` (drizzle/0006_fn_mover_oportunidade_guards.sql) —
// único caso em que a função lança exceção, então basta checar o código.
const ERRCODE_CONFLITO_DE_VERSAO = 'P0001';

/**
 * O driver `pg` expõe o SQLSTATE em `error.code`, mas o Drizzle (node-postgres)
 * embrulha esse erro num `DrizzleQueryError` cuja causa (`error.cause`) é o
 * erro original do `pg` — checa os dois formatos.
 */
function codigoErroPostgres(erro: unknown): string | undefined {
  if (!erro || typeof erro !== 'object') return undefined;
  const comCodigo = erro as { code?: string; cause?: { code?: string } };
  return comCodigo.code ?? comCodigo.cause?.code;
}

export interface DadosNovaOportunidade {
  leadId: string;
  /**
   * Deliberadamente aceito na entrada só para o caso de um chamador
   * descuidado repassar um payload externo inteiro — nunca é lido: o
   * `empresa_id` gravado é sempre `contexto.empresaId` (AC-080).
   */
  empresaId?: string;
}

export interface FiltroListarOportunidades {
  etapaId?: number;
  responsavelId?: string;
  /** Tamanho da página. Default: 20. */
  limite?: number;
  /** Quantos registros pular (paginação por deslocamento). Default: 0. */
  deslocamento?: number;
}

export interface PaginaOportunidades {
  itens: Oportunidade[];
  limite: number;
  deslocamento: number;
}

export interface AlteracoesOportunidade {
  valor?: string | null;
  responsavelId?: string | null;
  proximaAcaoEm?: Date | null;
}

export interface ResultadoAtualizacao {
  /** 0 quando o id não existe no tenant do contexto (AC-070) — nunca lança como sucesso. */
  linhasAfetadas: number;
}

/** Busca uma oportunidade por id sob o tenant do `contexto` — fail closed (AC-069). */
export async function buscarOportunidadePorId(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string
): Promise<Oportunidade | null> {
  return comTenant(db, contexto, async (tx) => {
    const registros = await tx
      .select()
      .from(oportunidades)
      .where(and(eq(oportunidades.id, id), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    return registros[0] ?? null;
  });
}

/**
 * Lista oportunidades do tenant do `contexto`, com filtro opcional por etapa
 * e/ou responsável (combinam com E — AC-072) e paginação por deslocamento
 * (AC-073).
 */
export async function listarOportunidades(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroListarOportunidades = {}
): Promise<PaginaOportunidades> {
  const limite = filtro.limite ?? LIMITE_PADRAO;
  const deslocamento = filtro.deslocamento ?? 0;

  return comTenant(db, contexto, async (tx) => {
    const condicoes = [eq(oportunidades.empresaId, contexto.empresaId)];
    if (filtro.etapaId !== undefined) {
      condicoes.push(eq(oportunidades.etapaId, filtro.etapaId));
    }
    if (filtro.responsavelId !== undefined) {
      condicoes.push(eq(oportunidades.responsavelId, filtro.responsavelId));
    }

    const itens = await tx
      .select()
      .from(oportunidades)
      .where(and(...condicoes))
      .orderBy(asc(oportunidades.criadoEm), asc(oportunidades.id))
      .limit(limite)
      .offset(deslocamento);

    return { itens, limite, deslocamento };
  });
}

/**
 * Cria uma oportunidade em "Entrada de leads" (AC-079) sob o tenant do
 * `contexto` (AC-080: `dados.empresaId`, se enviado, é ignorado). Rejeita
 * (`ErroLeadNaoEncontrado`) se `dados.leadId` não existir nesse tenant
 * (AC-081) — nada é inserido nesse caso.
 */
export async function criarOportunidade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: DadosNovaOportunidade
): Promise<Oportunidade> {
  return comTenant(db, contexto, async (tx) => {
    const leadDoTenant = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, dados.leadId), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);

    if (leadDoTenant.length === 0) {
      throw new ErroLeadNaoEncontrado();
    }

    const [oportunidade] = await tx
      .insert(oportunidades)
      .values({
        empresaId: contexto.empresaId,
        leadId: dados.leadId,
        etapaId: ETAPA_ENTRADA_DE_LEADS,
      })
      .returning();
    return oportunidade;
  });
}

export interface DadosMoverOportunidade {
  /** `version` que o chamador acredita ser a atual — lock otimista (AC-086). */
  version: number;
  etapaDestinoId: number;
  /** `null` quando o ator é o sistema (sem usuário humano por trás). */
  atorId: string | null;
  atorTipo: 'usuario' | 'sistema' | 'migracao';
  valor?: string | null;
  motivoPerdaId?: string | null;
  proximaAcaoEm?: Date | null;
}

/**
 * Move uma oportunidade de etapa chamando `mover_oportunidade` (função SQL
 * estendida por T-043), sob o tenant do `contexto`. Grava etapa, `version`
 * incrementada, os dados de guard enviados (`valor`/`motivoPerdaId`/
 * `proximaAcaoEm`) e o evento `transicao_etapa` numa única chamada
 * transacional (AC-082) — quem decide SE a transição é permitida (grafo,
 * papel, dados obrigatórios) é o domínio, chamado pela rota antes deste
 * repositório.
 *
 * Rejeita (`ErroConflitoDeVersao`) sem gravar nada se `dados.version` não
 * bater com a `version` atual da linha (AC-086, lock otimista no Postgres).
 */
export async function moverOportunidade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  dados: DadosMoverOportunidade
): Promise<Oportunidade> {
  return comTenant(db, contexto, async (tx) => {
    try {
      await tx.execute(sql`
        select mover_oportunidade(
          ${id}::uuid,
          ${dados.version}::integer,
          ${dados.etapaDestinoId}::integer,
          ${dados.atorId}::uuid,
          ${dados.atorTipo}::ator_tipo,
          null::jsonb,
          ${dados.valor ?? null}::numeric,
          ${dados.motivoPerdaId ?? null}::uuid,
          ${dados.proximaAcaoEm ?? null}::timestamptz
        )
      `);
    } catch (erro) {
      if (codigoErroPostgres(erro) === ERRCODE_CONFLITO_DE_VERSAO) {
        throw new ErroConflitoDeVersao();
      }
      throw erro;
    }

    const [oportunidade] = await tx
      .select()
      .from(oportunidades)
      .where(and(eq(oportunidades.id, id), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    return oportunidade;
  });
}

/** Atualiza campos simples de uma oportunidade sob o tenant do `contexto`. */
export async function atualizarOportunidade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  alteracoes: AlteracoesOportunidade
): Promise<ResultadoAtualizacao> {
  return comTenant(db, contexto, async (tx) => {
    const atualizadas = await tx
      .update(oportunidades)
      .set({ ...alteracoes, atualizadoEm: new Date() })
      .where(and(eq(oportunidades.id, id), eq(oportunidades.empresaId, contexto.empresaId)))
      .returning({ id: oportunidades.id });

    return { linhasAfetadas: atualizadas.length };
  });
}
