// T-169 (fase4-card-abas, US-112): repositório da listagem de anexos de um
// card (aba "Anexos & Evidências", tela 12). Mesmo padrão `comTenant`
// (T-040) das demais listagens: a oportunidade de outro tenant é tratada
// pela rota (404, fail-closed) antes de chamar este repositório.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { anexos, oportunidadeEventos, pipelineEtapas, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const TIPO_EVIDENCIA_MARCADA = 'evidencia_marcada';
export const TIPO_EVIDENCIA_REMOVIDA = 'evidencia_removida';

/** ASM-143: anexo ligado a uma mudança de etapa (o `anexoId` gravado no `payload` do evento `transicao_etapa`). */
export interface EvidenciaDoAnexo {
  etapaId: number;
  etapaNome: string;
}

export interface AnexoDoCard {
  id: string;
  /** Nome original do arquivo (T-168); `null` nos anexos anteriores à migration 0013. */
  nome: string | null;
  mime: string;
  tamanho: number;
  hash: string;
  enviadoPorNome: string | null;
  /** T-294: quem enviou, para a tela saber se o usuário pode excluir. */
  enviadoPorId: string | null;
  criadoEm: Date;
  evidencia: EvidenciaDoAnexo | null;
}

/**
 * AC-423: lista os anexos do card do tenant, do mais novo ao mais antigo,
 * com o selo de evidência (AC-424) quando o anexo aparece como `anexoId` no
 * `payload` de um evento `transicao_etapa` do mesmo card.
 */
export async function listarAnexosDoCard(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string
): Promise<AnexoDoCard[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select({
        id: anexos.id,
        nome: anexos.nome,
        mime: anexos.mime,
        tamanho: anexos.tamanho,
        hash: anexos.hash,
        criadoEm: anexos.criadoEm,
        enviadoPorNome: usuarios.nome,
        enviadoPorId: anexos.enviadoPor,
      })
      .from(anexos)
      .leftJoin(usuarios, eq(usuarios.id, anexos.enviadoPor))
      .where(and(eq(anexos.oportunidadeId, oportunidadeId), eq(anexos.empresaId, contexto.empresaId)))
      .orderBy(desc(anexos.criadoEm));

    if (linhas.length === 0) return [];

    // Do mais antigo ao mais novo: vale o último que aconteceu com cada anexo. Evidência vem de uma transição de etapa com o
    // anexo, ou de "Tornar Evidência" (T-294, grava a etapa do card naquele momento); "Remover evidência" a desfaz.
    const eventos = await tx
      .select({
        tipo: oportunidadeEventos.tipo,
        anexoId: sql<string | null>`${oportunidadeEventos.payload}->>'anexoId'`,
        etapaId: pipelineEtapas.id,
        etapaNome: pipelineEtapas.nome,
      })
      .from(oportunidadeEventos)
      .leftJoin(pipelineEtapas, eq(pipelineEtapas.id, oportunidadeEventos.etapaDestinoId))
      .where(
        and(
          eq(oportunidadeEventos.oportunidadeId, oportunidadeId),
          inArray(oportunidadeEventos.tipo, ['transicao_etapa', TIPO_EVIDENCIA_MARCADA, TIPO_EVIDENCIA_REMOVIDA])
        )
      )
      .orderBy(asc(oportunidadeEventos.ocorridoEm));

    const evidenciaPorAnexo = new Map<string, EvidenciaDoAnexo>();
    for (const evento of eventos) {
      if (!evento.anexoId) continue;
      if (evento.tipo === TIPO_EVIDENCIA_REMOVIDA) evidenciaPorAnexo.delete(evento.anexoId);
      else if (evento.etapaId !== null && evento.etapaNome !== null) {
        evidenciaPorAnexo.set(evento.anexoId, { etapaId: evento.etapaId, etapaNome: evento.etapaNome });
      }
    }

    return linhas.map((linha) => ({
      ...linha,
      evidencia: evidenciaPorAnexo.get(linha.id) ?? null,
    }));
  });
}
