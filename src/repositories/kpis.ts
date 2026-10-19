// T-101 (fase2d-kpis, US-061/US-062): repositório dos indicadores do funil
// comercial (PRD-001 §6), calculados sobre o log append-only
// `oportunidade_eventos` — nenhum número aqui vem de uma coluna derivada ou
// de cache, sempre de `EXISTS`/`count` contra os eventos do card (AC-221 a
// AC-225).
//
// ASM-069: o período filtra pela coorte — `oportunidades.criado_em` — nunca
// pela data dos eventos; os eventos de cada card são lidos sem limite de
// data. ASM-070: "chegou à etapa X" é `EXISTS` de um `transicao_etapa` com
// `etapa_destino_id = X`, por isso reaberturas/retornos nunca contam duas
// vezes (um card ou chegou, ou não — nunca "quantas vezes"). ASM-071:
// "conectado" é `atividade_concluida` com `payload->>'resultado' =
// 'conectou'` OU `conexao_whatsapp`; "iniciou cadência" é `cadencia_iniciada`;
// "cadência esgotada" é `cadencia_esgotada`.
//
// Tudo roda numa única consulta SQL por chamada, dentro de `comTenant`
// (T-040) — é o RLS (0001), não um filtro manual aqui, quem garante AC-228
// (isolamento entre empresas): a CTE `cohort` nem tenta restringir por
// `empresa_id`, porque a policy de RLS já limita toda leitura de
// `oportunidades`/`oportunidade_eventos` ao tenant de `app.empresa_id`.
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

// Etapas do seed de T-019 (drizzle/0005_seeds.sql) — mesma numeração fixa de
// ASM-070.
const ETAPA_REUNIAO_AGENDADA = 8;
const ETAPA_NO_SHOW = 9;
const ETAPA_REUNIAO_REALIZADA = 10;
const ETAPA_PROPOSTA = 11;
const ETAPA_TESTE_TRIAL = 12;
const ETAPA_CONTRATO_GANHO = 15;

export interface FiltroKpis {
  /** Data inicial do período (`YYYY-MM-DD`, inclusiva). Omitida junto com `ate`: mês corrente (AC-226). */
  de?: string;
  /** Data final do período (`YYYY-MM-DD`, inclusiva — AC-226). */
  ate?: string;
  /** Restringe a coorte aos cards deste responsável (AC-227). */
  responsavelId?: string;
  /** Relógio injetado (ASM-062, mesmo padrão de cadencia.ts) — só usado para o padrão "mês corrente". */
  agora: Date;
}

/** Um indicador do funil: sempre os três campos juntos, para a conta poder ser conferida (AC-225). */
export interface Indicador {
  /** Fração 0–1, ou `null` quando o denominador é zero (AC-224) — nunca 0% nem erro. */
  valor: number | null;
  numerador: number;
  denominador: number;
}

export interface RespostaKpis {
  /** AC-221: taxa de conexão (reach rate). */
  conexao: Indicador;
  /** AC-222: cumprimento da régua de 18 toques. */
  cumprimentoCadencia: Indicador;
  /** AC-223: agendamento = com "Reunião agendada" ÷ conectados. */
  agendamento: Indicador;
  /** AC-223: no-show = com "No-show" ÷ com "Reunião agendada". */
  noShow: Indicador;
  /** AC-223: proposta = com "Proposta" ÷ com "Reunião realizada". */
  proposta: Indicador;
  /** Q-023: sem fonte de dados ainda — sempre `valor: null`, numerador 0. */
  ativacaoTrial: Indicador;
  /** AC-223: conversão (win rate) = com "Contrato (Ganho)" ÷ com "Proposta". */
  conversao: Indicador;
}

interface DataCalendario {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Converte `YYYY-MM-DD` nos componentes de calendário. Assume entrada já
 * validada — a validação de formato (AC-230) é responsabilidade da rota
 * (T-102), não deste repositório.
 */
function parseData(data: string): DataCalendario {
  const match = FORMATO_DATA.exec(data);
  if (!match) {
    throw new Error(`Data "${data}" fora do formato YYYY-MM-DD.`);
  }
  return { ano: Number(match[1]), mes: Number(match[2]), dia: Number(match[3]) };
}

/** Dia seguinte, em componentes de calendário (sem fuso — só aritmética de data). */
function diaSeguinte({ ano, mes, dia }: DataCalendario): DataCalendario {
  const proximo = new Date(Date.UTC(ano, mes - 1, dia + 1));
  return { ano: proximo.getUTCFullYear(), mes: proximo.getUTCMonth() + 1, dia: proximo.getUTCDate() };
}

/** Primeiro dia do mês seguinte a `ano`/`mes` (1-12). */
function primeiroDiaDoProximoMes(ano: number, mes: number): DataCalendario {
  const proximo = new Date(Date.UTC(ano, mes, 1));
  return { ano: proximo.getUTCFullYear(), mes: proximo.getUTCMonth() + 1, dia: 1 };
}

/**
 * Meia-noite de `data` em `America/Sao_Paulo`, como instante UTC. O fuso não
 * observa horário de verão desde 2019 (mesmo comentário de
 * `inicioDoTurnoDeReferencia` em cadencia.ts), então hora local + 3h é
 * sempre a hora UTC do mesmo dia-calendário.
 */
function instanteInicioDoDia({ ano, mes, dia }: DataCalendario): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, 3, 0, 0, 0));
}

/**
 * AC-226: resolve o intervalo `[inicio, fimExclusivo)` em instantes UTC a
 * partir de `de`/`ate` (`America/Sao_Paulo`, `ate` inclusivo). Sem `de` nem
 * `ate`, o padrão é o mês corrente de `agora` (também em `America/Sao_Paulo`).
 */
