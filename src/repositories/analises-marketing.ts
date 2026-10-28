// T-202 (fase4-analises, US-134): relatório de marketing — leads criados no período,
// por origem, e quantos viraram conexão, reunião e contrato (ASM-190/ASM-191/ASM-196).
// Só da empresa da sessão. Não há custo nem mídia no sistema (Q-057): só o que o CRM sabe.
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { limitesDoPeriodo } from './kpis';

const ETAPA_AGENDADA = 8;
const ETAPA_REALIZADA = 10;
const ETAPA_GANHO = 15;
const SEM_ORIGEM = 'Sem origem';

export type Agrupamento = 'dia' | 'semana' | 'mes';

export interface LinhaDeOrigem {
  origem: string;
  leads: number;
  conectados: number;
  reunioesRealizadas: number;
  contratos: number;
  /** Fração 0–1 de contratos ÷ leads, ou `null` sem leads. */
  conversaoFinal: number | null;
  valorGanho: number;
}

export interface RespostaMarketing {
  resumo: { leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null };
  agrupar: Agrupamento;
  serie: { inicio: string; leads: number; reunioes: number }[];
  porOrigem: LinhaDeOrigem[];
  origens: string[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Início (segunda, dia 1 ou o próprio dia) de cada intervalo entre `de` e `ate` (datas locais `YYYY-MM-DD`), sem pular nenhum (ASM-197). */
export function intervalos(de: string, ate: string, agrupar: Agrupamento): string[] {
  const inicio = new Date(`${de}T00:00:00Z`);
  const fim = new Date(`${ate}T00:00:00Z`);
  const lista: string[] = [];
  const atual = new Date(inicio);
  if (agrupar === 'semana') atual.setUTCDate(atual.getUTCDate() - ((atual.getUTCDay() + 6) % 7));
  if (agrupar === 'mes') atual.setUTCDate(1);
  while (atual <= fim) {
    lista.push(iso(atual));
    if (agrupar === 'dia') atual.setUTCDate(atual.getUTCDate() + 1);
    else if (agrupar === 'semana') atual.setUTCDate(atual.getUTCDate() + 7);
    else atual.setUTCMonth(atual.getUTCMonth() + 1);
  }
  return lista;
}

/** ASM-197: padrão por dia até 31 dias, por semana até 120 e por mês acima disso. */
export function agrupamentoPadrao(de: string, ate: string): Agrupamento {
  const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000 + 1;
  return dias <= 31 ? 'dia' : dias <= 120 ? 'semana' : 'mes';
}

/** `de`/`ate` locais (`YYYY-MM-DD`) a partir do filtro, com o mês corrente como padrão (mesma regra dos KPIs). */
export function periodoLocal(agora: Date, de?: string, ate?: string): { de: string; ate: string } {
  if (de && ate) return { de, ate };
  const { inicio, fimExclusivo } = limitesDoPeriodo(agora, de, ate);
  const local = (d: Date) => {
    const l = dataLocalEmSaoPaulo(d);
    return `${l.ano}-${String(l.mes).padStart(2, '0')}-${String(l.dia).padStart(2, '0')}`;
  };
  return { de: de ?? local(inicio), ate: ate ?? local(new Date(fimExclusivo.getTime() - 3600_000)) };
}

export async function obterMarketing(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { de?: string; ate?: string; origem?: string; agrupar?: Agrupamento; agora: Date }
): Promise<RespostaMarketing> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);
  const periodo = periodoLocal(filtro.agora, filtro.de, filtro.ate);
  const agrupar = filtro.agrupar ?? agrupamentoPadrao(periodo.de, periodo.ate);
  const unidade = agrupar === 'mes' ? 'month' : agrupar === 'semana' ? 'week' : 'day';
  const origemDe = sql`coalesce(nullif(btrim(l.origem), ''), ${SEM_ORIGEM})`;
  const filtroOrigem: SQL = filtro.origem ? sql`AND ${origemDe} = ${filtro.origem}` : sql``;
  const chegou = (etapa: number) =>
    sql`EXISTS (SELECT 1 FROM oportunidades o JOIN oportunidade_eventos e ON e.oportunidade_id = o.id WHERE o.lead_id = l.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${etapa})`;

