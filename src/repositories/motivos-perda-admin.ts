// T-211 (fase4-admin, US-139): o catálogo de motivos de perda para a tela de administração.
// O catálogo é GLOBAL (ASM-201, `motivos_perda` não tem `empresa_id`): todos os tenants o
// compartilham; o uso (cards perdidos) é sempre da empresa da sessão, por `comTenant`.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { motivosPerda } from '../db/schema';
import { dataLocalEmSaoPaulo } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const ETAPA_PERDIDO = 14;

export interface MotivoDaLista {
  id: string;
  nome: string;
  sistemico: boolean;
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
    const catalogo = await tx.select().from(motivosPerda).orderBy(motivosPerda.nome);

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
      ativo: m.ativo,
      usadoNoMes: usoMes.get(m.id) ?? 0,
      usadoTotal: usoTotal.get(m.id) ?? 0,
      podeEditar: contexto.isSuperAdmin && !m.eSistemico,
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
  | { ok: true; motivo: { id: string; nome: string; sistemico: boolean; ativo: boolean } }
  | { ok: false; codigo: 'MOTIVO_JA_EXISTE' | 'MOTIVO_SISTEMICO' | 'MOTIVO_NAO_ENCONTRADO' };

export async function criarMotivo(db: NodePgDatabase, nome: string): Promise<ResultadoMotivo> {
  const limpo = nome.trim();
  const [existe] = await db.select({ id: motivosPerda.id }).from(motivosPerda).where(sql`lower(${motivosPerda.nome}) = lower(${limpo})`).limit(1);
  if (existe) return { ok: false, codigo: 'MOTIVO_JA_EXISTE' };
  const [criado] = await db.insert(motivosPerda).values({ nome: limpo, ativo: true, eSistemico: false }).returning();
  return { ok: true, motivo: { id: criado.id, nome: criado.nome, sistemico: criado.eSistemico, ativo: criado.ativo } };
}

export async function alterarMotivo(db: NodePgDatabase, id: string, ativo: boolean): Promise<ResultadoMotivo> {
  const [atual] = await db.select().from(motivosPerda).where(eq(motivosPerda.id, id)).limit(1);
  if (!atual) return { ok: false, codigo: 'MOTIVO_NAO_ENCONTRADO' };
  if (atual.eSistemico) return { ok: false, codigo: 'MOTIVO_SISTEMICO' };
  const [novo] = await db.update(motivosPerda).set({ ativo }).where(and(eq(motivosPerda.id, id), eq(motivosPerda.eSistemico, false))).returning();
  return { ok: true, motivo: { id: novo.id, nome: novo.nome, sistemico: novo.eSistemico, ativo: novo.ativo } };
}
