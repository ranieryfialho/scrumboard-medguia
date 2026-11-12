// T-179 (fase4-pipeline-lote, US-118, AC-455/AC-456/AC-459): as linhas das
// exportações de CSV da lista e dos arquivados. Usa as MESMAS condições, a mesma
// ordenação e o mesmo mapeamento das telas (`pipeline-lista.ts`) — mas sem a
// paginação: sai tudo que atende aos filtros, até o teto de linhas (ASM-155).
// Acima do teto devolve `excedeu`, sem montar o arquivo. A gravação do registro
// (`registrarExportacao`) é separada, para só acontecer quando o arquivo é de fato
// entregue (AC-459).
import { and, desc, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { auditoriaExportacoes, leads, motivosPerda, oportunidadeQualificacao, oportunidades, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import {
  colunasDaQualificacao,
  condicoesDaLista,
  condicoesDosArquivados,
  juncaoDaQualificacao,
  expressaoDataFechamento,
  mapearItemArquivado,
  mapearItemLista,
  ordenacaoDaLista,
  type FiltroArquivados,
  type FiltroLista,
  type ItemArquivado,
  type ItemLista,
} from './pipeline-lista';

export const LIMITE_DE_LINHAS_DA_EXPORTACAO = 5000;

export type ResultadoExportacao<T> = { excedeu: true; total: number } | { excedeu: false; itens: T[] };

/** Só os filtros (a paginação nunca entra na exportação). */
export type FiltroExportarLista = Omit<FiltroLista, 'pagina' | 'porPagina'>;
export type FiltroExportarArquivados = Omit<FiltroArquivados, 'pagina' | 'porPagina'>;

export async function exportarLista(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroExportarLista,
  limite: number = LIMITE_DE_LINHAS_DA_EXPORTACAO
): Promise<ResultadoExportacao<ItemLista>> {
  return comTenant(db, contexto, async (tx) => {
    const condicoes = condicoesDaLista(contexto, filtro);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(oportunidadeQualificacao, juncaoDaQualificacao)
      .where(and(...condicoes));
    if (total > limite) return { excedeu: true as const, total };

    const linhas = await tx
      .select({ oportunidade: oportunidades, lead: leads, responsavel: usuarios, qualificacao: colunasDaQualificacao })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .leftJoin(oportunidadeQualificacao, juncaoDaQualificacao)
      .where(and(...condicoes))
      .orderBy(...ordenacaoDaLista(filtro));

    return { excedeu: false as const, itens: linhas.map(mapearItemLista) };
  });
}

export async function exportarArquivados(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroExportarArquivados,
  limite: number = LIMITE_DE_LINHAS_DA_EXPORTACAO
): Promise<ResultadoExportacao<ItemArquivado>> {
  return comTenant(db, contexto, async (tx) => {
    const condicoes = condicoesDosArquivados(contexto, filtro);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...condicoes));
    if (total > limite) return { excedeu: true as const, total };

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
      .orderBy(desc(expressaoDataFechamento), asc(oportunidades.id));

    return { excedeu: false as const, itens: linhas.map(mapearItemArquivado) };
  });
}

export interface DadosDaExportacao {
  tela: 'lista' | 'arquivados';
  filtros: Record<string, unknown>;
  linhas: number;
}

/** AC-459: grava quem exportou, quando, de qual tela, com quais filtros e quantas linhas (só a empresa da sessão). */
export async function registrarExportacao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: DadosDaExportacao
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx.insert(auditoriaExportacoes).values({
      empresaId: contexto.empresaId,
      usuarioId: contexto.usuarioId,
      tela: dados.tela,
      filtros: dados.filtros,
      linhas: dados.linhas,
    });
  });
}
