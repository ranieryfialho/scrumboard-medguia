// T-176 (fase4-pipeline-lote, US-115): a regra de mover UM card de etapa,
// extraída de `api/oportunidades/[id]/transicao/route.ts` (T-047, fase2-kanban)
// para ser a MESMA no card avulso e nos lotes (mover e arquivar). Fluxo, sem
// mudar nada do que a rota fazia: busca o card no tenant (fail closed) →
// carrega a etapa de destino e o recorte do grafo a partir da origem →
// `validarTransicao` (domínio, síncrono) → só então `moverOportunidade`, que
// grava tudo atomicamente; conflito de versão (lock otimista) vira
// `CONFLITO_DE_VERSAO`. `anexoId` só conta como evidência se o anexo existe no
// tenant e foi enviado para este mesmo card (AC-106).
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { pipelineEtapas, pipelineTransicoes } from '../db/schema';
import { validarTransicao } from '../domain/pipeline/validar-transicao';
import type { DadosTransicao, PipelineTransicao } from '../domain/pipeline/tipos';
import type { ContextoTenant } from '../lib/auth/tenant';
import { anexoValidoParaOportunidade } from './anexos';
import {
  buscarOportunidadePorId,
  ErroConflitoDeVersao,
  moverOportunidade,
  type Oportunidade,
} from './oportunidades';

export interface EntradaTransicao {
  /** `version` que o chamador acredita ser a atual do card (lock otimista). */
  version: number;
  etapaDestinoId: number;
  valor?: number | null;
  motivoPerdaId?: string | null;
  proximaAcaoEm?: string | null;
  anexoId?: string | null;
  justificativa?: string | null;
}

/** `codigo` é o do domínio (`validarTransicao`) ou `OPORTUNIDADE_NAO_ENCONTRADA` / `CONFLITO_DE_VERSAO`. */
export type ResultadoTransicao = { ok: true; card: Oportunidade } | { ok: false; codigo: string };

export async function transicionarCard(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  cardId: string,
  entrada: EntradaTransicao
): Promise<ResultadoTransicao> {
  // AC-087: card de outro tenant (ou inexistente) "não existe" — antes de validar qualquer coisa.
  const oportunidade = await buscarOportunidadePorId(db, contexto, cardId);
  if (!oportunidade) return { ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' };

  const [etapaDestino] = await db
    .select()
    .from(pipelineEtapas)
    .where(eq(pipelineEtapas.id, entrada.etapaDestinoId))
    .limit(1);

  // Destino fora das 15 etapas conhecidas nunca tem linha em `pipeline_transicoes` —
  // mesmo desfecho de "fora do grafo" (AC-083).
  if (!etapaDestino) return { ok: false, codigo: 'TRANSICAO_NAO_PERMITIDA' };

  const transicoesDaOrigem: PipelineTransicao[] = await db
    .select({
      etapaOrigemId: pipelineTransicoes.etapaOrigemId,
      etapaDestinoId: pipelineTransicoes.etapaDestinoId,
      exigeJustificativa: pipelineTransicoes.exigeJustificativa,
      papeisPermitidos: pipelineTransicoes.papeisPermitidos,
    })
    .from(pipelineTransicoes)
    .where(eq(pipelineTransicoes.etapaOrigemId, oportunidade.etapaId));

  const dados: DadosTransicao = {
    valor: entrada.valor ?? null,
    motivoPerdaId: entrada.motivoPerdaId ?? null,
    proximaAcaoEm: entrada.proximaAcaoEm ? new Date(entrada.proximaAcaoEm) : null,
    anexoId:
      typeof entrada.anexoId === 'string' &&
      (await anexoValidoParaOportunidade(db, contexto, entrada.anexoId, oportunidade.id))
        ? entrada.anexoId
        : null,
    justificativa: entrada.justificativa ?? null,
  };

  const resultado = validarTransicao({
    transicoes: transicoesDaOrigem,
    etapaOrigemId: oportunidade.etapaId,
    etapaDestino,
    ator: { papel: contexto.papel, isSuperAdmin: contexto.isSuperAdmin },
    dados,
  });

  if (!resultado.ok) return { ok: false, codigo: resultado.erro };

  try {
    const movida = await moverOportunidade(db, contexto, cardId, {
      version: entrada.version,
      etapaDestinoId: entrada.etapaDestinoId,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      valor: typeof entrada.valor === 'number' ? String(entrada.valor) : null,
      motivoPerdaId: entrada.motivoPerdaId ?? null,
      proximaAcaoEm: dados.proximaAcaoEm,
    });
    return { ok: true, card: movida };
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) return { ok: false, codigo: 'CONFLITO_DE_VERSAO' };
    throw erro;
  }
}
