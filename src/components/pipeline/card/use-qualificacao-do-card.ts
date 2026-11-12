'use client';

// fase6-qualificacao-comercial (AC-836): faixa e nota do card para o cabeçalho (Resumo e abas). Falha ou 404 só deixam o selo de fora,
// nunca derrubam a tela. Mudar `versao` refaz a busca (ex.: depois de salvar a qualificação).
import { useEffect, useState } from 'react';

import type { FaixaDeQualificacao } from '@/domain/qualificacao/qualificacao';

export interface QualificacaoDoCabecalho {
  faixa: FaixaDeQualificacao | null;
  score: number;
}

export function useQualificacaoDoCard(cardId: string | null, versao = 0): QualificacaoDoCabecalho | null {
  const [qualificacao, setQualificacao] = useState<QualificacaoDoCabecalho | null>(null);

  useEffect(() => {
    if (!cardId) return;
    let cancelado = false;
    void (async () => {
      try {
        const resposta = await fetch(`/api/oportunidades/${cardId}/qualificacao`);
        if (!resposta.ok) return;
        const corpo = (await resposta.json()) as { faixa?: FaixaDeQualificacao | null; score?: number };
        if (!cancelado) setQualificacao({ faixa: corpo.faixa ?? null, score: corpo.score ?? 0 });
      } catch {
        // sem selo
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [cardId, versao]);

  return qualificacao;
}
