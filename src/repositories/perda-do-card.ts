// fase6-perdas-por-lead (US-193, AC-813 a AC-815): o que o bloco "Perda" do detalhe do card mostra além do motivo — em que etapa o
// card estava e quando foi perdido. Vem da última transição para "Perdido" no log de eventos (`oportunidade_eventos`), a mesma
// fonte dos relatórios. O responsável é o atual do card (ASM-308: o card não guarda quem era o responsável no instante da perda).
import { and, desc, eq } from 'drizzle-orm';

import { oportunidadeEventos, pipelineEtapas } from '../db/schema';
import type { TransacaoTenant } from './contexto';

const ETAPA_PERDIDO = 14;

/** O motivo sistêmico que a cadência grava quando o prazo se esgota (drizzle/0005_seeds.sql): é a "perda automática" (AC-815). */
export const MOTIVO_CADENCIA_ESGOTADA = 'Cadência esgotada';

export interface PerdaDoCard {
  /** Nome do motivo; `null` = nenhum motivo informado. */
  motivo: string | null;
  /** Nome da etapa em que o card estava ao ser perdido; `null` quando o log não tem a transição (ex.: card migrado direto em Perdido). */
  etapaOrigem: string | null;
  /** Instante da perda (ISO 8601); `null` quando o log não tem a transição. */
  ocorridoEm: string | null;
  automatica: boolean;
}

/** AC-814: fora de "Perdido" (inclusive o card reaberto depois de perdido) não há perda para mostrar: devolve `null`. */
export async function lerPerdaDoCard(
  tx: TransacaoTenant,
  empresaId: string,
  oportunidade: { id: string; etapaId: number },
  motivo: string | null
): Promise<PerdaDoCard | null> {
  if (oportunidade.etapaId !== ETAPA_PERDIDO) return null;
  const oportunidadeId = oportunidade.id;

  const [evento] = await tx
    .select({ etapaOrigemId: oportunidadeEventos.etapaOrigemId, ocorridoEm: oportunidadeEventos.ocorridoEm })
    .from(oportunidadeEventos)
    .where(
      and(
        eq(oportunidadeEventos.empresaId, empresaId),
        eq(oportunidadeEventos.oportunidadeId, oportunidadeId),
        eq(oportunidadeEventos.tipo, 'transicao_etapa'),
        eq(oportunidadeEventos.etapaDestinoId, ETAPA_PERDIDO)
      )
    )
    .orderBy(desc(oportunidadeEventos.ocorridoEm))
    .limit(1);

  let etapaOrigem: string | null = null;
  if (evento?.etapaOrigemId) {
    const [etapa] = await tx.select({ nome: pipelineEtapas.nome }).from(pipelineEtapas).where(eq(pipelineEtapas.id, evento.etapaOrigemId)).limit(1);
    etapaOrigem = etapa?.nome ?? null;
  }

  return { motivo, etapaOrigem, ocorridoEm: evento ? evento.ocorridoEm.toISOString() : null, automatica: motivo === MOTIVO_CADENCIA_ESGOTADA };
}
