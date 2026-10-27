// T-154 (fase4-pipeline-telas, US-106/US-108): indicadores do topo do funil
// (AC-389) e dos arquivados (AC-403) — sempre calculados sobre os dados
// reais do tenant (ASM-135; nunca os números fixos do protótipo), sob o
// mesmo `comTenant` (T-040) dos demais repositórios da feature.
//
// "Toques em atraso" reaproveita a mesma regra da fila de tarefas atrasadas
// (`listarFilaDoTurno`, cadencia.ts/T-090) em vez de duplicá-la; o período
// padrão dos indicadores dos arquivados reaproveita `limitesDoPeriodo`
// (kpis.ts/T-101), pelo mesmo motivo; a data de fechamento reaproveita
// `expressaoDataFechamento` (ASM-134, pipeline-lista.ts/T-154).
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { motivosPerda, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { listarFilaDoTurno } from './cadencia';
import { comTenant } from './contexto';
import { limitesDoPeriodo } from './kpis';
import { expressaoDataFechamento } from './pipeline-lista';

const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;
const ETAPAS_TERMINAIS = [ETAPA_PERDIDO, ETAPA_CONTRATO_GANHO] as const;
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

/** Mesmo formato null-safe de `Indicador` em kpis.ts (AC-224): denominador 0 nunca divide, nunca gera erro ou 0%. */
export interface Indicador {
  valor: number | null;
  numerador: number;
  denominador: number;
}

function calcularIndicador(numerador: number, denominador: number): Indicador {
  if (denominador === 0) return { valor: null, numerador: 0, denominador: 0 };
  return { valor: numerador / denominador, numerador, denominador };
}

// ---------------------------------------------------------------------------
// AC-389: indicadores do topo do funil.
// ---------------------------------------------------------------------------

export interface IndicadoresFunil {
  /** Fora das etapas terminais (ASM-133/ASM-135). */
  cardsAtivos: { quantidade: number; valorTotal: string };
  /** ASM-135: atividades de cadência pendentes com horário vencido — mesma fila de T-090. */
  toquesEmAtraso: number;
  /** ASM-135: cards na etapa "Proposta" (id 11, drizzle/0005_seeds.sql). */
  propostasAtivas: number;
  /** ASM-135: ganhos ÷ (ganhos + perdidos) com fechamento nos últimos 30 dias de `filtro.agora`. */
  conversao30Dias: Indicador;
}

export interface FiltroIndicadoresFunil {
  /** Relógio injetado (ASM-062, mesmo padrão de cadencia.ts/kpis.ts) — nunca `Date.now()` real. */
  agora: Date;
}

/** AC-389: os quatro cartões do topo do funil, só com dados da empresa da sessão. */
export async function obterIndicadoresFunil(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroIndicadoresFunil
): Promise<IndicadoresFunil> {
  const inicio30Dias = new Date(filtro.agora.getTime() - TRINTA_DIAS_MS);

  return comTenant(db, contexto, async (tx) => {
    const [ativos] = await tx
      .select({
        quantidade: sql<number>`count(*)::int`,
        valorTotal: sql<string>`coalesce(sum(${oportunidades.valor}), 0)::text`,
      })
      .from(oportunidades)
      .where(
        and(
          eq(oportunidades.empresaId, contexto.empresaId),
          sql`${oportunidades.etapaId} not in (${ETAPA_PERDIDO}, ${ETAPA_CONTRATO_GANHO})`
        )
      );

    const [propostas] = await tx
      .select({ quantidade: sql<number>`count(*)::int` })
      .from(oportunidades)
      .where(and(eq(oportunidades.empresaId, contexto.empresaId), eq(oportunidades.etapaId, ETAPA_PROPOSTA)));

    // Reaproveita a regra de "atrasado" da fila de tarefas (T-090) em vez de
    // recalcular turno/corte aqui — a mesma lista que alimenta "Minhas
    // tarefas" com `incluirAtrasados`.
    const fila = await listarFilaDoTurno(db, contexto, { agora: filtro.agora, incluirAtrasados: true });
    const toquesEmAtraso = fila.filter((item) => item.atrasado).length;

    const [fechamentos] = await tx
      .select({
        ganhos: sql<number>`count(*) filter (where ${oportunidades.etapaId} = ${ETAPA_CONTRATO_GANHO})::int`,
        perdidos: sql<number>`count(*) filter (where ${oportunidades.etapaId} = ${ETAPA_PERDIDO})::int`,
      })
      .from(oportunidades)
      .where(
        and(
          eq(oportunidades.empresaId, contexto.empresaId),
          inArray(oportunidades.etapaId, [...ETAPAS_TERMINAIS]),
          sql`${expressaoDataFechamento} >= ${inicio30Dias.toISOString()}::timestamptz`,
          sql`${expressaoDataFechamento} <= ${filtro.agora.toISOString()}::timestamptz`
        )
      );

    return {
      cardsAtivos: { quantidade: ativos.quantidade, valorTotal: ativos.valorTotal },
      toquesEmAtraso,
      propostasAtivas: propostas.quantidade,
      conversao30Dias: calcularIndicador(fechamentos.ganhos, fechamentos.ganhos + fechamentos.perdidos),
    };
  });
}

// ---------------------------------------------------------------------------
// AC-403: indicadores dos arquivados.
// ---------------------------------------------------------------------------

export interface MotivoDistribuicao {
  motivoId: string;
  motivo: string;
  quantidade: number;
  /** Fração 0-1 sobre o total de perdidos no período, `null` sem nenhum perdido (mesmo padrão null-safe de `Indicador`). */
  percentual: number | null;
}

export interface IndicadoresArquivados {
  valorGanho: string;
  negociosFechados: number;
  /** Ganhos ÷ finalizados (ganhos + perdidos) no período. */
  conversaoFinal: Indicador;
  perdas: {
    quantidade: number;
    /** Perdidos ÷ finalizados (ganhos + perdidos) no período. */
    taxaPerda: Indicador;
  };
  distribuicaoMotivos: MotivoDistribuicao[];
}

export interface FiltroIndicadoresArquivados {
  /** `YYYY-MM-DD`, inclusivo. Omitido junto com `ate`: mês corrente (mesmo padrão de `limitesDoPeriodo`, kpis.ts). */
  de?: string;
  ate?: string;
  /** Relógio injetado (ASM-062) — só usado para o padrão "mês corrente". */
  agora: Date;
}

/**
 * AC-403: os quatro cartões dos arquivados (valor ganho, negócios
 * fechados, conversão final e perdas no período com a taxa de perda) e a
 * distribuição de motivos de perda, só com dados da empresa da sessão.
 */
export async function obterIndicadoresArquivados(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroIndicadoresArquivados
): Promise<IndicadoresArquivados> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);

  return comTenant(db, contexto, async (tx) => {
    const condicaoPeriodo = and(
      eq(oportunidades.empresaId, contexto.empresaId),
      inArray(oportunidades.etapaId, [...ETAPAS_TERMINAIS]),
      sql`${expressaoDataFechamento} >= ${inicio.toISOString()}::timestamptz`,
      sql`${expressaoDataFechamento} < ${fimExclusivo.toISOString()}::timestamptz`
    );

    const [linha] = await tx
      .select({
        valorGanho: sql<string>`coalesce(sum(${oportunidades.valor}) filter (where ${oportunidades.etapaId} = ${ETAPA_CONTRATO_GANHO}), 0)::text`,
        ganhos: sql<number>`count(*) filter (where ${oportunidades.etapaId} = ${ETAPA_CONTRATO_GANHO})::int`,
        perdidos: sql<number>`count(*) filter (where ${oportunidades.etapaId} = ${ETAPA_PERDIDO})::int`,
      })
      .from(oportunidades)
      .where(condicaoPeriodo);

    const negociosFechados = linha.ganhos + linha.perdidos;

    const motivos = await tx
      .select({
        motivoId: motivosPerda.id,
        motivo: motivosPerda.nome,
        quantidade: sql<number>`count(*)::int`,
      })
      .from(oportunidades)
      .innerJoin(motivosPerda, eq(oportunidades.motivoPerdaId, motivosPerda.id))
      .where(
        and(
          eq(oportunidades.empresaId, contexto.empresaId),
          eq(oportunidades.etapaId, ETAPA_PERDIDO),
          sql`${expressaoDataFechamento} >= ${inicio.toISOString()}::timestamptz`,
          sql`${expressaoDataFechamento} < ${fimExclusivo.toISOString()}::timestamptz`
        )
      )
      .groupBy(motivosPerda.id, motivosPerda.nome);

    const distribuicaoMotivos: MotivoDistribuicao[] = motivos.map((motivo) => ({
      motivoId: motivo.motivoId,
      motivo: motivo.motivo,
      quantidade: motivo.quantidade,
      percentual: linha.perdidos === 0 ? null : motivo.quantidade / linha.perdidos,
    }));

    return {
      valorGanho: linha.valorGanho,
      negociosFechados,
      conversaoFinal: calcularIndicador(linha.ganhos, negociosFechados),
      perdas: {
        quantidade: linha.perdidos,
        taxaPerda: calcularIndicador(linha.perdidos, negociosFechados),
      },
      distribuicaoMotivos,
    };
  });
}
