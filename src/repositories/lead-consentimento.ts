// T-246 (fase5-whatsapp-lote-base, US-159): o consentimento do lead para receber WhatsApp — quem registrou e
// quando. Sempre por `comTenant`: lead de outra empresa "não existe" (AC-668).
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export interface Consentimento {
  consentimento: boolean;
  em: string | null;
  porNome: string | null;
}

export async function lerConsentimento(db: NodePgDatabase, contexto: ContextoTenant, leadId: string): Promise<Consentimento | null> {
  return comTenant(db, contexto, async (tx) => {
    const [l] = await tx
      .select({ em: leads.consentimentoWhatsappEm, porNome: usuarios.nome })
      .from(leads)
      .leftJoin(usuarios, eq(usuarios.id, leads.consentimentoWhatsappPor))
      .where(eq(leads.id, leadId))
      .limit(1);
    return l ? { consentimento: l.em !== null, em: l.em?.toISOString() ?? null, porNome: l.em ? l.porNome : null } : null;
  });
}

/** AC-667: `true` grava data e autor; `false` apaga os dois. */
export async function definirConsentimento(db: NodePgDatabase, contexto: ContextoTenant, leadId: string, consentimento: boolean): Promise<Consentimento | null> {
  const achado = await comTenant(db, contexto, async (tx) => {
    const atualizados = await tx
      .update(leads)
      .set(consentimento ? { consentimentoWhatsappEm: new Date(), consentimentoWhatsappPor: contexto.usuarioId } : { consentimentoWhatsappEm: null, consentimentoWhatsappPor: null })
      .where(eq(leads.id, leadId))
      .returning({ id: leads.id });
    return atualizados.length > 0;
  });
  return achado ? lerConsentimento(db, contexto, leadId) : null;
}
