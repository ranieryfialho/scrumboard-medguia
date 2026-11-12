// T-202 (fase4-analises, US-134): relatório de marketing — leads criados no período,
// por origem, e quantos viraram conexão, reunião e contrato (ASM-190/ASM-191/ASM-196).
// Só da empresa da sessão. Não há custo nem mídia no sistema (Q-057): só o que o CRM sabe.
import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { chaveDoCanal, investimentoDoPeriodo, razao } from '../lib/investimento/calculo';
import { HORARIO_PADRAO, minutosCorridos, minutosUteis, resumirEsperas, type HorarioComercial, type ResumoDeEsperas } from '../domain/atendimento/horario-comercial';
import { comTenant } from './contexto';
import { lerHorarioNaTransacao } from './horario-atendimento';
import { lerInvestimentoNoPeriodo } from './investimento';
import { limitesDoPeriodo } from './kpis';

const ETAPA_AGENDADA = 8;
const ETAPA_REALIZADA = 10;
const ETAPA_GANHO = 15;
const ETAPA_PERDIDO = 14;
const ETAPA_NO_SHOW = 9;
const SEM_ORIGEM = 'Sem origem';

export type Agrupamento = 'dia' | 'semana' | 'mes';

/** Um lead da conta da velocidade do 1º contato (AC-826/AC-828). Datas em ISO; esperas em minutos. */
export interface LeadDaVelocidade {
  /** Card do lead (a oportunidade mais recente); `null` se o lead ainda não virou card. */
  oportunidadeId: string | null;
  lead: string;
  responsavel: string | null;
  entrada: string;
  primeiroContato: string;
  esperaCorrida: number;
  esperaComercial: number;
}

export interface LinhaDeOrigem {
  origem: string;
  leads: number;
  conectados: number;
  reunioesRealizadas: number;
  contratos: number;
  /** Fração 0–1 de contratos ÷ leads, ou `null` sem leads. */
  conversaoFinal: number | null;
  valorGanho: number;
  /** fase5-investimento-midia: `null` quando o canal não tem investimento no período (ou a origem é "Sem origem"). */
  investimento?: number | null;
  cpl?: number | null;
  cac?: number | null;
  roas?: number | null;
}

/** T-312: o desempenho de cada anúncio (`dados.anuncio` do lead, vindo do formulário/planilha) dentro de uma origem. */
export interface LinhaDeAnuncio {
  origem: string;
  anuncio: string;
  leads: number;
  contratos: number;
  conversaoFinal: number | null;
}

/** T-312: um lead do período, para a lista nominal. */
export interface LeadDoPeriodo {
  id: string;
  oportunidadeId: string | null;
  nome: string;
  etapa: string | null;
  etapaId: number | null;
  especialidade: string | null;
  origem: string;
  anuncio: string | null;
  criadoEm: string;
  observacoes: string | null;
  /** fase6-leads-da-velocidade (AC-829): o motivo gravado no card quando o lead está em Perdido; `null` nas demais etapas. */
  motivoDaPerda: string | null;
}

export const LIMITE_DE_LEADS_NA_LISTA = 500;

/** T-315: leads por especialidade do lead (`dados.especialidade`, do formulário/planilha) e o que viraram. */
export interface LinhaDeEspecialidade {
  especialidade: string;
  leads: number;
  contratos: number;
  /** Fração 0–1 dos leads do período. */
  participacao: number;
  /** Valor ganho ÷ contratos; `null` sem contrato. */
  ticketMedio: number | null;
}

