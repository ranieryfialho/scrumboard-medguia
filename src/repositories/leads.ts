// T-041 (fase1-repositorios-isolamento, US-026/US-027): repositório de
// leads. Toda função passa por `comTenant` (T-040) — nenhuma aceita
// `db`/`tx` cru nem um `empresa_id` alternativo vindo do chamador (AC-066).
// Além do RLS (T-015), cada query aqui também filtra por
// `empresa_id = contexto.empresaId` explicitamente — camada de repositório
// do TDD-001 §4.7 ("o repositório recusa qualquer consulta sem escopo de
// empresa"), não só o banco.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type Lead = typeof leads.$inferSelect;

export interface DadosNovoLead {
  nome: string;
  telefoneE164?: string | null;
  email?: string | null;
  origem?: string | null;
  idExterno?: string | null;
  dados?: unknown;
  /**
   * Deliberadamente aceito na entrada só para o caso de um chamador
   * descuidado repassar um payload externo inteiro — nunca é lido: o
   * `empresa_id` gravado é sempre `contexto.empresaId` (AC-071).
   */
  empresaId?: string;
}

/** Cria um lead sob o tenant do `contexto` (AC-071: ignora `empresaId` do payload). */
export async function criarLead(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dadosNovoLead: DadosNovoLead
): Promise<Lead> {
  return comTenant(db, contexto, async (tx) => {
    const [lead] = await tx
      .insert(leads)
      .values({
        nome: dadosNovoLead.nome,
        telefoneE164: dadosNovoLead.telefoneE164 ?? null,
        email: dadosNovoLead.email ?? null,
        origem: dadosNovoLead.origem ?? null,
        idExterno: dadosNovoLead.idExterno ?? null,
        dados: dadosNovoLead.dados ?? null,
        empresaId: contexto.empresaId,
      })
      .returning();
    return lead;
  });
}

/** Busca um lead por id sob o tenant do `contexto` — fail closed (AC-069). */
export async function buscarLeadPorId(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string
): Promise<Lead | null> {
  return comTenant(db, contexto, async (tx) => {
    const registros = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);
    return registros[0] ?? null;
  });
}

/** Lista todos os leads do tenant do `contexto` (AC-068). */
export async function listarLeads(db: NodePgDatabase, contexto: ContextoTenant): Promise<Lead[]> {
  return comTenant(db, contexto, async (tx) => {
    return tx.select().from(leads).where(eq(leads.empresaId, contexto.empresaId));
  });
}
