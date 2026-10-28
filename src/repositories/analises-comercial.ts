// T-203 (fase4-analises, US-135): relatório comercial — receita fechada, pipeline em
// negociação, ciclo de venda, win rate, ranking e motivos de perda. "No período" é a
// data do evento no histórico do card (ASM-190/ASM-191); a receita é o `valor` atual do
// card (ASM-193); o pipeline é a foto de hoje (ASM-194). Só da empresa da sessão.
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { limitesDoPeriodo } from './kpis';
import { intervalos, periodoLocal } from './analises-marketing';

const ETAPA_REALIZADA = 10;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_GANHO = 15;
const ETAPAS_EM_NEGOCIACAO = [11, 12, 13];
const SEM_MOTIVO = 'Sem motivo informado';

export interface LinhaDoRanking {
  responsavelId: string | null;
  nome: string | null;
  reunioesRealizadas: number;
  propostas: number;
  contratos: number;
  perdas: number;
  winRate: number | null;
  cicloMedioDias: number | null;
  ticketMedio: number | null;
  valorFechado: number;
}

export interface RespostaComercial {
  resumo: {
    mrrNovo: number;
    contratos: number;
    ticketMedio: number | null;
    pipelineEmNegociacao: { valor: number; propostas: number };
    cicloMedioDias: number | null;
    winRate: { valor: number | null; ganhos: number; perdas: number };
  };
  semanal: { inicio: string; valorFechado: number; pipelineCriado: number }[];
  ranking: LinhaDoRanking[];
  motivosPerda: { motivo: string; quantidade: number; percentual: number }[];
  totalPerdas: number;
}

type Evento = {
  oportunidade_id: string;
  etapa: number;
  responsavel_id: string | null;
  valor: string | null;
  ciclo_dias: number;
  semana: string;
  motivo: string | null;
};

const media = (valores: number[]): number | null => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);
const arredondar = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

