// T-190 (fase4-whatsapp, AC-507): "Contexto do Pipeline" da conversa aberta, em largura
// total abaixo da lista e do chat (protótipo `16._whatsapp_caixa_de_entrada`): o card
// (nome, valor, responsável, etapa) e a régua de cadência com o toque da vez. Só mostra
// o que existe do card.
import Link from 'next/link';

import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';
import { ROTULO_CANAL, ROTULO_TIPO, ROTULO_TURNO } from '@/components/pipeline/cadencia/tipos';
import { PromoverLead } from './promover-lead';
import { nomeDaConversa, type ConversaView } from './comum';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function ContextoCard({ conversa }: { conversa: ConversaView }) {
  const { card } = conversa;
  const cadencia = card?.cadencia ?? null;
  const atual = cadencia?.atual ?? null;
  return (
    <section aria-label="Contexto do Pipeline" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
      <div className="p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Contexto do Pipeline</span>
          {card && <span className="px-3 py-1 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">Ativo no Funil</span>}
        </div>
        {!card ? (
          <>
            <p className="font-body-md text-body-md text-text-secondary">Sem card no pipeline</p>
            {!conversa.leadId && <PromoverLead numero={conversa.numero} />}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-headline-md text-headline-md text-text-primary">{nomeDaConversa(conversa)}</h3>
              <Link href={`/pipeline/${card.id}`} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center">
                Abrir card
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <div className="rounded-xl border border-border-subtle p-3">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Valor estimado</span>
                <p className="font-headline-sm text-headline-sm text-text-primary">
                  {card.valor !== null ? MOEDA.format(Number(card.valor)) : '—'} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
                </p>
              </div>
              <div className="rounded-xl border border-border-subtle p-3">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Responsável</span>
                <p className="font-headline-sm text-headline-sm text-text-primary">{card.responsavel?.nome ?? 'Sem responsável'}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label-md text-label-md text-text-primary">Etapa Atual do Pipeline:</span>
              <div className="rounded-xl bg-warning-surface text-warning-text px-3 py-2.5 font-label-md text-label-md font-semibold flex items-center justify-between">
                <span>
                  {card.etapaId}. {nomeDaEtapa(card.etapaId)} (Atual)
                </span>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">swap_horiz</span>
              </div>
            </div>
          </>
        )}
      </div>

      {card && (
        <div className="border-t border-border-subtle p-space-md flex flex-col gap-space-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
              Régua de cadência{cadencia && cadencia.total > 0 ? ` (${cadencia.total} toques)` : ''}
            </span>
            {atual && <span className="font-label-md text-label-md font-semibold text-primary">Toque #{atual.sequencia}</span>}
          </div>
          {!cadencia || cadencia.total === 0 ? (
            <p className="font-body-md text-body-md text-text-secondary">A cadência deste card ainda não foi iniciada.</p>
          ) : !atual ? (
            <p className="font-body-md text-body-md text-text-secondary">
              Cadência concluída: {cadencia.feitos} de {cadencia.total} toques feitos.
            </p>
          ) : (
            <div className="rounded-xl border border-border-subtle bg-surface-subtle/50 p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-label-lg text-label-lg text-text-primary">
                  {ROTULO_TIPO[atual.tipo]} via {ROTULO_CANAL[atual.canal]}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-label-sm text-label-sm">
                  Dia {atual.dia} · {ROTULO_TURNO[atual.turno]}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-secondary">{atual.observacao ?? `${cadencia.feitos} de ${cadencia.total} toques já feitos.`}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
