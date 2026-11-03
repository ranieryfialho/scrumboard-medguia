// T-184 (fase4-tarefas-agenda, US-121): leitura das reuniões e dos indicadores
// da agenda. A tabela `reunioes` já existe (fase 1); o status é derivado
// (`src/lib/reunioes/status.ts`). Sempre por empresa (RLS + filtro explícito);
// `somenteResponsavelId` restringe aos cards de um ATENDENTE (ASM-163).
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades, reunioes, usuarios } from '../db/schema';
import { dataLocalEmSaoPaulo, dataLocalISO } from '../domain/cadencia/turno';
import { statusDaReuniao, type StatusReuniao } from '../lib/reunioes/status';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const ETAPA_QUALIFICADO_P_REUNIAO = 6;
export const ETAPA_REUNIAO_AGENDADA = 8;
export const ETAPA_NO_SHOW = 9;
export const ETAPA_REUNIAO_REALIZADA = 10;

export interface ReuniaoDaAgenda {
  id: string;
  oportunidadeId: string;
  agendadaPara: string;
  status: StatusReuniao;
  encerradaEm: string | null;
  noShow: boolean;
  resumo: string | null;
  anexoId: string | null;
  remarcadaDe: string | null;
  lead: { id: string; nome: string; telefoneE164: string | null };
  valor: string | null;
  etapaId: number;
  version: number;
  closer: { id: string; nome: string } | null;
  /** T-301 (AC-765): o link da sala do Meet, quando o Google está conectado e a sala foi criada. */
  meetUrl: string | null;
}

/** Início (inclusive) de um dia `YYYY-MM-DD` de São Paulo, em UTC. */
export function inicioDoDiaSP(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, 3));
}

export function diaValido(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(inicioDoDiaSP(valor).getTime());
}

export interface FiltroReunioes {
  /** Dia inicial e final (inclusive), `YYYY-MM-DD` em São Paulo. */
  de: string;
  ate: string;
  closerId?: string;
  status?: StatusReuniao;
  somenteResponsavelId?: string;
  agora: Date;
}

const COLUNAS = {
  reuniao: reunioes,
  leadId: leads.id,
  leadNome: leads.nome,
  leadTelefone: leads.telefoneE164,
  valor: oportunidades.valor,
  etapaId: oportunidades.etapaId,
  version: oportunidades.version,
  responsavelId: oportunidades.responsavelId,
  closerNome: usuarios.nome,
  temRemarcacao: sql<boolean>`exists (select 1 from reunioes r2 where r2.remarcada_de = "reunioes"."id")`,
};

type Linha = {
  reuniao: typeof reunioes.$inferSelect;
  leadId: string;
  leadNome: string;
  leadTelefone: string | null;
  valor: string | null;
  etapaId: number;
  version: number;
  responsavelId: string | null;
  closerNome: string | null;
  temRemarcacao: boolean;
};

function paraAgenda(l: Linha, agora: Date): ReuniaoDaAgenda {
  const r = l.reuniao;
  return {
    id: r.id,
    oportunidadeId: r.oportunidadeId,
    agendadaPara: r.agendadaPara.toISOString(),
    status: statusDaReuniao(
      { agendadaPara: r.agendadaPara, encerradaEm: r.encerradaEm, noShow: r.noShow, temRemarcacao: l.temRemarcacao },
      agora
    ),
    encerradaEm: r.encerradaEm?.toISOString() ?? null,
    noShow: r.noShow,
    resumo: r.resumo,
    anexoId: r.anexoId,
    remarcadaDe: r.remarcadaDe,
    lead: { id: l.leadId, nome: l.leadNome, telefoneE164: l.leadTelefone },
    valor: l.valor,
    etapaId: l.etapaId,
    version: l.version,
    closer: l.responsavelId && l.closerNome ? { id: l.responsavelId, nome: l.closerNome } : null,
    meetUrl: r.meetUrl,
  };
}

