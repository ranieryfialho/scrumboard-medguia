// T-303 (fase4-whatsapp, US-125): o que a tela de mensagem avulsa lembra — para quem foi (nome, motivo, "virar lead se responder")
// e o rascunho de cada pessoa. Sempre por `comTenant`.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { whatsappAvulsos, whatsappRascunhos } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const NOME_MAX = 120;
export const CATEGORIA_MAX = 80;

export interface DadosAvulso {
  nome: string | null;
  categoria: string | null;
  criarLeadAoResponder: boolean;
}

const limpar = (valor: unknown, max: number): string | null => {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().slice(0, max);
  return texto === '' ? null : texto;
};

/** Normaliza o que veio do corpo do pedido (campos opcionais). */
export function dadosAvulsoDoCorpo(corpo: Record<string, unknown>): DadosAvulso {
  return {
    nome: limpar(corpo.destinatarioNome, NOME_MAX),
    categoria: limpar(corpo.categoria, CATEGORIA_MAX),
    criarLeadAoResponder: corpo.criarLeadAoResponder === true,
  };
}

/** Grava (ou atualiza) quem é o dono do número avulso depois de um envio. Campos vazios não apagam o que já existia. */
export async function registrarAvulso(db: NodePgDatabase, contexto: ContextoTenant, numero: string, dados: DadosAvulso): Promise<void> {
  if (!dados.nome && !dados.categoria && !dados.criarLeadAoResponder) return;
  await comTenant(db, contexto, async (tx) => {
    await tx
      .insert(whatsappAvulsos)
      .values({ empresaId: contexto.empresaId, numero, nome: dados.nome, categoria: dados.categoria, criarLeadAoResponder: dados.criarLeadAoResponder, criadoPor: contexto.usuarioId })
      .onConflictDoUpdate({
        target: [whatsappAvulsos.empresaId, whatsappAvulsos.numero],
        set: {
          nome: sql`coalesce(excluded.nome, ${whatsappAvulsos.nome})`,
          categoria: sql`coalesce(excluded.categoria, ${whatsappAvulsos.categoria})`,
          criarLeadAoResponder: sql`excluded.criar_lead_ao_responder OR ${whatsappAvulsos.criarLeadAoResponder}`,
          atualizadoEm: sql`now()`,
        },
      });
  });
}

export interface RascunhoAvulso {
  numero: string;
  nome: string;
  categoria: string;
  mensagem: string;
  criarLeadAoResponder: boolean;
}

export async function lerRascunho(db: NodePgDatabase, contexto: ContextoTenant): Promise<RascunhoAvulso | null> {
  return comTenant(db, contexto, async (tx) => {
    const [r] = await tx
      .select({
        numero: whatsappRascunhos.numero,
        nome: whatsappRascunhos.nome,
        categoria: whatsappRascunhos.categoria,
        mensagem: whatsappRascunhos.mensagem,
        criarLeadAoResponder: whatsappRascunhos.criarLeadAoResponder,
      })
      .from(whatsappRascunhos)
      .where(and(eq(whatsappRascunhos.empresaId, contexto.empresaId), eq(whatsappRascunhos.usuarioId, contexto.usuarioId)))
      .limit(1);
    return r ?? null;
  });
}

export async function salvarRascunho(db: NodePgDatabase, contexto: ContextoTenant, r: RascunhoAvulso): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx
      .insert(whatsappRascunhos)
      .values({ empresaId: contexto.empresaId, usuarioId: contexto.usuarioId, ...r })
      .onConflictDoUpdate({ target: [whatsappRascunhos.empresaId, whatsappRascunhos.usuarioId], set: { ...r, atualizadoEm: sql`now()` } });
  });
}

export async function apagarRascunho(db: NodePgDatabase, contexto: ContextoTenant): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx.delete(whatsappRascunhos).where(and(eq(whatsappRascunhos.empresaId, contexto.empresaId), eq(whatsappRascunhos.usuarioId, contexto.usuarioId)));
  });
}
