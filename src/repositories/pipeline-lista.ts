// T-154 (fase4-pipeline-telas, US-107/US-108): repositórios de leitura das
// telas de lista e arquivados — filtro, ordenação e paginação inteiramente
// no servidor (decisão do usuário, 26/10), sem tocar em oportunidades.ts.
// Mesmo padrão `comTenant` (T-040) de fase1: toda query filtra
// explicitamente por `empresa_id = contexto.empresaId` além do RLS
// (AC-397/AC-402) — fail-closed por tenant, igual a oportunidades.ts.
//
// ASM-133: "lista" (US-107) são as oportunidades fora das etapas terminais
// (1 a 13, AC-398); "arquivados" (US-108) são as etapas 14 (Perdido) e 15
// (Contrato/Ganho). ASM-134: a data de fechamento de um card arquivado é o
// `ocorrido_em` do último evento `transicao_etapa` cujo `etapa_destino_id`
// é a etapa terminal atual do card (`expressaoDataFechamento`); sem esse
// evento (ex.: card migrado do legado, sem histórico), cai para
// `atualizado_em` — exportada para `pipeline-indicadores.ts` reaproveitar a
// mesma regra sem duplicá-la.
import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, motivosPerda, oportunidades, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { prioridadeMeta } from './prioridade-meta';

export type TamanhoPagina = 10 | 25 | 50;

const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;
const ETAPAS_TERMINAIS = [ETAPA_PERDIDO, ETAPA_CONTRATO_GANHO] as const;

/** AC-395: tamanho de página fora de 10/25/50 vira 10 — defesa em profundidade; a rota (T-155) normaliza de novo antes de chamar aqui. */
export function normalizarPorPagina(valor: number | undefined): TamanhoPagina {
  if (valor === 10 || valor === 25 || valor === 50) return valor;
  return 10;
}

/** AC-395: página mínima 1 — qualquer valor menor, ausente ou não inteiro volta para a primeira página. */
function normalizarPagina(valor: number | undefined): number {
  if (!Number.isInteger(valor) || (valor as number) < 1) return 1;
  return valor as number;
}

/**
 * ASM-134: data de fechamento = `ocorrido_em` do último `transicao_etapa`
 * cujo destino é a etapa terminal atual do card; sem esse evento,
 * `atualizado_em`. Reaproveitada como coluna (SELECT) e como condição
 * (WHERE) — nunca duplicada em texto solto.
 */
export const expressaoDataFechamento = sql<string>`coalesce(
  (select max("oportunidade_eventos"."ocorrido_em")
     from "oportunidade_eventos"
    where "oportunidade_eventos"."oportunidade_id" = "oportunidades"."id"
      and "oportunidade_eventos"."tipo" = 'transicao_etapa'
      and "oportunidade_eventos"."etapa_destino_id" = "oportunidades"."etapa_id")
  , "oportunidades"."atualizado_em"
)`;

export interface ItemLead {
  id: string;
  nome: string;
  email: string | null;
  telefoneE164: string | null;
  origem: string | null;
}

export interface ItemResponsavel {
  id: string;
  nome: string;
}

export interface PaginaLista<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: TamanhoPagina;
}

function condicaoBusca(busca: string | undefined): SQL | undefined {
  if (!busca) return undefined;
  const termo = `%${busca}%`;
  // AC-396: busca de texto acha por nome do lead, e-mail e telefone.
  return or(ilike(leads.nome, termo), ilike(leads.email, termo), ilike(leads.telefoneE164, termo));
}

// ---------------------------------------------------------------------------
// US-107: lista do pipeline ativo (AC-394 a AC-399; aqui só o que é servidor:
// AC-395/AC-396/AC-397/AC-398).
// ---------------------------------------------------------------------------

export type OrdenacaoLista = 'valor' | 'proximaAcao' | 'criadoEm';
export type DirecaoOrdenacao = 'asc' | 'desc';

export interface ItemLista {
  id: string;
  etapaId: number;
  valor: string | null;
  proximaAcaoEm: Date | null;
  criadoEm: Date;
  lead: ItemLead;
  responsavel: ItemResponsavel | null;
}

export interface FiltroLista {
  etapaId?: number;
  responsavelId?: string;
  origem?: string;
  busca?: string;
  ordenarPor?: OrdenacaoLista;
  ordem?: DirecaoOrdenacao;
  /** 1-based (AC-395). Default: 1. */
  pagina?: number;
  porPagina?: number;
}

function colunaOrdenacaoLista(ordenarPor: OrdenacaoLista | undefined) {
  if (ordenarPor === 'valor') return oportunidades.valor;
  if (ordenarPor === 'proximaAcao') return oportunidades.proximaAcaoEm;
  return oportunidades.criadoEm;
}