/** T-315: comportamento do período: quando os leads chegam, a rapidez do 1º contato e as faltas. */
export interface InsightsDeMarketing {
  /** O dia (`YYYY-MM-DD`) com mais leads, quantos leads e quantos deles viraram reunião agendada. */
  diaDeMaisLeads: { dia: string; leads: number; agendadas: number } | null;
  /** A hora do dia (0–23, São Paulo) em que mais leads chegam. */
  melhorHora: number | null;
  /**
   * fase6-atendimento-lead: o tempo entre o lead chegar e a 1ª mensagem de WhatsApp enviada a ele pelo CRM, em relógio corrido e só
   * dentro do horário comercial da empresa (AC-784/AC-785). Cada resumo traz média, mediana, quantos leads entraram na conta e as
   * faixas de espera (AC-786). Lead sem mensagem enviada fica de fora da conta (AC-788).
   */
  velocidade: {
    corrido: ResumoDeEsperas;
    comercial: ResumoDeEsperas;
    horario: HorarioComercial;
    horarioPadrao: boolean;
    /** fase6-leads-da-velocidade (AC-828): os leads que entraram na conta, do que esperou mais ao que esperou menos. */
    leads: LeadDaVelocidade[];
  };
  /** No-show ÷ reuniões agendadas, entre os leads do período. */
  noShow: { taxa: number | null; noShows: number; agendadas: number };
}

/** fase6-perdas-por-lead (AC-819): dos leads captados no período, quantos já estão perdidos e por quê. */
export interface MotivosDosCaptados {
  perdidos: number;
  captados: number;
  motivos: { motivo: string; quantidade: number; percentual: number }[];
}

