// T-313 (fase4-pipeline, US-114): o fechamento do cliente (migration 0031) — lê e grava os seis campos de um card, com o evento
// `fechamento_registrado` na linha do tempo. Sempre por `comTenant`; card de outra empresa nunca é lido nem gravado.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { oportunidadeEventos, oportunidadeFechamento, oportunidades } from '../db/schema';
import type { DadosFechamento } from '../domain/pipeline/fechamento';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const TIPO_EVENTO_FECHAMENTO = 'fechamento_registrado';

export interface FechamentoRegistrado extends DadosFechamento {
  registradoEm: string;
}

export async function lerFechamentoDoCard(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<FechamentoRegistrado | null> {
  return comTenant(db, contexto, async (tx) => {
    const [l] = await tx
      .select()
      .from(oportunidadeFechamento)
      .where(and(eq(oportunidadeFechamento.oportunidadeId, oportunidadeId), eq(oportunidadeFechamento.empresaId, contexto.empresaId)))
      .limit(1);
    if (!l) return null;
    return {
      plataformaAnterior: l.plataformaAnterior,
      deixouADesejar: l.deixouADesejar,
      maisInteressou: l.maisInteressou,
      plano: l.plano,
      porOndeConheceu: l.porOndeConheceu,
      observacoes: l.observacoes,
      registradoEm: l.registradoEm.toISOString(),
    };
  });
}

/** Grava (ou troca) o fechamento do card. `false` se o card não existe na empresa. */
export async function salvarFechamentoDoCard(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string, dados: DadosFechamento): Promise<boolean> {
  return comTenant(db, contexto, async (tx) => {
    const [card] = await tx
      .select({ id: oportunidades.id })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    if (!card) return false;
    const valores = { ...dados, registradoEm: new Date(), registradoPor: contexto.usuarioId };
    await tx
      .insert(oportunidadeFechamento)
      .values({ oportunidadeId, empresaId: contexto.empresaId, ...valores })
      .onConflictDoUpdate({ target: oportunidadeFechamento.oportunidadeId, set: valores });
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId,
      tipo: TIPO_EVENTO_FECHAMENTO,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { plano: dados.plano, plataformaAnterior: dados.plataformaAnterior, porOndeConheceu: dados.porOndeConheceu },
    });
    return true;
  });
}
