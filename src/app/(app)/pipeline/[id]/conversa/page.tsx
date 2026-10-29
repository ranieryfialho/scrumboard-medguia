'use client';

// T-174 (fase4-card-abas, US-114): tela da conversa de WhatsApp do lead dentro
// do card — fonte visual `docs/ui/stitch_medcrm_interface_design/11._pipeline_id_conversa_whatsapp_do_lead/`.
// Vive no grupo `(app)` e dentro do `MoldeDoCard` (T-171): cabeçalho, abas e os
// estados de carregando, erro e "não encontrado" do card. "Ligar Agora" abre o discador
// com o telefone do lead (fase5-acoes-rapidas, Q-049).
import { use } from 'react';

import { MoldeDoCard } from '@/components/pipeline/card/molde-do-card';
import { ConversaLead } from '@/components/pipeline/conversa/conversa-lead';
import { PainelLateral } from '@/components/pipeline/conversa/painel-lateral';
import { linkDeLigacao } from '@/lib/telefone';

export default function PipelineConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <MoldeDoCard cardId={id} aba="whatsapp">
      {(card) => (
        <div className="p-gutter flex flex-col gap-space-md w-full">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <div>
              <h2 className="font-headline-md text-headline-md text-text-primary">WhatsApp &amp; Conversas</h2>
              <p className="font-body-sm text-body-sm text-text-secondary">A conversa de {card.leadNome} pelo WhatsApp da empresa.</p>
            </div>
            {linkDeLigacao(card.telefoneE164) && (
              <a href={linkDeLigacao(card.telefoneE164)!} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm inline-flex items-center gap-2 font-label-md text-label-md text-text-primary">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">call</span>
                Ligar Agora
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
            <div className="lg:col-span-8">
              <ConversaLead leadId={card.leadId} />
            </div>
            <div className="lg:col-span-4">
              <PainelLateral cardId={card.id} />
            </div>
          </div>
        </div>
      )}
    </MoldeDoCard>
  );
}