export interface RespostaMarketing {
  resumo: { leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null };
  /** AC-634/AC-637: `null` sem investimento cadastrado no período — a tela não mostra o bloco de custo. */
  custo: { investimento: number; cpl: number | null; cac: number | null; roas: number | null } | null;
  agrupar: Agrupamento;
  serie: { inicio: string; leads: number; reunioes: number }[];
  porOrigem: LinhaDeOrigem[];
  origens: string[];
  /** T-312: leads do período cujo card está em "Perdido". */
  desqualificados?: number;
  /** T-312: a origem com maior conversão final (empate: a de mais leads); `null` se nenhuma tem lead. */
  melhorCanal?: { origem: string; conversaoFinal: number | null } | null;
  porAnuncio?: LinhaDeAnuncio[];
  /** T-312: leads criados em cada dia da semana (0 = domingo … 6 = sábado), no fuso de São Paulo. */
  porDiaDaSemana?: number[];
  /** T-316: leads criados ANTES do período cujo card mudou de etapa DENTRO dele (a base antiga sendo trabalhada). */
  recuperacaoDeBase?: number;
  leadsDoPeriodo?: LeadDoPeriodo[];
  especialidades?: LinhaDeEspecialidade[];
  insights?: InsightsDeMarketing;
  /** AC-819: os motivos de perda dos leads captados no período. */
  motivosDosCaptados?: MotivosDosCaptados;
  /** T-320: as especialidades que existem nos leads, para o filtro. */
  especialidadesDisponiveis?: string[];
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

/** AC-634/AC-638: CPL, CAC e ROAS de uma linha; sem investimento no período a linha não leva os campos (AC-637); divisão por zero é `null`. */
function custoDaLinha(habilitado: boolean, investimento: number | undefined, leads: number, contratos: number, valorGanho: number, marcar: () => unknown) {
  if (!habilitado) return {};
  if (investimento === undefined || investimento <= 0) return { investimento: null, cpl: null, cac: null, roas: null };
  marcar();
  return { investimento, cpl: razao(investimento, leads), cac: razao(investimento, contratos), roas: razao(valorGanho, investimento) };
}

export async function obterMarketing(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { de?: string; ate?: string; origem?: string; especialidade?: string; agrupar?: Agrupamento; agora: Date }
): Promise<RespostaMarketing> {
  const { inicio, fimExclusivo } = limitesDoPeriodo(filtro.agora, filtro.de, filtro.ate);
  const periodo = periodoLocal(filtro.agora, filtro.de, filtro.ate);
  const agrupar = filtro.agrupar ?? agrupamentoPadrao(periodo.de, periodo.ate);
  const unidade = agrupar === 'mes' ? 'month' : agrupar === 'semana' ? 'week' : 'day';
  const origemDe = sql`coalesce(nullif(btrim(l.origem), ''), ${SEM_ORIGEM})`;
  const filtroDaOrigem: SQL = filtro.origem ? sql`AND lower(${origemDe}) = lower(${filtro.origem})` : sql``;
  // T-320: a especialidade do lead; "Sem especialidade informada" pega os leads que não a têm.
  const especialidadeDe = sql`coalesce(nullif(btrim(l.dados ->> 'especialidade'), ''), 'Sem especialidade informada')`;
  const filtroDaEspecialidade: SQL = filtro.especialidade ? sql`AND lower(${especialidadeDe}) = lower(${filtro.especialidade})` : sql``;
  const filtroOrigem: SQL = sql`${filtroDaOrigem} ${filtroDaEspecialidade}`;
  const chegou = (etapa: number) =>
    sql`EXISTS (SELECT 1 FROM oportunidades o JOIN oportunidade_eventos e ON e.oportunidade_id = o.id WHERE o.lead_id = l.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${etapa})`;

  return comTenant(db, contexto, async (tx) => {
    const porOrigemBruto = await tx.execute<{ origem: string; leads: number; conectados: number; realizadas: number; contratos: number; valor: string }>(sql`
      SELECT min(${origemDe}) AS origem,
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
      GROUP BY lower(${origemDe})
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

    // T-312: o que o painel de tráfego do sistema antigo mostrava, com os dados que o ETL guardou no lead.
    const etapaAtual = sql`(SELECT o.etapa_id FROM oportunidades o WHERE o.lead_id = l.id ORDER BY o.criado_em DESC LIMIT 1)`;
    const noPeriodo = sql`l.criado_em >= ${inicio.toISOString()}::timestamptz AND l.criado_em < ${fimExclusivo.toISOString()}::timestamptz`;
    const [{ desq }] = (
      await tx.execute<{ desq: number }>(sql`SELECT count(*) FILTER (WHERE ${etapaAtual} = ${ETAPA_PERDIDO})::int AS desq FROM leads l WHERE ${noPeriodo} ${filtroOrigem}`)
    ).rows;
    // AC-819: o card mais recente de cada lead captado no período, se está em Perdido, e o motivo gravado nele.
    const motivosBruto = await tx.execute<{ motivo: string; quantidade: number }>(sql`
      SELECT coalesce(m.nome, 'Sem motivo informado') AS motivo, count(*)::int AS quantidade
      FROM leads l
      JOIN LATERAL (SELECT o.etapa_id, o.motivo_perda_id FROM oportunidades o WHERE o.lead_id = l.id ORDER BY o.criado_em DESC LIMIT 1) ult ON ult.etapa_id = ${ETAPA_PERDIDO}
      LEFT JOIN motivos_perda m ON m.id = ult.motivo_perda_id
      WHERE ${noPeriodo} ${filtroOrigem}
      GROUP BY 1
      ORDER BY 2 DESC, 1
    `);
    const [{ antigos }] = (
      await tx.execute<{ antigos: number }>(sql`
        SELECT count(DISTINCT l.id)::int AS antigos
        FROM leads l
        JOIN oportunidades o ON o.lead_id = l.id
        JOIN oportunidade_eventos e ON e.oportunidade_id = o.id AND e.tipo = 'transicao_etapa'
        WHERE l.criado_em < ${inicio.toISOString()}::timestamptz
          AND e.ocorrido_em >= ${inicio.toISOString()}::timestamptz AND e.ocorrido_em < ${fimExclusivo.toISOString()}::timestamptz
          ${filtroOrigem}
      `)
    ).rows;
    const porAnuncioBruto = await tx.execute<{ origem: string; anuncio: string; leads: number; contratos: number }>(sql`
      SELECT min(${origemDe}) AS origem, coalesce(nullif(btrim(l.dados ->> 'anuncio'), ''), 'Sem anúncio') AS anuncio,
        count(*)::int AS leads, count(*) FILTER (WHERE ${chegou(ETAPA_GANHO)})::int AS contratos
      FROM leads l WHERE ${noPeriodo} ${filtroOrigem}
      GROUP BY lower(${origemDe}), 2 ORDER BY 3 DESC, 2 LIMIT 100
    `);
    const porDiaBruto = await tx.execute<{ dia: number; total: number }>(sql`
      SELECT extract(dow FROM l.criado_em AT TIME ZONE 'America/Sao_Paulo')::int AS dia, count(*)::int AS total
      FROM leads l WHERE ${noPeriodo} ${filtroOrigem} GROUP BY 1
    `);
    const leadsBruto = await tx.execute<{ id: string; opp: string | null; nome: string; etapa_id: number | null; etapa: string | null; especialidade: string | null; origem: string; anuncio: string | null; criado: string; obs: string | null; motivo: string | null }>(sql`
      SELECT l.id, (SELECT o.id FROM oportunidades o WHERE o.lead_id = l.id ORDER BY o.criado_em DESC LIMIT 1)::text AS opp,
        l.nome, ${etapaAtual} AS etapa_id,
        (SELECT pe.nome FROM pipeline_etapas pe WHERE pe.id = ${etapaAtual}) AS etapa,
        nullif(btrim(l.dados ->> 'especialidade'), '') AS especialidade, ${origemDe} AS origem,
        nullif(btrim(l.dados ->> 'anuncio'), '') AS anuncio, l.criado_em::text AS criado, nullif(btrim(l.dados ->> 'observacoes'), '') AS obs,
        (SELECT coalesce(m.nome, 'Sem motivo informado') FROM oportunidades o LEFT JOIN motivos_perda m ON m.id = o.motivo_perda_id
          WHERE o.lead_id = l.id AND o.etapa_id = ${ETAPA_PERDIDO} AND o.etapa_id = ${etapaAtual} ORDER BY o.criado_em DESC LIMIT 1) AS motivo
      FROM leads l WHERE ${noPeriodo} ${filtroOrigem}
      ORDER BY l.criado_em DESC LIMIT ${LIMITE_DE_LEADS_NA_LISTA}
    `);

    // T-315: especialidades e insights do período (dados do lead que o ETL guardou).
    const valorGanhoDoLead = sql`(SELECT coalesce(sum(o.valor), 0) FROM oportunidades o WHERE o.lead_id = l.id
      AND EXISTS (SELECT 1 FROM oportunidade_eventos e WHERE e.oportunidade_id = o.id AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_GANHO}))`;
    const especialidadesBruto = await tx.execute<{ nome: string; leads: number; contratos: number; valor: string }>(sql`
      SELECT coalesce(nullif(btrim(l.dados ->> 'especialidade'), ''), 'Sem especialidade informada') AS nome, count(*)::int AS leads,
        count(*) FILTER (WHERE ${chegou(ETAPA_GANHO)})::int AS contratos, coalesce(sum(${valorGanhoDoLead}), 0)::text AS valor
      FROM leads l WHERE ${noPeriodo} ${filtroOrigem} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12
    `);
    const [diaTop] = (
      await tx.execute<{ dia: string; leads: number; agendadas: number }>(sql`
        SELECT to_char(l.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia, count(*)::int AS leads, count(*) FILTER (WHERE ${chegou(ETAPA_AGENDADA)})::int AS agendadas
        FROM leads l WHERE ${noPeriodo} ${filtroOrigem} GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 1
      `)
    ).rows;
    const [horaTop] = (
      await tx.execute<{ hora: number }>(sql`
        SELECT extract(hour FROM l.criado_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora
        FROM leads l WHERE ${noPeriodo} ${filtroOrigem} GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1
      `)
    ).rows;
    // AC-788: só a 1ª mensagem enviada em ou depois da entrada conta; lead sem nenhuma fica fora (os migrados entram normalmente).
    const esperas = await tx.execute<{ lead: string; opp: string | null; responsavel: string | null; entrada: Date | string; primeira: Date | string }>(sql`
      SELECT l.nome AS lead, l.criado_em AS entrada, p.primeira,
        (SELECT o.id FROM oportunidades o WHERE o.lead_id = l.id ORDER BY o.criado_em DESC LIMIT 1)::text AS opp,
        (SELECT u.nome FROM oportunidades o JOIN usuarios u ON u.id = o.responsavel_id WHERE o.lead_id = l.id ORDER BY o.criado_em DESC LIMIT 1) AS responsavel
      FROM leads l
      JOIN LATERAL (SELECT min(w.criado_em) AS primeira FROM whatsapp_mensagens w WHERE w.lead_id = l.id AND w.direcao = 'enviada' AND w.criado_em >= l.criado_em) p ON p.primeira IS NOT NULL
      WHERE ${noPeriodo} ${filtroOrigem}
    `);
    const expediente = await lerHorarioNaTransacao(tx, contexto.empresaId);
    const leadsDaVelocidade: LeadDaVelocidade[] = esperas.rows
      .map((r) => {
        const entrada = new Date(r.entrada);
        const primeira = new Date(r.primeira);
        return {
          oportunidadeId: r.opp,
          lead: r.lead,
          responsavel: r.responsavel,
          entrada: entrada.toISOString(),
          primeiroContato: primeira.toISOString(),
          esperaCorrida: minutosCorridos(entrada, primeira),
          esperaComercial: minutosUteis(entrada, primeira, expediente.horario),
        };
      })
      .sort((a, b) => b.esperaCorrida - a.esperaCorrida);
    const velocidade = {
      corrido: resumirEsperas(leadsDaVelocidade.map((l) => l.esperaCorrida)),
      comercial: resumirEsperas(leadsDaVelocidade.map((l) => l.esperaComercial)),
      horario: expediente.horario ?? HORARIO_PADRAO,
      horarioPadrao: expediente.padrao,
      leads: leadsDaVelocidade,
    };
    const [faltas] = (
      await tx.execute<{ agendadas: number; no_shows: number }>(sql`
        SELECT count(*) FILTER (WHERE ${chegou(ETAPA_AGENDADA)})::int AS agendadas, count(*) FILTER (WHERE ${chegou(ETAPA_NO_SHOW)})::int AS no_shows
        FROM leads l WHERE ${noPeriodo} ${filtroOrigem}
      `)
    ).rows;

    const especialidadesExistentes = await tx.execute<{ nome: string }>(sql`
      SELECT DISTINCT btrim(l.dados ->> 'especialidade') AS nome FROM leads l WHERE nullif(btrim(l.dados ->> 'especialidade'), '') IS NOT NULL ORDER BY 1 LIMIT 100
    `);

    const origensExistentes = await tx.execute<{ origem: string }>(sql`
      SELECT min(${origemDe}) AS origem FROM leads l GROUP BY lower(${origemDe}) ORDER BY 1 LIMIT 100
    `);

    const investimentos = investimentoDoPeriodo(await lerInvestimentoNoPeriodo(tx, periodo.de, periodo.ate), periodo.de, periodo.ate);
    // O investimento é por canal, não por especialidade: com o filtro de especialidade o custo não se aplica.
    if (filtro.especialidade) investimentos.clear();
    if (filtro.origem) for (const chave of [...investimentos.keys()]) if (chave !== chaveDoCanal(filtro.origem)) investimentos.delete(chave);
    const usados = new Set<string>();

    const porOrigem: LinhaDeOrigem[] = porOrigemBruto.rows
      .map((r) => ({
        origem: r.origem,
        leads: r.leads,
        conectados: r.conectados,
        reunioesRealizadas: r.realizadas,
        contratos: r.contratos,
        conversaoFinal: r.leads > 0 ? r.contratos / r.leads : null,
        valorGanho: Number(r.valor),
        ...custoDaLinha(investimentos.size > 0, r.origem === SEM_ORIGEM ? undefined : investimentos.get(chaveDoCanal(r.origem))?.valor, r.leads, r.contratos, Number(r.valor), () => usados.add(chaveDoCanal(r.origem))),
      }))
      .sort((a, b) => b.leads - a.leads || a.origem.localeCompare(b.origem));

    // AC-636: canal com investimento e nenhum lead no período também aparece, com 0 leads.
    for (const [chave, inv] of investimentos) {
      if (usados.has(chave)) continue;
      porOrigem.push({ origem: inv.canal, leads: 0, conectados: 0, reunioesRealizadas: 0, contratos: 0, conversaoFinal: null, valorGanho: 0, ...custoDaLinha(true, inv.valor, 0, 0, 0, () => undefined) });
    }
    const investimentoTotal = Math.round([...investimentos.values()].reduce((s, i) => s + i.valor, 0) * 100) / 100;

    const soma = (campo: 'leads' | 'conectados' | 'reunioesRealizadas' | 'contratos') => porOrigem.reduce((acc, l) => acc + l[campo], 0);
    const leads = soma('leads');
    const mapaLeads = new Map(leadsPorIntervalo.rows.map((r) => [r.inicio, r.total]));
    const mapaReunioes = new Map(reunioesPorIntervalo.rows.map((r) => [r.inicio, r.total]));

    const candidatas = porOrigem.filter((l) => l.leads > 0 && l.origem !== SEM_ORIGEM);
    const melhor = [...candidatas].sort((a, b) => (b.conversaoFinal ?? 0) - (a.conversaoFinal ?? 0) || b.leads - a.leads)[0];
    const porDiaDaSemana = Array.from({ length: 7 }, (_, d) => porDiaBruto.rows.find((r) => r.dia === d)?.total ?? 0);

    return {
      resumo: { leads, conectados: soma('conectados'), reunioesRealizadas: soma('reunioesRealizadas'), contratos: soma('contratos'), conversaoFinal: leads > 0 ? soma('contratos') / leads : null },
      custo:
        investimentoTotal > 0
          ? {
              investimento: investimentoTotal,
              cpl: razao(investimentoTotal, leads),
              cac: razao(investimentoTotal, soma('contratos')),
              roas: razao(porOrigem.reduce((s, l) => s + l.valorGanho, 0), investimentoTotal),
            }
          : null,
      agrupar,
      serie: intervalos(periodo.de, periodo.ate, agrupar).map((inicioDoIntervalo) => ({
        inicio: inicioDoIntervalo,
        leads: mapaLeads.get(inicioDoIntervalo) ?? 0,
        reunioes: mapaReunioes.get(inicioDoIntervalo) ?? 0,
      })),
      porOrigem,
      origens: origensExistentes.rows.map((r) => r.origem),
      desqualificados: desq,
      melhorCanal: melhor ? { origem: melhor.origem, conversaoFinal: melhor.conversaoFinal } : null,
      porAnuncio: porAnuncioBruto.rows.map((r) => ({ origem: r.origem, anuncio: r.anuncio, leads: r.leads, contratos: r.contratos, conversaoFinal: r.leads > 0 ? r.contratos / r.leads : null })),
      porDiaDaSemana,
      recuperacaoDeBase: antigos,
      especialidades: especialidadesBruto.rows.map((r) => ({
        especialidade: r.nome,
        leads: r.leads,
        contratos: r.contratos,
        participacao: leads > 0 ? r.leads / leads : 0,
        ticketMedio: r.contratos > 0 ? Number(r.valor) / r.contratos : null,
      })),
      motivosDosCaptados: (() => {
        const perdidos = motivosBruto.rows.reduce((soma, r) => soma + r.quantidade, 0);
        return {
          perdidos,
          captados: leads,
          motivos: motivosBruto.rows.map((r) => ({ motivo: r.motivo, quantidade: r.quantidade, percentual: perdidos > 0 ? Math.round((r.quantidade / perdidos) * 1000) / 10 : 0 })),
        };
      })(),
      especialidadesDisponiveis: especialidadesExistentes.rows.map((r) => r.nome),
      insights: {
        diaDeMaisLeads: diaTop ? { dia: diaTop.dia, leads: diaTop.leads, agendadas: diaTop.agendadas } : null,
        melhorHora: horaTop ? horaTop.hora : null,
        velocidade,
        noShow: { taxa: faltas && faltas.agendadas > 0 ? faltas.no_shows / faltas.agendadas : null, noShows: faltas?.no_shows ?? 0, agendadas: faltas?.agendadas ?? 0 },
      },
      leadsDoPeriodo: leadsBruto.rows.map((r) => ({
        id: r.id,
        oportunidadeId: r.opp,
        nome: r.nome,
        etapa: r.etapa,
        etapaId: r.etapa_id,
        especialidade: r.especialidade,
        origem: r.origem,
        anuncio: r.anuncio,
        criadoEm: new Date(r.criado).toISOString(),
        observacoes: r.obs,
        motivoDaPerda: r.motivo,
      })),
    };
  });
}
