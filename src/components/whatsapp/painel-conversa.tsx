'use client';

// T-190 (fase4-whatsapp, AC-503/AC-504/AC-509): o painel da conversa aberta da caixa de entrada.
// A conversa em si (histórico, busca, emoji, anexo, áudio, envio) é o MESMO componente da aba
// Conversa do card (`ConversaLead`) — assim as duas rotas não divergem. Aqui entra só o
// cabeçalho da caixa (nome, número e "Abrir card").
import Link from 'next/link';

import { ConversaLead } from '@/components/pipeline/conversa/conversa-lead';
import { formatarNumero, iniciais, nomeDaConversa, type ConversaView } from './comum';

interface PainelConversaProps {
  conversa: Pick<ConversaView, 'leadId' | 'numero' | 'nome' | 'naoLidas' | 'card'>;
  /** Muda a cada releitura automática da caixa (AC-508). */
  versao: number;
  /** Chamado depois de enviar ou marcar como lida, para a lista reler. */
  onAtualizou: () => void;
}

export function PainelConversa({ conversa, versao, onAtualizou }: PainelConversaProps) {
  const nome = nomeDaConversa(conversa);
  const cabecalho = (
    <div className="p-space-md border-b border-border-subtle flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <span aria-hidden="true" className="w-11 h-11 rounded-full bg-surface-container flex items-center justify-center font-label-lg text-label-lg text-text-secondary">
          {iniciais(nome)}
        </span>
        <div className="min-w-0">
          <h2 className="font-headline-sm text-headline-sm text-text-primary truncate">{nome}</h2>
          <p className="font-body-sm text-body-sm text-text-muted">{formatarNumero(conversa.numero)}</p>
        </div>
      </div>
      {conversa.card && (
        <Link href={`/pipeline/${conversa.card.id}`} className="h-9 px-3 rounded-lg border border-border-subtle text-primary font-label-md text-label-md flex items-center gap-1.5 hover:bg-surface-subtle shrink-0">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">view_kanban</span>
          Abrir card
        </Link>
      )}
    </div>
  );

  return (
    <ConversaLead
      leadId={conversa.leadId}
      numero={conversa.numero}
      leadNome={conversa.nome ?? ''}
      cabecalho={cabecalho}
      versao={versao}
      onAtualizou={onAtualizou}
      className="bg-surface-card rounded-2xl shadow-sm flex flex-col min-h-[32rem] xl:min-h-0 xl:h-full overflow-hidden"
    />
  );
}
