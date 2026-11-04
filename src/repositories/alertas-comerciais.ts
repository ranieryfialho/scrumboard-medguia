// T-310 (fase4-analises, US-133): os dois alertas operacionais da tela de indicadores — propostas paradas há mais de 48 h e
// no-shows ainda sem resgate. Contagem do que está no funil agora (não depende do período escolhido na tela).
import { and, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const ETAPA_PROPOSTA = 11;
const ETAPA_NO_SHOW = 9;
export const HORAS_PROPOSTA_PARADA = 48;

export interface AlertasComerciais {
  propostasParadas: { total: number; valor: number };
  noShowsPendentes: { total: number; valor: number };
}

export async function obterAlertasComerciais(db: NodePgDatabase, contexto: ContextoTenant, responsavelId?: string, agora: Date = new Date()): Promise<AlertasComerciais> {
  const limite = new Date(agora.getTime() - HORAS_PROPOSTA_PARADA * 3_600_000);
  return comTenant(db, contexto, async (tx) => {
    const dono = responsavelId ? eq(oportunidades.responsavelId, responsavelId) : undefined;
    const soma = { total: sql<number>`count(*)::int`, valor: sql<string>`coalesce(sum(${oportunidades.valor}), 0)` };
    const [paradas] = await tx
      .select(soma)
      .from(oportunidades)
      .where(and(eq(oportunidades.empresaId, contexto.empresaId), eq(oportunidades.etapaId, ETAPA_PROPOSTA), lt(oportunidades.atualizadoEm, limite), dono));
    const [faltas] = await tx
      .select(soma)
      .from(oportunidades)
      .where(and(eq(oportunidades.empresaId, contexto.empresaId), eq(oportunidades.etapaId, ETAPA_NO_SHOW), dono));
    return {
      propostasParadas: { total: paradas?.total ?? 0, valor: Number(paradas?.valor ?? 0) },
      noShowsPendentes: { total: faltas?.total ?? 0, valor: Number(faltas?.valor ?? 0) },
    };
  });
}
