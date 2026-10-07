// T-073 (fase2c-whatsapp-conversa, US-047): repositório dos telefones extras
// do lead. Mesmo padrão de leads.ts/anexos.ts: tudo por `comTenant` (T-040) —
// RLS (migration 0009) + filtro explícito por `empresa_id`, nunca confiando
// só num dos dois. A duplicidade (AC-161) é checada aqui, não só pelo índice
// único da migration (`lead_id`, `numero`) — ele não conhece a variação do
// nono dígito (ASM-039/ASM-046); quem reconhece isso é `saoNumerosEquivalentes`
// (T-072), contra o principal do lead e contra os extras já cadastrados nele.
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, leadTelefones } from '../db/schema';
import { normalizarNumero, saoNumerosEquivalentes } from '../domain/whatsapp/numero';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';

export type TelefoneLead = typeof leadTelefones.$inferSelect;

/** O lead informado não existe no tenant do `contexto` — nem em outro tenant, nem em lugar nenhum (AC-163/AC-164). */
export class ErroLeadNaoEncontrado extends Error {
  constructor() {
    super('Lead informado não existe no tenant da sessão.');
    this.name = 'ErroLeadNaoEncontrado';
  }
}

/** `numero` fora do intervalo de 10 a 15 dígitos depois de normalizado (ASM-046). */
export class ErroNumeroInvalido extends Error {
  constructor() {
    super('Número de telefone inválido.');
    this.name = 'ErroNumeroInvalido';
  }
}

/** `numero` já é o principal do lead ou já é outro extra dele — direto ou por variação do nono dígito (AC-161). */
export class ErroTelefoneDuplicado extends Error {
  constructor() {
    super('Telefone já cadastrado para este lead.');
    this.name = 'ErroTelefoneDuplicado';
  }
}

export interface DadosNovoTelefoneLead {
  numero: string;
  rotulo?: string | null;
}

export interface TelefonesLead {
  /** Dígitos normalizados de `leads.telefone_e164`, ou `null` se o lead não tem principal cadastrado. */
  principal: string | null;
  extras: TelefoneLead[];
}

async function buscarLeadDoTenant(
  tx: TransacaoTenant,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  leadId: string
) {
  const registros = await tx
    .select({ id: leads.id, telefoneE164: leads.telefoneE164 })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.empresaId, contexto.empresaId)))
    .limit(1);
  return registros[0] ?? null;
}

/**
 * Cadastra um telefone extra do lead sob o tenant do `contexto` (AC-160).
 * `numero` é normalizado (só dígitos, DDI 55 quando vier com 10 ou 11
 * dígitos — ASM-046) antes de comparar e de gravar.
 *
 * - `ErroLeadNaoEncontrado`: lead inexistente ou de outro tenant.
 * - `ErroNumeroInvalido`: fora de 10 a 15 dígitos depois de normalizado.
 * - `ErroTelefoneDuplicado`: já é o principal do lead ou já é outro extra
 *   dele, direto ou por variação do nono dígito (AC-161).
 */
export async function criarTelefoneLead(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  leadId: string,
  dados: DadosNovoTelefoneLead
): Promise<TelefoneLead> {
  return comTenant(db, contexto, async (tx) => {
    const lead = await buscarLeadDoTenant(tx, contexto, leadId);
    if (!lead) throw new ErroLeadNaoEncontrado();

    const numero = normalizarNumero(dados.numero);
    if (!numero) throw new ErroNumeroInvalido();

    const principal = lead.telefoneE164 ? normalizarNumero(lead.telefoneE164) : null;
    if (principal && saoNumerosEquivalentes(numero, principal)) {
      throw new ErroTelefoneDuplicado();
    }

    const extrasExistentes = await tx
      .select({ numero: leadTelefones.numero })
      .from(leadTelefones)
      .where(and(eq(leadTelefones.leadId, leadId), eq(leadTelefones.empresaId, contexto.empresaId)));
    if (extrasExistentes.some((extra) => saoNumerosEquivalentes(numero, extra.numero))) {
      throw new ErroTelefoneDuplicado();
    }

    const [telefone] = await tx
      .insert(leadTelefones)
      .values({
        empresaId: contexto.empresaId,
        leadId,
        numero,
        rotulo: dados.rotulo ?? null,
      })
      .returning();
    return telefone;
  });
}

/**
 * Telefone principal (normalizado) e os extras do lead, em ordem de
 * cadastro (AC-163). `null` quando o lead não existe no tenant do
 * `contexto` (AC-164).
 */
export async function listarTelefonesLead(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  leadId: string
): Promise<TelefonesLead | null> {
  return comTenant(db, contexto, async (tx) => {
    const lead = await buscarLeadDoTenant(tx, contexto, leadId);
    if (!lead) return null;

    const extras = await tx
      .select()
      .from(leadTelefones)
      .where(and(eq(leadTelefones.leadId, leadId), eq(leadTelefones.empresaId, contexto.empresaId)))
      .orderBy(asc(leadTelefones.criadoEm));

    return { principal: lead.telefoneE164 ? normalizarNumero(lead.telefoneE164) : null, extras };
  });
}

/**
 * Remove um telefone extra do lead (AC-163). `false` sem apagar nada quando
 * o telefone não existe, é de outro lead ou de outro tenant (AC-164).
 */
export async function removerTelefoneLead(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  leadId: string,
  telefoneId: string
): Promise<boolean> {
  return comTenant(db, contexto, async (tx) => {
    const removidos = await tx
      .delete(leadTelefones)
      .where(
        and(
          eq(leadTelefones.id, telefoneId),
          eq(leadTelefones.leadId, leadId),
          eq(leadTelefones.empresaId, contexto.empresaId)
        )
      )
      .returning({ id: leadTelefones.id });
    return removidos.length > 0;
  });
}