export function limitesDoPeriodo(agora: Date, de?: string, ate?: string): { inicio: Date; fimExclusivo: Date } {
  const hoje = dataLocalEmSaoPaulo(agora);
  const inicioPadrao: DataCalendario = { ano: hoje.ano, mes: hoje.mes, dia: 1 };
  const fimPadrao = primeiroDiaDoProximoMes(hoje.ano, hoje.mes);

  const inicioData = de ? parseData(de) : inicioPadrao;
  const fimExclusivoData = ate ? diaSeguinte(parseData(ate)) : fimPadrao;

  return {
    inicio: instanteInicioDoDia(inicioData),
    fimExclusivo: instanteInicioDoDia(fimExclusivoData),
  };
}

function calcularIndicador(numerador: number, denominador: number): Indicador {
  // AC-224: denominador zero nunca divide — volta sem valor, nunca 0% nem erro.
  if (denominador === 0) {
    return { valor: null, numerador: 0, denominador: 0 };
  }
  return { valor: numerador / denominador, numerador, denominador };
}

interface LinhaAgregada {
  [coluna: string]: number;
  total: number;
  conectados: number;
  iniciaramCadencia: number;
  cadenciaEsgotada: number;
  chegouAgendada: number;
  chegouNoShow: number;
  chegouRealizada: number;
  chegouProposta: number;
  chegouTrial: number;
  chegouGanho: number;
}

/**
 * Calcula os indicadores do funil (US-061) sobre `oportunidade_eventos`,
 * restritos à coorte de cards criados no período (ASM-069) e, se informado,
 * a um único responsável (AC-227). O isolamento entre empresas (AC-228) é
 * inteiramente do RLS, via `comTenant`.
 */
export async function obterKpis(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroKpis
): Promise<RespostaKpis> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);

  const condicaoResponsavel: SQL = filtro.responsavelId
    ? sql`AND o.responsavel_id = ${filtro.responsavelId}::uuid`
    : sql``;

  return comTenant(db, contexto, async (tx) => {
    const resultado = await tx.execute<LinhaAgregada>(sql`
      WITH cohort AS (
        SELECT o.id
        FROM oportunidades o
        WHERE o.criado_em >= ${inicio.toISOString()}::timestamptz
          AND o.criado_em < ${fimExclusivo.toISOString()}::timestamptz
          ${condicaoResponsavel}
      ),
      flags AS (
        SELECT
          c.id,
          -- ASM-071: conectado = atividade_concluida/conectou OU conexao_whatsapp.
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id
              AND (
                (e.tipo = 'atividade_concluida' AND e.payload ->> 'resultado' = 'conectou')
                OR e.tipo = 'conexao_whatsapp'
              )
          ) AS conectou,
          -- ASM-071: iniciou cadência = evento cadencia_iniciada.
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'cadencia_iniciada'
          ) AS iniciou_cadencia,
          -- ASM-071: cadência esgotada = evento cadencia_esgotada.
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'cadencia_esgotada'
          ) AS cadencia_esgotada,
          -- ASM-070: "chegou à etapa X" = transicao_etapa com etapa_destino_id = X.
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_REUNIAO_AGENDADA}
          ) AS chegou_agendada,
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_NO_SHOW}
          ) AS chegou_no_show,
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_REUNIAO_REALIZADA}
          ) AS chegou_realizada,
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_PROPOSTA}
          ) AS chegou_proposta,
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_TESTE_TRIAL}
          ) AS chegou_trial,
          EXISTS (
            SELECT 1 FROM oportunidade_eventos e
            WHERE e.oportunidade_id = c.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_CONTRATO_GANHO}
          ) AS chegou_ganho
        FROM cohort c
      )
      SELECT
        count(*)::int AS "total",
        count(*) FILTER (WHERE conectou)::int AS "conectados",
        count(*) FILTER (WHERE iniciou_cadencia)::int AS "iniciaramCadencia",
        count(*) FILTER (WHERE iniciou_cadencia AND cadencia_esgotada)::int AS "cadenciaEsgotada",
        count(*) FILTER (WHERE chegou_agendada)::int AS "chegouAgendada",
        count(*) FILTER (WHERE chegou_no_show)::int AS "chegouNoShow",
        count(*) FILTER (WHERE chegou_realizada)::int AS "chegouRealizada",
        count(*) FILTER (WHERE chegou_proposta)::int AS "chegouProposta",
        count(*) FILTER (WHERE chegou_trial)::int AS "chegouTrial",
        count(*) FILTER (WHERE chegou_ganho)::int AS "chegouGanho"
      FROM flags
    `);

    const linha: LinhaAgregada = resultado.rows[0] ?? {
      total: 0,
      conectados: 0,
      iniciaramCadencia: 0,
      cadenciaEsgotada: 0,
      chegouAgendada: 0,
      chegouNoShow: 0,
      chegouRealizada: 0,
      chegouProposta: 0,
      chegouTrial: 0,
      chegouGanho: 0,
    };

    return {
      conexao: calcularIndicador(linha.conectados, linha.total),
      cumprimentoCadencia: calcularIndicador(linha.cadenciaEsgotada, linha.iniciaramCadencia),
      agendamento: calcularIndicador(linha.chegouAgendada, linha.conectados),
      noShow: calcularIndicador(linha.chegouNoShow, linha.chegouAgendada),
      proposta: calcularIndicador(linha.chegouProposta, linha.chegouRealizada),
      // Q-023: sem fonte de dados ainda — numerador fica 0, denominador é
      // quem chegou a "Teste (Trial)" (ASM-070), valor sempre null.
      ativacaoTrial: { valor: null, numerador: 0, denominador: linha.chegouTrial },
      conversao: calcularIndicador(linha.chegouGanho, linha.chegouProposta),
    };
  });
}
