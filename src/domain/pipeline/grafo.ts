// T-034 (fase1-dominio-pipeline, US-021, AC-048/AC-049): o grafo é dado —
// nenhuma combinação (origem, destino) é permitida por omissão. Só existe
// transição se houver uma linha correspondente em `pipeline_transicoes`.
import type { PipelineTransicao } from './tipos';

export function encontrarTransicao(
  transicoes: readonly PipelineTransicao[],
  etapaOrigemId: number,
  etapaDestinoId: number
): PipelineTransicao | undefined {
  return transicoes.find(
    (t) => t.etapaOrigemId === etapaOrigemId && t.etapaDestinoId === etapaDestinoId
  );
}