/** T-179: as condições da lista, reaproveitadas pela exportação (mesmos filtros da tela, nunca uma cópia da regra). */
export function condicoesDaLista(contexto: ContextoTenant, filtro: FiltroLista): SQL[] {
  const condicoes: SQL[] = [
    eq(oportunidades.empresaId, contexto.empresaId),
    notInArray(oportunidades.etapaId, [...ETAPAS_TERMINAIS]),
  ];
  if (filtro.etapaId !== undefined) condicoes.push(eq(oportunidades.etapaId, filtro.etapaId));
  if (filtro.responsavelId !== undefined) condicoes.push(eq(oportunidades.responsavelId, filtro.responsavelId));
  if (filtro.origem !== undefined) condicoes.push(eq(leads.origem, filtro.origem));
  const busca = condicaoBusca(filtro.busca);
  if (busca) condicoes.push(busca);
  return condicoes;
}

/** T-179: a ordenação da lista (coluna e direção), a mesma na tela e na exportação. */
export function ordenacaoDaLista(filtro: FiltroLista) {
  // Sem ordenação escolhida pelo usuário, vale a regra do funil: leads novos do Meta primeiro.
  const coluna = colunaOrdenacaoLista(filtro.ordenarPor);
  const direcao = filtro.ordem === 'asc' ? asc : desc;
  if (filtro.ordenarPor === undefined && filtro.ordem === undefined) return [prioridadeMeta, direcao(coluna), asc(oportunidades.id)] as const;
  return [direcao(coluna), asc(oportunidades.id)] as const;
}

type LinhaDaLista = {
  oportunidade: typeof oportunidades.$inferSelect;
  lead: typeof leads.$inferSelect;
  responsavel: typeof usuarios.$inferSelect | null;
};

/** T-179: uma linha da consulta da lista → `ItemLista` (usado na tela e na exportação). */
export function mapearItemLista(linha: LinhaDaLista): ItemLista {
  return {
    id: linha.oportunidade.id,
    etapaId: linha.oportunidade.etapaId,
    valor: linha.oportunidade.valor,
    proximaAcaoEm: linha.oportunidade.proximaAcaoEm,
    criadoEm: linha.oportunidade.criadoEm,
    lead: {
      id: linha.lead.id,
      nome: linha.lead.nome,
      email: linha.lead.email,
      telefoneE164: linha.lead.telefoneE164,
      origem: linha.lead.origem,
    },
    responsavel: linha.responsavel ? { id: linha.responsavel.id, nome: linha.responsavel.nome } : null,
  };
}

/**
 * Lista paginada das oportunidades ativas (AC-398: nunca as etapas
 * terminais 14/15 — essas estão em `listarArquivados`), filtrada e
 * ordenada no servidor (AC-396), sempre sob o tenant do `contexto` (AC-397
 * — `empresaId` vindo de fora nunca é lido por esta função).
 */
export async function listarLista(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroLista = {}
): Promise<PaginaLista<ItemLista>> {
  const pagina = normalizarPagina(filtro.pagina);
  const porPagina = normalizarPorPagina(filtro.porPagina);
  const deslocamento = (pagina - 1) * porPagina;

  return comTenant(db, contexto, async (tx) => {
    const condicoes = condicoesDaLista(contexto, filtro);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...condicoes));

    const linhas = await tx
      .select({ oportunidade: oportunidades, lead: leads, responsavel: usuarios })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(...condicoes))
      .orderBy(...ordenacaoDaLista(filtro))
      .limit(porPagina)
      .offset(deslocamento);

    const itens: ItemLista[] = linhas.map(mapearItemLista);

    return { itens, total, pagina, porPagina };
  });
}

// ---------------------------------------------------------------------------
// US-108: arquivados (AC-400 a AC-405; aqui só o que é servidor: AC-402).
// ---------------------------------------------------------------------------

export type TipoArquivado = 'ganho' | 'perdido';

export interface ItemArquivado {
  id: string;
  etapaId: number;
  status: TipoArquivado;
  valor: string | null;
  dataFechamento: Date;
  lead: ItemLead;
  responsavel: ItemResponsavel | null;
  motivoPerda: { id: string; nome: string } | null;
}

export interface FiltroArquivados {
  /** Sem filtro: as duas (AC-402 cobre o servidor; as abas da UI são T-162). */
  tipo?: TipoArquivado;
  motivoPerdaId?: string;
  responsavelId?: string;
  busca?: string;
  /** Início do período de fechamento (`YYYY-MM-DD`, inclusivo). */
  de?: string;
  /** Fim do período de fechamento (`YYYY-MM-DD`, inclusivo). */
  ate?: string;
  /** 1-based (AC-402). Default: 1. */
  pagina?: number;
  porPagina?: number;
}

/** Meia-noite de `data` (`YYYY-MM-DD`) em `America/Sao_Paulo` — sem DST desde 2019 (mesmo comentário de kpis.ts/cadencia.ts). */
function inicioDoDiaEmSaoPaulo(data: string): Date {
  return new Date(`${data}T00:00:00-03:00`);
}

