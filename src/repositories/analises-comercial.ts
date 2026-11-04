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

const ETAPA_QUALIFICADO = 6;
const ETAPA_REALIZADA = 10;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_GANHO = 15;
const ETAPAS_EM_NEGOCIACAO = [11, 12, 13];
const SEM_MOTIVO = 'Sem motivo informado';
/** T-319: origem de prospecção ativa (outbound); qualquer outra é tratada como inbound. */
const ORIGEM_OUTBOUND = /outbound|prospec|cold/i;

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
  /** T-319: cards do responsável que chegaram a "Qualificado p/ reunião" no período (os SQLs). */
  sqls: number;
  /** T-319: foto do usuário (`usuarios.imagem`), quando existe. */
  imagem: string | null;
}

/** T-317: receita fechada por especialidade do lead (`dados.especialidade`) no período. */
export interface LinhaDeEspecialidadeComercial {
  especialidade: string;
  contratos: number;
  valor: number;
  /** Fração 0–1 dos contratos do período. */
  participacao: number;
}

/** T-317: o que os contratos do período mostram de comportamento do fechamento. */
export interface InsightsComerciais {
  /** O dia da semana (0 = domingo … 6 = sábado) com mais contratos assinados, quantos e a fração do total. */
  melhorDiaDeFechamento: { dia: number; contratos: number; participacao: number } | null;
  /** A especialidade com maior ticket médio entre os contratos do período. */
  ticketCampeao: { especialidade: string; ticketMedio: number; contratos: number } | null;
  /** Média de dias entre a proposta e a assinatura, nos contratos que passaram por "Proposta". */
  propostaAteAssinaturaDias: number | null;
  /** T-319: desconto médio (%) dos contratos do período que têm desconto informado na proposta; `null` se nenhum tem. */
  descontoMedio: { percentual: number; contratosComDesconto: number } | null;
  /** T-319: ciclo médio (dias) dos contratos por tipo de origem do lead: outbound (prospecção ativa) ou inbound (os demais). */
  cicloPorTipo: { inbound: { contratos: number; cicloMedioDias: number | null }; outbound: { contratos: number; cicloMedioDias: number | null } };
}

/** T-314: uma opção do fechamento de clientes e quantos contratos a escolheram. */
export interface ContagemDeFechamento {
  nome: string;
  quantidade: number;
  percentual: number;
}

/** T-314: o que os clientes que fecharam no período responderam no "Fechamento de Clientes" (só dos contratos que têm o registro). */
export interface ResumoDeFechamentos {
  registrados: number;
  semRegistro: number;
  plataformas: ContagemDeFechamento[];
  motivos: ContagemDeFechamento[];
  planos: ContagemDeFechamento[];
  origens: ContagemDeFechamento[];
}

export interface RespostaComercial {
  resumo: {
    mrrNovo: number;
    contratos: number;
    ticketMedio: number | null;
    pipelineEmNegociacao: { valor: number; propostas: number; /** T-319: o pipeline × win rate do período; `null` sem ganhos nem perdas. */ ponderado?: number | null };
    cicloMedioDias: number | null;
    winRate: { valor: number | null; ganhos: number; perdas: number };
  };
  semanal: { inicio: string; valorFechado: number; pipelineCriado: number }[];
  ranking: LinhaDoRanking[];
  motivosPerda: { motivo: string; quantidade: number; percentual: number }[];
  totalPerdas: number;
  fechamentos?: ResumoDeFechamentos;
  /** T-320: as especialidades que existem nos leads, para o filtro. */
  especialidadesDisponiveis?: string[];
  porEspecialidade?: LinhaDeEspecialidadeComercial[];
  insights?: InsightsComerciais;
}

type Evento = {
  oportunidade_id: string;
  etapa: number;
  responsavel_id: string | null;
  valor: string | null;
  ciclo_dias: number;
  semana: string;
  motivo: string | null;
  dia_semana: number;
  dias_proposta: number | null;
  especialidade: string | null;
  origem_lead: string | null;
  desconto: string | null;
};

const media = (valores: number[]): number | null => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);
const arredondar = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

