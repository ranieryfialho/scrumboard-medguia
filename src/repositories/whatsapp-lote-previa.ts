// T-247 (fase5-whatsapp-lote-base, US-161): a prévia de um lote — lê os leads da empresa e deixa as regras
// puras (`montarPrevia`) separarem quem receberia de quem fica de fora. Não envia nada.
import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades } from '../db/schema';
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

/**
 * Os leads dos cards selecionados na lista, na ordem dos cards e sem repetir o lead; card que não existe na empresa
 * volta como o próprio id (que a prévia mostra como `LEAD_NAO_ENCONTRADO`).
 */
export async function leadIdsDosCards(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeIds: string[]): Promise<string[]> {
  const linhas = await comTenant(db, contexto, (tx) =>
    tx.select({ id: oportunidades.id, leadId: oportunidades.leadId }).from(oportunidades).where(inArray(oportunidades.id, oportunidadeIds))
  );
  const porCard = new Map(linhas.map((l) => [l.id, l.leadId]));
  return [...new Set(oportunidadeIds.map((id) => porCard.get(id) ?? id))];
}
