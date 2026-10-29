// T-247 (fase5-whatsapp-lote-base, US-161): a prévia de um lote — lê os leads da empresa e deixa as regras
// puras (`montarPrevia`) separarem quem receberia de quem fica de fora. Não envia nada.
import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { montarPrevia, type PreviaDoLote } from '../lib/whatsapp/lote-regras';
import { comTenant } from './contexto';

export async function previaDoLote(db: NodePgDatabase, contexto: ContextoTenant, leadIds: string[], corpoDoTemplate: string): Promise<PreviaDoLote> {
  const encontrados = await comTenant(db, contexto, (tx) =>
    tx
      .select({ id: leads.id, nome: leads.nome, telefone: leads.telefoneE164, consentimentoEm: leads.consentimentoWhatsappEm })
      .from(leads)
      .where(inArray(leads.id, leadIds))
  );
  return montarPrevia(
    leadIds,
    encontrados.map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone, consentimento: l.consentimentoEm !== null })),
    corpoDoTemplate
  );
}
