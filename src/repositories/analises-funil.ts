// T-201 (fase4-analises, US-133): funil por etapa e desempenho por responsável, na
// mesma coorte dos 7 indicadores (cards criados no período, ASM-191) e com a mesma
// regra de "chegou à etapa X" (evento `transicao_etapa`, ASM-190). Só da empresa da
// sessão (RLS + filtro explícito).
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresasUsuarios, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { limitesDoPeriodo } from './kpis';

const ETAPA_AGENDADA = 8;
const ETAPA_NO_SHOW = 9;
const ETAPA_REALIZADA = 10;
const ETAPA_PROPOSTA = 11;
const ETAPA_GANHO = 15;

export interface FunilPorEtapa {
  entrada: number;
  conectados: number;
  agendadas: number;
  realizadas: number;
  propostas: number;
  ganhos: number;
}

export interface DesempenhoDoResponsavel {
  responsavelId: string | null;
  nome: string | null;
  papel: string | null;
  atendidos: number;
  cadenciaIniciada: number;
  cadenciaEsgotada: number;
  agendadas: number;
  noShows: number;
  propostas: number;
  contratos: number;
  /** Fração 0–1 de contratos ÷ propostas, ou `null` sem propostas. */
  winRate: number | null;
  receitaGanha: number;
}

export interface RespostaFunil {
  funil: FunilPorEtapa;
  porResponsavel: DesempenhoDoResponsavel[];
}

type Linha = {
  responsavel_id: string | null;
  total: number;
  conectados: number;
  iniciaram: number;
  esgotadas: number;
  agendadas: number;
  no_shows: number;
  realizadas: number;
  propostas: number;
  ganhos: number;
  receita: string | null;
};

export async function obterFunil(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { de?: string; ate?: string; responsavelId?: string; agora: Date }
): Promise<RespostaFunil> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);
  const condicaoResponsavel: SQL = filtro.responsavelId ? sql`AND o.responsavel_id = ${filtro.responsavelId}::uuid` : sql``;
  const chegou = (etapa: number) => sql`EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${etapa})`;

  return comTenant(db, contexto, async (tx) => {
    const resultado = await tx.execute<Linha>(sql`
      WITH c AS (
        SELECT o.id, o.responsavel_id, o.valor
        FROM oportunidades o
        WHERE o.criado_em >= ${inicio.toISOString()}::timestamptz
          AND o.criado_em < ${fimExclusivo.toISOString()}::timestamptz
          ${condicaoResponsavel}
      ),
      f AS (
        SELECT c.id, c.responsavel_id, c.valor,
          EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = c.id
            AND ((e.tipo = 'atividade_concluida' AND e.payload ->> 'resultado' = 'conectou') OR e.tipo = 'conexao_whatsapp')) AS conectou,
          EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = c.id AND e.tipo = 'cadencia_iniciada') AS iniciou,
          EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = c.id AND e.tipo = 'cadencia_esgotada') AS esgotou,
          ${chegou(ETAPA_AGENDADA)} AS agendou,
          ${chegou(ETAPA_NO_SHOW)} AS faltou,
          ${chegou(ETAPA_REALIZADA)} AS realizou,
          ${chegou(ETAPA_PROPOSTA)} AS propos,
          ${chegou(ETAPA_GANHO)} AS ganhou
        FROM c
      )
      SELECT responsavel_id,
        count(*)::int AS total,
        count(*) FILTER (WHERE conectou)::int AS conectados,
        count(*) FILTER (WHERE iniciou)::int AS iniciaram,
        count(*) FILTER (WHERE iniciou AND esgotou)::int AS esgotadas,
        count(*) FILTER (WHERE agendou)::int AS agendadas,
        count(*) FILTER (WHERE faltou)::int AS no_shows,
        count(*) FILTER (WHERE realizou)::int AS realizadas,
        count(*) FILTER (WHERE propos)::int AS propostas,
        count(*) FILTER (WHERE ganhou)::int AS ganhos,
        coalesce(sum(valor) FILTER (WHERE ganhou), 0)::text AS receita
      FROM f
      GROUP BY responsavel_id
    `);

    const linhas = resultado.rows;
    const ids = linhas.map((l) => l.responsavel_id).filter((id): id is string => id !== null);
    const pessoas = ids.length
      ? await tx
          .select({ id: usuarios.id, nome: usuarios.nome, papel: empresasUsuarios.papel })
          .from(usuarios)
          .leftJoin(empresasUsuarios, and(eq(empresasUsuarios.usuarioId, usuarios.id), eq(empresasUsuarios.empresaId, contexto.empresaId)))
          .where(inArray(usuarios.id, ids))
      : [];
    const porId = new Map(pessoas.map((p) => [p.id, p]));

    const soma = (campo: keyof Linha) => linhas.reduce((acc, l) => acc + Number(l[campo] ?? 0), 0);
    const funil: FunilPorEtapa = {
      entrada: soma('total'),
      conectados: soma('conectados'),
      agendadas: soma('agendadas'),
      realizadas: soma('realizadas'),
      propostas: soma('propostas'),
      ganhos: soma('ganhos'),
    };

    const porResponsavel: DesempenhoDoResponsavel[] = linhas
      .map((l) => {
        const p = l.responsavel_id ? porId.get(l.responsavel_id) : undefined;
        return {
          responsavelId: l.responsavel_id,
          nome: p?.nome ?? null,
          papel: p?.papel ?? null,
          atendidos: l.total,
          cadenciaIniciada: l.iniciaram,
          cadenciaEsgotada: l.esgotadas,
          agendadas: l.agendadas,
          noShows: l.no_shows,
          propostas: l.propostas,
          contratos: l.ganhos,
          winRate: l.propostas > 0 ? l.ganhos / l.propostas : null,
          receitaGanha: Number(l.receita ?? 0),
        };
      })
      .sort((a, b) => b.receitaGanha - a.receitaGanha || b.atendidos - a.atendidos);

    return { funil, porResponsavel };
  });
}