/** Primeiro instante do dia seguinte a `data` (`YYYY-MM-DD`), em `America/Sao_Paulo`. */
function inicioDoDiaSeguinteEmSaoPaulo(data: string): Date {
  return new Date(inicioDoDiaEmSaoPaulo(data).getTime() + 24 * 60 * 60 * 1000);
}

/** T-179: as condições dos arquivados, reaproveitadas pela exportação. */
export function condicoesDosArquivados(contexto: ContextoTenant, filtro: FiltroArquivados): SQL[] {
  const condicoes: SQL[] = [eq(oportunidades.empresaId, contexto.empresaId)];

  if (filtro.tipo === 'ganho') condicoes.push(eq(oportunidades.etapaId, ETAPA_CONTRATO_GANHO));
  else if (filtro.tipo === 'perdido') condicoes.push(eq(oportunidades.etapaId, ETAPA_PERDIDO));
  else condicoes.push(inArray(oportunidades.etapaId, [...ETAPAS_TERMINAIS]));

  if (filtro.motivoPerdaId !== undefined) condicoes.push(eq(oportunidades.motivoPerdaId, filtro.motivoPerdaId));
  if (filtro.responsavelId !== undefined) condicoes.push(eq(oportunidades.responsavelId, filtro.responsavelId));
  const busca = condicaoBusca(filtro.busca);
  if (busca) condicoes.push(busca);
  if (filtro.de !== undefined) {
    condicoes.push(sql`${expressaoDataFechamento} >= ${inicioDoDiaEmSaoPaulo(filtro.de).toISOString()}::timestamptz`);
  }
  if (filtro.ate !== undefined) {
    condicoes.push(
      sql`${expressaoDataFechamento} < ${inicioDoDiaSeguinteEmSaoPaulo(filtro.ate).toISOString()}::timestamptz`
    );
  }
  return condicoes;
}

type LinhaDoArquivado = {
  oportunidade: typeof oportunidades.$inferSelect;
  lead: typeof leads.$inferSelect;
  responsavel: typeof usuarios.$inferSelect | null;
  motivoPerda: typeof motivosPerda.$inferSelect | null;
  dataFechamento: string;
};

/** T-179: uma linha da consulta dos arquivados → `ItemArquivado` (usado na tela e na exportação). */
export function mapearItemArquivado(linha: LinhaDoArquivado): ItemArquivado {
  return {
    id: linha.oportunidade.id,
    etapaId: linha.oportunidade.etapaId,
    status: linha.oportunidade.etapaId === ETAPA_CONTRATO_GANHO ? 'ganho' : 'perdido',
    valor: linha.oportunidade.valor,
    dataFechamento: new Date(linha.dataFechamento),
    lead: {
      id: linha.lead.id,
      nome: linha.lead.nome,
      email: linha.lead.email,
      telefoneE164: linha.lead.telefoneE164,
      origem: linha.lead.origem,
    },
    responsavel: linha.responsavel ? { id: linha.responsavel.id, nome: linha.responsavel.nome } : null,
    motivoPerda: linha.motivoPerda ? { id: linha.motivoPerda.id, nome: linha.motivoPerda.nome } : null,
  };
}

/**
 * Lista paginada das oportunidades arquivadas (etapas 14/15, ASM-133),
 * filtrada por texto, motivo de perda, responsável e período de fechamento
 * e paginada no servidor (AC-402), sempre sob o tenant do `contexto` — e
 * nunca de outra empresa, mesmo que `tipo`/`motivoPerdaId` etc. tentem
 * apontar para um id de outro tenant (o `empresaId` da condição é sempre o
 * da sessão).
 */
export async function listarArquivados(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroArquivados = {}
): Promise<PaginaLista<ItemArquivado>> {
  const pagina = normalizarPagina(filtro.pagina);
  const porPagina = normalizarPorPagina(filtro.porPagina);
  const deslocamento = (pagina - 1) * porPagina;

  return comTenant(db, contexto, async (tx) => {
    const condicoes = condicoesDosArquivados(contexto, filtro);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...condicoes));

    const linhas = await tx
      .select({
        oportunidade: oportunidades,
        lead: leads,
        responsavel: usuarios,
        motivoPerda: motivosPerda,
        dataFechamento: expressaoDataFechamento,
      })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .leftJoin(motivosPerda, eq(oportunidades.motivoPerdaId, motivosPerda.id))
      .where(and(...condicoes))
      .orderBy(desc(expressaoDataFechamento), asc(oportunidades.id))
      .limit(porPagina)
      .offset(deslocamento);

    const itens: ItemArquivado[] = linhas.map(mapearItemArquivado);

    return { itens, total, pagina, porPagina };
  });
}
