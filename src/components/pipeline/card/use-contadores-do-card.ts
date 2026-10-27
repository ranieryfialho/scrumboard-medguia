'use client';

// T-171 (fase4-card-abas, AC-420): os números das abas do card — toques
// concluídos de 18 e total de anexos. Cada busca é isolada: uma falha (ou um
// 404) só deixa o contador de fora, nunca derruba a tela.
import { useEffect, useState } from 'react';

import type { ContagensDasAbas } from './abas-do-card';

export function useContadoresDoCard(cardId: string | null, versao = 0): ContagensDasAbas {
  const [contagens, setContagens] = useState<ContagensDasAbas>({ cadencia: null, anexos: null });

  useEffect(() => {
    if (!cardId) return;
    let cancelado = false;

    async function buscar<T>(caminho: string): Promise<T | null> {
      try {
        const resposta = await fetch(`/api/oportunidades/${cardId}/${caminho}`);
        return resposta.ok ? ((await resposta.json()) as T) : null;
      } catch {
        return null;
      }
    }

    void Promise.all([
      buscar<{ concluidos: number; total: number; iniciada: boolean }>('cadencia'),
      buscar<{ anexos: unknown[] }>('anexos'),
    ]).then(([cadencia, anexos]) => {
      if (cancelado) return;
      setContagens({
        cadencia: cadencia?.iniciada ? { concluidos: cadencia.concluidos, total: cadencia.total } : null,
        anexos: anexos && Array.isArray(anexos.anexos) ? anexos.anexos.length : null,
      });
    });

    return () => {
      cancelado = true;
    };
  }, [cardId, versao]);

  return contagens;
}
