// T-296 (fase4-pipeline-lote, AC-759/AC-760): chama `POST /api/oportunidades/lote/iniciar-cadencia` em pedaços de até 100 cards (o
// limite de cada lote) e junta os resultados num só, para a lista (selecionados) e o funil (todos da Entrada de leads) usarem igual.
import { LIMITE_DE_IDS_POR_LOTE } from '@/lib/lote-limite';

import type { ResultadoDoLoteView } from './tipos';

/** Lança `Error` com o `codigo` da recusa do pedido (ex.: `REQUISICAO_INVALIDA`) ou `FALHA_DE_REDE`. */
export async function iniciarCadenciaEmMassa(ids: readonly string[]): Promise<ResultadoDoLoteView> {
  const juntos: ResultadoDoLoteView = { resultados: [], aplicados: 0, falhas: 0 };
  for (let i = 0; i < ids.length; i += LIMITE_DE_IDS_POR_LOTE) {
    let resposta: Response;
    try {
      resposta = await fetch('/api/oportunidades/lote/iniciar-cadencia', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(i, i + LIMITE_DE_IDS_POR_LOTE) }),
      });
    } catch {
      throw new Error('FALHA_DE_REDE');
    }
    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      throw new Error(corpo?.codigo ?? 'FALHA_DE_REDE');
    }
    const lote = (await resposta.json()) as ResultadoDoLoteView;
    juntos.resultados.push(...lote.resultados);
    juntos.aplicados += lote.aplicados;
    juntos.falhas += lote.falhas;
  }
  return juntos;
}