export async function obterComercial(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { de?: string; ate?: string; responsavelId?: string; especialidade?: string; agora: Date }
): Promise<RespostaComercial> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);
  const periodo = periodoLocal(filtro.agora, filtro.de, filtro.ate);
  const doResponsavel: SQL = filtro.responsavelId ? sql`AND o.responsavel_id = ${filtro.responsavelId}::uuid` : sql``;
  // T-320: a especialidade do lead; "Sem especialidade informada" pega os leads que não a têm.
  const daEspecialidade: SQL = filtro.especialidade
    ? sql`AND lower(coalesce(nullif(btrim(ld.dados ->> 'especialidade'), ''), 'Sem especialidade informada')) = lower(${filtro.especialidade})`
    : sql``;

  return comTenant(db, contexto, async (tx) => {
    const eventos = await tx.execute<Evento>(sql`
      SELECT DISTINCT ON (e.oportunidade_id, e.etapa_destino_id)
        e.oportunidade_id, e.etapa_destino_id AS etapa, o.responsavel_id, o.valor::text AS valor,
        extract(epoch FROM (e.ocorrido_em - o.criado_em)) / 86400.0 AS ciclo_dias,
        to_char(date_trunc('week', e.ocorrido_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS semana,
        CASE WHEN e.etapa_destino_id = ${ETAPA_PERDIDO} THEN coalesce(m.nome, ${SEM_MOTIVO}) END AS motivo,
        extract(dow FROM e.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS dia_semana,
        (SELECT extract(epoch FROM (e.ocorrido_em - p.ocorrido_em)) / 86400.0 FROM oportunidade_eventos p
          WHERE p.oportunidade_id = e.oportunidade_id AND p.tipo = 'transicao_etapa' AND p.etapa_destino_id = ${ETAPA_PROPOSTA} AND p.ocorrido_em <= e.ocorrido_em
          ORDER BY p.ocorrido_em LIMIT 1) AS dias_proposta,
        nullif(btrim(ld.dados ->> 'especialidade'), '') AS especialidade,
        ld.origem AS origem_lead,
        oc.desconto_percentual::text AS desconto
      FROM oportunidade_eventos e
      JOIN oportunidades o ON o.id = e.oportunidade_id
      JOIN leads ld ON ld.id = o.lead_id
      LEFT JOIN oportunidade_comercial oc ON oc.oportunidade_id = o.id
      LEFT JOIN motivos_perda m ON m.id = o.motivo_perda_id
      WHERE e.tipo = 'transicao_etapa'
        AND e.etapa_destino_id IN (${ETAPA_QUALIFICADO}, ${ETAPA_REALIZADA}, ${ETAPA_PROPOSTA}, ${ETAPA_PERDIDO}, ${ETAPA_GANHO})
        AND e.ocorrido_em >= ${inicio.toISOString()}::timestamptz AND e.ocorrido_em < ${fimExclusivo.toISOString()}::timestamptz
        ${doResponsavel} ${daEspecialidade}
      ORDER BY e.oportunidade_id, e.etapa_destino_id, e.ocorrido_em
    `);

    const emNegociacao = await tx.execute<{ valor: string; total: number }>(sql`
      SELECT coalesce(sum(o.valor), 0)::text AS valor, count(*)::int AS total
      FROM oportunidades o
      JOIN leads ld ON ld.id = o.lead_id
      WHERE o.etapa_id IN (${sql.join(ETAPAS_EM_NEGOCIACAO.map((e) => sql`${e}`), sql`, `)}) ${doResponsavel} ${daEspecialidade}
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
    const usuariosDoRanking = ids.length ? await tx.select({ id: usuarios.id, nome: usuarios.nome, imagem: usuarios.imagem }).from(usuarios).where(inArray(usuarios.id, ids)) : [];
    const nomes = new Map(usuariosDoRanking.map((u) => [u.id, u.nome]));
    const imagens = new Map(usuariosDoRanking.map((u) => [u.id, u.imagem]));
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
          sqls: dele.filter((e) => e.etapa === ETAPA_QUALIFICADO).length,
          imagem: responsavelId ? (imagens.get(responsavelId) ?? null) : null,
        };
      })
      .sort((a, b) => b.valorFechado - a.valorFechado || b.contratos - a.contratos);

    // T-314: as respostas do fechamento dos contratos ganhos no período.
    const idsGanhos = [...new Set(ganhos.map((e) => e.oportunidade_id))];
    const respostas = idsGanhos.length
      ? (
          await tx.execute<{ plataforma_anterior: string; deixou_a_desejar: string; plano: string; por_onde_conheceu: string }>(sql`
            SELECT plataforma_anterior, deixou_a_desejar, plano, por_onde_conheceu
            FROM oportunidade_fechamento WHERE oportunidade_id IN (${sql.join(idsGanhos.map((i) => sql`${i}::uuid`), sql`, `)})
          `)
        ).rows
      : [];
    const contar = (valores: string[]): ContagemDeFechamento[] => {
      const mapa = new Map<string, number>();
      for (const v of valores) mapa.set(v, (mapa.get(v) ?? 0) + 1);
      return [...mapa.entries()]
        .map(([nome, quantidade]) => ({ nome, quantidade, percentual: valores.length ? Math.round((quantidade / valores.length) * 1000) / 10 : 0 }))
        .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));
    };
    const fechamentos: ResumoDeFechamentos = {
      registrados: respostas.length,
      semRegistro: idsGanhos.length - respostas.length,
      plataformas: contar(respostas.map((r) => r.plataforma_anterior)),
      motivos: contar(respostas.map((r) => r.deixou_a_desejar)),
      planos: contar(respostas.map((r) => r.plano)),
      origens: contar(respostas.map((r) => r.por_onde_conheceu)),
    };

    // T-317: receita por especialidade e o comportamento do fechamento (dia da semana, ticket campeão, proposta até a assinatura).
    const porEsp = new Map<string, { contratos: number; valor: number }>();
    for (const e of ganhos) {
      const nome = e.especialidade ?? 'Sem especialidade informada';
      const atual = porEsp.get(nome) ?? { contratos: 0, valor: 0 };
      atual.contratos += 1;
      atual.valor += valorDe(e);
      porEsp.set(nome, atual);
    }
    const porEspecialidade: LinhaDeEspecialidadeComercial[] = [...porEsp.entries()]
      .map(([especialidade, v]) => ({ especialidade, contratos: v.contratos, valor: v.valor, participacao: ganhos.length ? v.contratos / ganhos.length : 0 }))
      .sort((a, b) => b.valor - a.valor || a.especialidade.localeCompare(b.especialidade));
    const porDia = new Map<number, number>();
    for (const e of ganhos) porDia.set(e.dia_semana, (porDia.get(e.dia_semana) ?? 0) + 1);
    const diaTop = [...porDia.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const campeao = porEspecialidade.filter((l) => l.especialidade !== 'Sem especialidade informada').sort((a, b) => b.valor / b.contratos - a.valor / a.contratos)[0];
    const insights: InsightsComerciais = {
      melhorDiaDeFechamento: diaTop ? { dia: diaTop[0], contratos: diaTop[1], participacao: diaTop[1] / ganhos.length } : null,
      ticketCampeao: campeao ? { especialidade: campeao.especialidade, ticketMedio: campeao.valor / campeao.contratos, contratos: campeao.contratos } : null,
      propostaAteAssinaturaDias: arredondar(media(ganhos.filter((e) => e.dias_proposta !== null).map((e) => Number(e.dias_proposta)))),
      descontoMedio: (() => {
        const com = ganhos.filter((e) => e.desconto !== null).map((e) => Number(e.desconto));
        return com.length ? { percentual: Math.round((com.reduce((a, b) => a + b, 0) / com.length) * 10) / 10, contratosComDesconto: com.length } : null;
      })(),
      cicloPorTipo: (() => {
        const resumir = (lista: Evento[]) => ({ contratos: lista.length, cicloMedioDias: arredondar(media(lista.map((e) => Number(e.ciclo_dias)))) });
        return { outbound: resumir(ganhos.filter((e) => ORIGEM_OUTBOUND.test(e.origem_lead ?? ''))), inbound: resumir(ganhos.filter((e) => !ORIGEM_OUTBOUND.test(e.origem_lead ?? ''))) };
      })(),
    };

    const porMotivo = new Map<string, number>();
    for (const e of perdas) porMotivo.set(e.motivo ?? SEM_MOTIVO, (porMotivo.get(e.motivo ?? SEM_MOTIVO) ?? 0) + 1);

    return {
      resumo: {
        mrrNovo,
        contratos: ganhos.length,
        ticketMedio: ganhos.length ? mrrNovo / ganhos.length : null,
        pipelineEmNegociacao: {
          valor: Number(emNegociacao.rows[0]?.valor ?? 0),
          propostas: emNegociacao.rows[0]?.total ?? 0,
          ponderado: taxa(ganhos.length, perdas.length) === null ? null : Number(emNegociacao.rows[0]?.valor ?? 0) * (taxa(ganhos.length, perdas.length) as number),
        },
        cicloMedioDias: arredondar(media(ganhos.map((e) => Number(e.ciclo_dias)))),
        winRate: { valor: taxa(ganhos.length, perdas.length), ganhos: ganhos.length, perdas: perdas.length },
      },
      semanal: intervalos(periodo.de, periodo.ate, 'semana').map((s) => ({ inicio: s, valorFechado: semanaDe.get(s)?.valorFechado ?? 0, pipelineCriado: semanaDe.get(s)?.pipelineCriado ?? 0 })),
      ranking,
      motivosPerda: [...porMotivo.entries()]
        .map(([motivo, quantidade]) => ({ motivo, quantidade, percentual: perdas.length ? Math.round((quantidade / perdas.length) * 1000) / 10 : 0 }))
        .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo)),
      totalPerdas: perdas.length,
      fechamentos,
      porEspecialidade,
      insights,
      especialidadesDisponiveis: (
        await tx.execute<{ nome: string }>(sql`SELECT DISTINCT btrim(dados ->> 'especialidade') AS nome FROM leads WHERE nullif(btrim(dados ->> 'especialidade'), '') IS NOT NULL ORDER BY 1 LIMIT 100`)
      ).rows.map((r) => r.nome),
    };
  });
}