  return comTenant(db, contexto, async (tx) => {
    const porOrigemBruto = await tx.execute<{ origem: string; leads: number; conectados: number; realizadas: number; contratos: number; valor: string }>(sql`
      SELECT ${origemDe} AS origem,
        count(*)::int AS leads,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM oportunidades o JOIN oportunidade_eventos e ON e.oportunidade_id = o.id
            WHERE o.lead_id = l.id AND ((e.tipo = 'atividade_concluida' AND e.payload ->> 'resultado' = 'conectou') OR e.tipo = 'conexao_whatsapp')))::int AS conectados,
        count(*) FILTER (WHERE ${chegou(ETAPA_REALIZADA)})::int AS realizadas,
        count(*) FILTER (WHERE ${chegou(ETAPA_GANHO)})::int AS contratos,
        coalesce(sum((SELECT coalesce(sum(o.valor), 0) FROM oportunidades o WHERE o.lead_id = l.id
          AND EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = o.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_GANHO}))), 0)::text AS valor
      FROM leads l
      WHERE l.criado_em >= ${inicio.toISOString()}::timestamptz AND l.criado_em < ${fimExclusivo.toISOString()}::timestamptz
        ${filtroOrigem}
      GROUP BY 1
    `);

    const leadsPorIntervalo = await tx.execute<{ inicio: string; total: number }>(sql`
      SELECT to_char(date_trunc(${unidade}, l.criado_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS inicio, count(*)::int AS total
      FROM leads l
      WHERE l.criado_em >= ${inicio.toISOString()}::timestamptz AND l.criado_em < ${fimExclusivo.toISOString()}::timestamptz
        ${filtroOrigem}
      GROUP BY 1
    `);

    const reunioesPorIntervalo = await tx.execute<{ inicio: string; total: number }>(sql`
      SELECT to_char(date_trunc(${unidade}, e.ocorrido_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS inicio, count(*)::int AS total
      FROM oportunidade_eventos e
      JOIN oportunidades o ON o.id = e.oportunidade_id
      JOIN leads l ON l.id = o.lead_id
      WHERE e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_AGENDADA}
        AND e.ocorrido_em >= ${inicio.toISOString()}::timestamptz AND e.ocorrido_em < ${fimExclusivo.toISOString()}::timestamptz
        ${filtroOrigem}
      GROUP BY 1
    `);

    const origensExistentes = await tx.execute<{ origem: string }>(sql`
      SELECT DISTINCT ${origemDe} AS origem FROM leads l ORDER BY 1 LIMIT 100
    `);

    const porOrigem: LinhaDeOrigem[] = porOrigemBruto.rows
      .map((r) => ({
        origem: r.origem,
        leads: r.leads,
        conectados: r.conectados,
        reunioesRealizadas: r.realizadas,
        contratos: r.contratos,
        conversaoFinal: r.leads > 0 ? r.contratos / r.leads : null,
        valorGanho: Number(r.valor),
      }))
      .sort((a, b) => b.leads - a.leads || a.origem.localeCompare(b.origem));

    const soma = (campo: 'leads' | 'conectados' | 'reunioesRealizadas' | 'contratos') => porOrigem.reduce((acc, l) => acc + l[campo], 0);
    const leads = soma('leads');
    const mapaLeads = new Map(leadsPorIntervalo.rows.map((r) => [r.inicio, r.total]));
    const mapaReunioes = new Map(reunioesPorIntervalo.rows.map((r) => [r.inicio, r.total]));

    return {
      resumo: { leads, conectados: soma('conectados'), reunioesRealizadas: soma('reunioesRealizadas'), contratos: soma('contratos'), conversaoFinal: leads > 0 ? soma('contratos') / leads : null },
      agrupar,
      serie: intervalos(periodo.de, periodo.ate, agrupar).map((inicioDoIntervalo) => ({
        inicio: inicioDoIntervalo,
        leads: mapaLeads.get(inicioDoIntervalo) ?? 0,
        reunioes: mapaReunioes.get(inicioDoIntervalo) ?? 0,
      })),
      porOrigem,
      origens: origensExistentes.rows.map((r) => r.origem),
    };
  });
}
