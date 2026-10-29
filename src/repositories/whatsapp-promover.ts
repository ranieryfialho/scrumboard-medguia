// T-232 (fase5-acoes-rapidas, US-152): promove um número avulso do WhatsApp a lead — o lead, o card
// em "Entrada de leads" (tendo quem promove como responsável, ASM-226) e a ligação das mensagens
// do número com o lead acontecem numa transação só (AC-647). Sempre por `comTenant`: mensagens e
// leads de outra empresa nunca entram (AC-649).
import { and, inArray, isNull, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades, whatsappMensagens } from '../db/schema';
import { normalizarNumero, variantesNumero } from '../domain/whatsapp/numero';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const ETAPA_ENTRADA_DE_LEADS = 1;
const ORIGEM_WHATSAPP = 'WhatsApp';

export type ResultadoPromocao =
  | { ok: true; leadId: string; oportunidadeId: string; mensagensVinculadas: number }
  | { ok: false; codigo: 'NOME_OBRIGATORIO' | 'NUMERO_INVALIDO' | 'NUMERO_JA_E_LEAD' };

export async function promoverNumeroAvulso(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  entrada: { numero: unknown; nome: unknown }
): Promise<ResultadoPromocao> {
  const nome = typeof entrada.nome === 'string' ? entrada.nome.trim() : '';
  if (nome.length < 2 || nome.length > 120) return { ok: false, codigo: 'NOME_OBRIGATORIO' };
  const numero = typeof entrada.numero === 'string' ? normalizarNumero(entrada.numero) : null;
  if (!numero) return { ok: false, codigo: 'NUMERO_INVALIDO' };
  const variantes = variantesNumero(numero);

  return comTenant(db, contexto, async (tx) => {
    const existente = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.empresaId, contexto.empresaId), inArray(leads.telefoneE164, variantes)))
      .limit(1);
    if (existente.length > 0) return { ok: false, codigo: 'NUMERO_JA_E_LEAD' } as const;

    const [lead] = await tx
      .insert(leads)
      .values({ empresaId: contexto.empresaId, nome, telefoneE164: numero, origem: ORIGEM_WHATSAPP })
      .returning({ id: leads.id });
    const [card] = await tx
      .insert(oportunidades)
      .values({ empresaId: contexto.empresaId, leadId: lead.id, etapaId: ETAPA_ENTRADA_DE_LEADS, responsavelId: contexto.usuarioId })
      .returning({ id: oportunidades.id });
    const ligadas = await tx
      .update(whatsappMensagens)
      .set({ leadId: lead.id })
      .where(and(eq(whatsappMensagens.empresaId, contexto.empresaId), isNull(whatsappMensagens.leadId), inArray(whatsappMensagens.numero, variantes)))
      .returning({ id: whatsappMensagens.id });
    return { ok: true, leadId: lead.id, oportunidadeId: card.id, mensagensVinculadas: ligadas.length } as const;
  });
}
