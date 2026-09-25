// T-042 (fase1-repositorios-isolamento, US-026/US-027/US-028): repositório
// de oportunidades. Mesmas regras de leads.ts: tudo passa por `comTenant`
// (T-040), toda query filtra explicitamente por
// `empresa_id = contexto.empresaId` além do RLS, e `atualizarOportunidade`
// nunca finge sucesso quando o id pertence a outro tenant (AC-070) — reporta
// zero linhas afetadas.
//
// Fora de escopo (ver spec, "Fora de escopo"): chamar `mover_oportunidade`
// ou orquestrar `validarTransicao` — isso é da futura feature de rotas
// HTTP, que compõe domínio + este repositório.
import { and, asc, eq } from 'drizzle-orm';
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
