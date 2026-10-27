// T-169 (fase4-card-abas, US-112): repositório da listagem de anexos de um
// card (aba "Anexos & Evidências", tela 12). Mesmo padrão `comTenant`
// (T-040) das demais listagens: a oportunidade de outro tenant é tratada
// pela rota (404, fail-closed) antes de chamar este repositório.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { anexos, oportunidadeEventos, pipelineEtapas, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

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
      })
      .from(anexos)
      .leftJoin(usuarios, eq(usuarios.id, anexos.enviadoPor))
      .where(and(eq(anexos.oportunidadeId, oportunidadeId), eq(anexos.empresaId, contexto.empresaId)))
      .orderBy(desc(anexos.criadoEm));

    if (linhas.length === 0) return [];

    const eventos = await tx
      .select({
        anexoId: sql<string | null>`${oportunidadeEventos.payload}->>'anexoId'`,
        etapaId: pipelineEtapas.id,
        etapaNome: pipelineEtapas.nome,
      })
      .from(oportunidadeEventos)
      .innerJoin(pipelineEtapas, eq(pipelineEtapas.id, oportunidadeEventos.etapaDestinoId))
      .where(and(eq(oportunidadeEventos.oportunidadeId, oportunidadeId), eq(oportunidadeEventos.tipo, 'transicao_etapa')));

    const evidenciaPorAnexo = new Map<string, EvidenciaDoAnexo>();
    for (const evento of eventos) {
      if (evento.anexoId) {
        evidenciaPorAnexo.set(evento.anexoId, { etapaId: evento.etapaId, etapaNome: evento.etapaNome });
      }
    }

    return linhas.map((linha) => ({
      ...linha,
      evidencia: evidenciaPorAnexo.get(linha.id) ?? null,
    }));
  });
}