export async function obterComercial(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { de?: string; ate?: string; responsavelId?: string; agora: Date }
): Promise<RespostaComercial> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);
  const periodo = periodoLocal(filtro.agora, filtro.de, filtro.ate);
  const doResponsavel: SQL = filtro.responsavelId ? sql`AND o.responsavel_id = ${filtro.responsavelId}::uuid` : sql``;

  return comTenant(db, contexto, async (tx) => {
    const eventos = await tx.execute<Evento>(sql`
      SELECT DISTINCT ON (e.oportunidade_id, e.etapa_destino_id)
        e.oportunidade_id, e.etapa_destino_id AS etapa, o.responsavel_id, o.valor::text AS valor,
        extract(epoch FROM (e.ocorrido_em - o.criado_em)) / 86400.0 AS ciclo_dias,
        to_char(date_trunc('week', e.ocorrido_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS semana,
        CASE WHEN e.etapa_destino_id = ${ETAPA_PERDIDO} THEN coalesce(m.nome, ${SEM_MOTIVO}) END AS motivo
      FROM oportunidade_eventos e
      JOIN oportunidades o ON o.id = e.oportunidade_id
      LEFT JOIN motivos_perda m ON m.id = o.motivo_perda_id
      WHERE e.tipo = 'transicao_etapa'
        AND e.etapa_destino_id IN (${ETAPA_REALIZADA}, ${ETAPA_PROPOSTA}, ${ETAPA_PERDIDO}, ${ETAPA_GANHO})
        AND e.ocorrido_em >= ${inicio.toISOString()}::timestamptz AND e.ocorrido_em < ${fimExclusivo.toISOString()}::timestamptz
        ${doResponsavel}
      ORDER BY e.oportunidade_id, e.etapa_destino_id, e.ocorrido_em
    `);

    const emNegociacao = await tx.execute<{ valor: string; total: number }>(sql`
      SELECT coalesce(sum(o.valor), 0)::text AS valor, count(*)::int AS total
      FROM oportunidades o
      WHERE o.etapa_id IN (${sql.join(ETAPAS_EM_NEGOCIACAO.map((e) => sql`${e}`), sql`, `)}) ${doResponsavel}
    `);

    const linhas = eventos.rows;
    const valorDe = (e: Evento) => Number(e.valor ?? 0);
    const ganhos = linhas.filter((e) => e.etapa === ETAPA_GANHO);
    const perdas = linhas.filter((e) => e.etapa === ETAPA_PERDIDO);
    const propostas = linhas.filter((e) => e.etapa === ETAPA_PROPOSTA);
    const mrrNovo = ganhos.reduce((acc, e) => acc + valorDe(e), 0);
    const taxa = (g: number, p: number) => (g + p > 0 ? g / (g + p) : null);

    const semanaDe = new Map<string, { valorFechado: number; pipelineCriado: number }>();
    for (const e of ganhos) {
      const s = semanaDe.get(e.semana) ?? { valorFechado: 0, pipelineCriado: 0 };
      s.valorFechado += valorDe(e);
      semanaDe.set(e.semana, s);
    }
    for (const e of propostas) {
      const s = semanaDe.get(e.semana) ?? { valorFechado: 0, pipelineCriado: 0 };
      s.pipelineCriado += valorDe(e);
      semanaDe.set(e.semana, s);
    }

    const ids = [...new Set(linhas.map((e) => e.responsavel_id).filter((id): id is string => id !== null))];
    const nomes = ids.length ? new Map((await tx.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, ids))).map((u) => [u.id, u.nome])) : new Map<string, string>();
    const chaves = [...new Set(linhas.map((e) => e.responsavel_id))];
    const ranking: LinhaDoRanking[] = chaves
      .map((responsavelId) => {
        const dele = linhas.filter((e) => e.responsavel_id === responsavelId);
        const g = dele.filter((e) => e.etapa === ETAPA_GANHO);
        const p = dele.filter((e) => e.etapa === ETAPA_PERDIDO);
        const valorFechado = g.reduce((acc, e) => acc + valorDe(e), 0);
        return {
          responsavelId,
          nome: responsavelId ? (nomes.get(responsavelId) ?? null) : null,
          reunioesRealizadas: dele.filter((e) => e.etapa === ETAPA_REALIZADA).length,
          propostas: dele.filter((e) => e.etapa === ETAPA_PROPOSTA).length,
          contratos: g.length,
          perdas: p.length,
          winRate: taxa(g.length, p.length),
          cicloMedioDias: arredondar(media(g.map((e) => Number(e.ciclo_dias)))),
          ticketMedio: g.length ? valorFechado / g.length : null,
          valorFechado,
        };
      })
      .sort((a, b) => b.valorFechado - a.valorFechado || b.contratos - a.contratos);

    const porMotivo = new Map<string, number>();
    for (const e of perdas) porMotivo.set(e.motivo ?? SEM_MOTIVO, (porMotivo.get(e.motivo ?? SEM_MOTIVO) ?? 0) + 1);

    return {
      resumo: {
        mrrNovo,
        contratos: ganhos.length,
        ticketMedio: ganhos.length ? mrrNovo / ganhos.length : null,
        pipelineEmNegociacao: { valor: Number(emNegociacao.rows[0]?.valor ?? 0), propostas: emNegociacao.rows[0]?.total ?? 0 },
        cicloMedioDias: arredondar(media(ganhos.map((e) => Number(e.ciclo_dias)))),
        winRate: { valor: taxa(ganhos.length, perdas.length), ganhos: ganhos.length, perdas: perdas.length },
      },
      semanal: intervalos(periodo.de, periodo.ate, 'semana').map((s) => ({ inicio: s, valorFechado: semanaDe.get(s)?.valorFechado ?? 0, pipelineCriado: semanaDe.get(s)?.pipelineCriado ?? 0 })),
      ranking,
      motivosPerda: [...porMotivo.entries()]
        .map(([motivo, quantidade]) => ({ motivo, quantidade, percentual: perdas.length ? Math.round((quantidade / perdas.length) * 1000) / 10 : 0 }))
        .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo)),
      totalPerdas: perdas.length,
    };
  });
}
