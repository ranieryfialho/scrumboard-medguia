// T-211 (fase4-admin, US-139): o catálogo de motivos de perda para a tela de administração.
// fase5-motivos-por-empresa: o que a empresa enxerga são os motivos globais (`empresa_id` vazio, os que
// já existiam) e os dela; o uso (cards perdidos) é sempre da empresa da sessão, por `comTenant`.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { motivosPerda } from '../db/schema';
import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { motivosDaEmpresa } from './motivos-perda';

const ETAPA_PERDIDO = 14;

export interface MotivoDaLista {
  id: string;
  nome: string;
  sistemico: boolean;
  /** AC-663: "sistemico" (travado), "rede" (global não sistêmico) ou "empresa" (da empresa da sessão). */
  escopo: 'sistemico' | 'rede' | 'empresa';
  ativo: boolean;
  usadoNoMes: number;
  usadoTotal: number;
  podeEditar: boolean;
}

export interface ListaDeMotivos {
  motivos: MotivoDaLista[];
  totais: { total: number; ativos: number; sistemicos: number; personalizados: number };
  resumo: { perdasNoMes: number; principal: { nome: string; quantidade: number; percentual: number } | null };
}

export async function listarMotivos(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { tipo?: 'sistemico' | 'personalizado'; status?: 'ativo' | 'inativo'; busca?: string; agora: Date }
): Promise<ListaDeMotivos> {
  const l = dataLocalEmSaoPaulo(filtro.agora);
  const inicioDoMes = new Date(Date.UTC(l.ano, l.mes - 1, 1, 3));

  return comTenant(db, contexto, async (tx) => {
    const catalogo = await tx.select().from(motivosPerda).where(motivosDaEmpresa(contexto.empresaId)).orderBy(motivosPerda.nome);

    const totais = await tx.execute<{ motivo: string | null; total: number }>(sql`
      SELECT o.motivo_perda_id AS motivo, count(*)::int AS total
      FROM oportunidades o
      WHERE o.empresa_id = ${contexto.empresaId} AND o.etapa_id = ${ETAPA_PERDIDO}
      GROUP BY 1
    `);
    const noMes = await tx.execute<{ motivo: string | null; total: number }>(sql`
      SELECT o.motivo_perda_id AS motivo, count(DISTINCT o.id)::int AS total
      FROM oportunidade_eventos e
      JOIN oportunidades o ON o.id = e.oportunidade_id
      WHERE e.empresa_id = ${contexto.empresaId} AND e.tipo = 'transicao_etapa' AND e.etapa_destino_id = ${ETAPA_PERDIDO}
        AND e.ocorrido_em >= ${inicioDoMes.toISOString()}::timestamptz
      GROUP BY 1
    `);
    const usoTotal = new Map(totais.rows.map((r) => [r.motivo, r.total]));
    const usoMes = new Map(noMes.rows.map((r) => [r.motivo, r.total]));
    const perdasNoMes = noMes.rows.reduce((s, r) => s + r.total, 0);

    const todos: MotivoDaLista[] = catalogo.map((m) => ({
      id: m.id,
      nome: m.nome,
      sistemico: m.eSistemico,
      escopo: m.eSistemico ? ('sistemico' as const) : m.empresaId ? ('empresa' as const) : ('rede' as const),
      ativo: m.ativo,
      usadoNoMes: usoMes.get(m.id) ?? 0,
      usadoTotal: usoTotal.get(m.id) ?? 0,
      podeEditar: !m.eSistemico && (m.empresaId !== null || contexto.isSuperAdmin),
    }));

    const termo = filtro.busca?.trim().toLowerCase();
    const motivos = todos.filter(
      (m) =>
        (!filtro.tipo || (filtro.tipo === 'sistemico') === m.sistemico) &&
        (!filtro.status || (filtro.status === 'ativo') === m.ativo) &&
        (!termo || m.nome.toLowerCase().includes(termo))
    );

    const principal = [...todos].filter((m) => m.usadoNoMes > 0).sort((a, b) => b.usadoNoMes - a.usadoNoMes || a.nome.localeCompare(b.nome))[0];
    return {
      motivos,
      totais: {
        total: todos.length,
        ativos: todos.filter((m) => m.ativo).length,
        sistemicos: todos.filter((m) => m.sistemico).length,
        personalizados: todos.filter((m) => !m.sistemico).length,
      },
      resumo: {
        perdasNoMes,
        principal: principal ? { nome: principal.nome, quantidade: principal.usadoNoMes, percentual: Math.round((principal.usadoNoMes / perdasNoMes) * 1000) / 10 } : null,
      },
    };
  });
}

export type ResultadoMotivo =
  | { ok: true; motivo: { id: string; nome: string; sistemico: boolean; ativo: boolean; escopo: 'sistemico' | 'rede' | 'empresa' } }
  | { ok: false; codigo: 'MOTIVO_JA_EXISTE' | 'MOTIVO_SISTEMICO' | 'MOTIVO_DA_REDE' | 'MOTIVO_NAO_ENCONTRADO' };

type LinhaDeMotivo = typeof motivosPerda.$inferSelect;
const comoResultado = (m: LinhaDeMotivo) => ({
  id: m.id,
  nome: m.nome,
  sistemico: m.eSistemico,
  ativo: m.ativo,
  escopo: m.eSistemico ? ('sistemico' as const) : m.empresaId ? ('empresa' as const) : ('rede' as const),
});

/** AC-660/AC-661: cria um motivo da empresa da sessão; o nome não pode repetir um global nem outro da empresa. */
export async function criarMotivo(db: NodePgDatabase, contexto: ContextoTenant, nome: string): Promise<ResultadoMotivo> {
  const limpo = nome.trim().replace(/\s+/g, ' ');
  const [existe] = await db
    .select({ id: motivosPerda.id })
    .from(motivosPerda)
    .where(and(sql`lower(${motivosPerda.nome}) = lower(${limpo})`, motivosDaEmpresa(contexto.empresaId)))
    .limit(1);
  if (existe) return { ok: false, codigo: 'MOTIVO_JA_EXISTE' };
  try {
    const [criado] = await db.insert(motivosPerda).values({ nome: limpo, ativo: true, eSistemico: false, empresaId: contexto.empresaId }).returning();
    return { ok: true, motivo: comoResultado(criado) };
  } catch {
    return { ok: false, codigo: 'MOTIVO_JA_EXISTE' }; // corrida com outro gerente da mesma empresa
  }
}

/** AC-662: ativa ou desativa só o motivo da própria empresa (o super admin também os globais não sistêmicos). */
export async function alterarMotivo(db: NodePgDatabase, contexto: ContextoTenant, id: string, ativo: boolean): Promise<ResultadoMotivo> {
  const [atual] = await db.select().from(motivosPerda).where(and(eq(motivosPerda.id, id), motivosDaEmpresa(contexto.empresaId))).limit(1);
  if (!atual) return { ok: false, codigo: 'MOTIVO_NAO_ENCONTRADO' };
  if (atual.eSistemico) return { ok: false, codigo: 'MOTIVO_SISTEMICO' };
  if (atual.empresaId === null && !contexto.isSuperAdmin) return { ok: false, codigo: 'MOTIVO_DA_REDE' };
  const [novo] = await db.update(motivosPerda).set({ ativo }).where(and(eq(motivosPerda.id, id), eq(motivosPerda.eSistemico, false))).returning();
  return { ok: true, motivo: comoResultado(novo) };
}
