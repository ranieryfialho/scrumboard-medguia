// T-190 (fase4-whatsapp, AC-507): "Contexto do Pipeline" da conversa aberta —
// só o que existe do card (nome, valor, responsável, etapa e o atalho).
import Link from 'next/link';

import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { SeloEtapa } from '@/components/pipeline/pecas/selo-etapa';
import { nomeDaConversa, type ConversaView } from './comum';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function ContextoCard({ conversa }: { conversa: ConversaView }) {
  const { card } = conversa;
  return (
    <section aria-label="Contexto do Pipeline" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
      <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Contexto do Pipeline</span>
      {!card ? (
        <p className="font-body-md text-body-md text-text-secondary">Sem card no pipeline</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-headline-sm text-headline-sm text-text-primary">{nomeDaConversa(conversa)}</h3>
            <Link href={`/pipeline/${card.id}`} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center">
              Abrir card
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
            <div className="rounded-xl bg-surface-subtle p-3">
              <span className="font-label-sm text-label-sm text-text-muted uppercase">Valor estimado</span>
              <p className="font-headline-sm text-headline-sm text-text-primary">
                {card.valor !== null ? MOEDA.format(Number(card.valor)) : '—'} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
              </p>
            </div>
            <div className="rounded-xl bg-surface-subtle p-3">
              <span className="font-label-sm text-label-sm text-text-muted uppercase">Responsável</span>
              <p className="font-headline-sm text-headline-sm text-text-primary">{card.responsavel?.nome ?? 'Sem responsável'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-body-sm text-body-sm text-text-muted">Etapa atual:</span>
            <SeloEtapa nome={nomeDaEtapa(card.etapaId)} />
          </div>
        </>
      )}
    </section>
  );
}
