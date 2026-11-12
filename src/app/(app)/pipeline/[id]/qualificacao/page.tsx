'use client';

// fase6-qualificacao-comercial (US-198, AC-836): a aba "Qualificação" do card. Vive no grupo `(app)` e dentro do `MoldeDoCard`: cabeçalho
// (com a nota ao lado da etapa), abas e os estados de carregando, erro e "não encontrado". Salvar refaz a nota do cabeçalho.
import { use, useState } from 'react';

import { MoldeDoCard } from '@/components/pipeline/card/molde-do-card';
import { BlocoQualificacao } from '@/components/pipeline/detalhe/bloco-qualificacao';

export default function PipelineQualificacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [versao, setVersao] = useState(0);

  return (
    <MoldeDoCard cardId={id} aba="qualificacao" versaoDaQualificacao={versao}>
      {(card) => (
        <div className="p-gutter w-full">
          <BlocoQualificacao oportunidadeId={card.id} aoSalvar={() => setVersao((atual) => atual + 1)} />
        </div>
      )}
    </MoldeDoCard>
  );
}