export async function listarReunioes(db: NodePgDatabase, contexto: ContextoTenant, filtro: FiltroReunioes): Promise<ReuniaoDaAgenda[]> {
  const inicio = inicioDoDiaSP(filtro.de);
  const fim = new Date(inicioDoDiaSP(filtro.ate).getTime() + 24 * 3600_000);

  return comTenant(db, contexto, async (tx) => {
    const condicoes: SQL[] = [
      eq(reunioes.empresaId, contexto.empresaId),
      eq(oportunidades.empresaId, contexto.empresaId),
      gte(reunioes.agendadaPara, inicio),
      lt(reunioes.agendadaPara, fim),
    ];
    if (filtro.somenteResponsavelId) condicoes.push(eq(oportunidades.responsavelId, filtro.somenteResponsavelId));
    if (filtro.closerId) condicoes.push(eq(oportunidades.responsavelId, filtro.closerId));

    const linhas = (await tx
      .select(COLUNAS)
      .from(reunioes)
      .innerJoin(oportunidades, eq(reunioes.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(...condicoes))
      .orderBy(reunioes.agendadaPara)) as Linha[];

    const itens = linhas.map((l) => paraAgenda(l, filtro.agora));
    return filtro.status ? itens.filter((i) => i.status === filtro.status) : itens;
  });
}

export async function buscarReuniao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string
): Promise<{ reuniao: ReuniaoDaAgenda; responsavelId: string | null } | null> {
  return comTenant(db, contexto, async (tx) => {
    const [l] = (await tx
      .select(COLUNAS)
      .from(reunioes)
      .innerJoin(oportunidades, eq(reunioes.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(eq(reunioes.id, id), eq(reunioes.empresaId, contexto.empresaId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1)) as Linha[];
    return l ? { reuniao: paraAgenda(l, new Date()), responsavelId: l.responsavelId } : null;
  });
}

export interface ResumoAgenda {
  hoje: { total: number; emAndamentoOuPorVir: number };
  presenca: { taxa: number | null; realizadas: number; noShows: number };
  noShow: { quantidade: number; percentual: number | null };
  pipelineEmDemonstracao: { valor: number; contas: number };
  resgateDeNoShows: { reuniaoId: string; oportunidadeId: string; leadNome: string; agendadaPara: string; closer: { id: string; nome: string } | null }[];
  desempenhoPorCloser: { closerId: string; nome: string; realizadas: number; comResultado: number; taxa: number | null }[];
}

/** Segunda-feira (início) e domingo (fim) da semana de `agora`, como `YYYY-MM-DD` de São Paulo. */
export function semanaDe(agora: Date): { de: string; ate: string } {
  const local = dataLocalEmSaoPaulo(agora);
  const desdeSegunda = (local.diaDaSemana + 6) % 7;
  const segunda = new Date(Date.UTC(local.ano, local.mes - 1, local.dia - desdeSegunda));
  const domingo = new Date(Date.UTC(local.ano, local.mes - 1, local.dia - desdeSegunda + 6));
  const iso = (d: Date) => dataLocalISO({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), diaDaSemana: 0, hora: 0 });
  return { de: iso(segunda), ate: iso(domingo) };
}

export async function resumoDaAgenda(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { somenteResponsavelId?: string; agora: Date }
): Promise<ResumoAgenda> {
  const { agora } = filtro;
  const semana = semanaDe(agora);
  const hojeISO = dataLocalISO(dataLocalEmSaoPaulo(agora));
  const daSemana = await listarReunioes(db, contexto, { ...semana, somenteResponsavelId: filtro.somenteResponsavelId, agora });
  const hoje = await listarReunioes(db, contexto, { de: hojeISO, ate: hojeISO, somenteResponsavelId: filtro.somenteResponsavelId, agora });

  const realizadas = daSemana.filter((r) => r.status === 'realizada').length;
  const noShows = daSemana.filter((r) => r.noShow).length;
  const comResultado = realizadas + noShows;

  const porCloser = new Map<string, { nome: string; realizadas: number; noShows: number }>();
  for (const r of daSemana) {
    if (!r.closer) continue;
    const atual = porCloser.get(r.closer.id) ?? { nome: r.closer.nome, realizadas: 0, noShows: 0 };
    if (r.status === 'realizada') atual.realizadas += 1;
    if (r.noShow) atual.noShows += 1;
    porCloser.set(r.closer.id, atual);
  }

  const { demonstracao, noShowsParaResgate } = await comTenant(db, contexto, async (tx) => {
    const base: SQL[] = [eq(oportunidades.empresaId, contexto.empresaId)];
    if (filtro.somenteResponsavelId) base.push(eq(oportunidades.responsavelId, filtro.somenteResponsavelId));

    const [soma] = await tx
      .select({ valor: sql<string>`coalesce(sum(${oportunidades.valor}), 0)`, contas: sql<number>`count(*)::int` })
      .from(oportunidades)
      .where(and(...base, eq(oportunidades.etapaId, ETAPA_REUNIAO_AGENDADA)));

    const noShowsDoResgate = (await tx
      .select(COLUNAS)
      .from(reunioes)
      .innerJoin(oportunidades, eq(reunioes.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(...base, eq(reunioes.empresaId, contexto.empresaId), eq(reunioes.noShow, true), eq(oportunidades.etapaId, ETAPA_NO_SHOW)))
      .orderBy(sql`${reunioes.agendadaPara} desc`)) as Linha[];

    return { demonstracao: soma, noShowsParaResgate: noShowsDoResgate };
  });

  // Um lead aparece uma vez só no resgate: a falta mais recente que ainda não foi remarcada.
  const vistos = new Set<string>();
  const resgate = noShowsParaResgate
    .filter((l) => !l.temRemarcacao)
    .filter((l) => (vistos.has(l.reuniao.oportunidadeId) ? false : (vistos.add(l.reuniao.oportunidadeId), true)))
    .map((l) => ({
      reuniaoId: l.reuniao.id,
      oportunidadeId: l.reuniao.oportunidadeId,
      leadNome: l.leadNome,
      agendadaPara: l.reuniao.agendadaPara.toISOString(),
      closer: l.responsavelId && l.closerNome ? { id: l.responsavelId, nome: l.closerNome } : null,
    }));

  return {
    hoje: {
      total: hoje.length,
      emAndamentoOuPorVir: hoje.filter((r) => r.status === 'agendada' || r.status === 'em_andamento').length,
    },
    presenca: { taxa: comResultado > 0 ? Math.round((realizadas / comResultado) * 100) : null, realizadas, noShows },
    noShow: { quantidade: noShows, percentual: comResultado > 0 ? Math.round((noShows / comResultado) * 100) : null },
    pipelineEmDemonstracao: { valor: Number(demonstracao?.valor ?? 0), contas: demonstracao?.contas ?? 0 },
    resgateDeNoShows: resgate,
    desempenhoPorCloser: [...porCloser.entries()].map(([closerId, c]) => {
      const total = c.realizadas + c.noShows;
      return {
        closerId,
        nome: c.nome,
        realizadas: c.realizadas,
        comResultado: total,
        taxa: total > 0 ? Math.round((c.realizadas / total) * 100) : null,
      };
    }),
  };
}

/** AC-489: os cards que podem receber uma reunião — só os de "Qualificado p/ reunião" (os do próprio usuário, para ATENDENTE). */
export async function listarCardsParaAgendar(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  somenteResponsavelId?: string
): Promise<{ id: string; leadNome: string; valor: string | null }[]> {
  return comTenant(db, contexto, async (tx) => {
    const condicoes: SQL[] = [
      eq(oportunidades.empresaId, contexto.empresaId),
      eq(oportunidades.etapaId, ETAPA_QUALIFICADO_P_REUNIAO),
    ];
    if (somenteResponsavelId) condicoes.push(eq(oportunidades.responsavelId, somenteResponsavelId));
    return tx
      .select({ id: oportunidades.id, leadNome: leads.nome, valor: oportunidades.valor })
      .from(oportunidades)
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...condicoes))
      .orderBy(leads.nome);
  });
}
