// T-182 (fase4-tarefas-agenda, AC-464/AC-465): "Próxima tarefa em execução" —
// o primeiro toque da fila, só com o que existe (sem SLA estimado nem script).
import Link from 'next/link';

import { SeloEtapa } from '@/components/pipeline/pecas/selo-etapa';
import { CANAL_LABEL, TIPO_LABEL, TOTAL_TOQUES, iniciais, nomeEtapa, type ItemDaFila, type ResultadoToque } from './comum';

interface DestaqueProps {
  item: ItemDaFila | null;
  enviando: boolean;
  onConcluir: (item: ItemDaFila, resultado: ResultadoToque) => void;
  onAguardar?: (item: ItemDaFila) => void;
}

export function DestaqueTarefa({ item, enviando, onConcluir, onAguardar }: DestaqueProps) {
  if (!item) {
    return (
      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm">
        <p className="font-headline-sm text-headline-sm text-text-primary">Nenhuma tarefa no turno</p>
        <p className="font-body-md text-body-md text-text-secondary">Quando um toque for liberado, ele aparece aqui.</p>
      </section>
    );
  }

  return (
    <section aria-label="Próxima tarefa em execução" className="bg-surface-card rounded-2xl p-space-md shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-1 rounded-full bg-primary text-on-primary font-label-sm text-label-sm uppercase tracking-wide">
            Próxima tarefa em execução
          </span>
          <SeloEtapa nome={nomeEtapa(item.oportunidade.etapaId)} />
          {item.responsavel && (
            <span className="font-body-sm text-body-sm text-text-muted">Atribuído a {item.responsavel.nome}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="w-12 h-12 rounded-xl bg-primary text-on-primary flex items-center justify-center font-headline-sm text-headline-sm">
            {iniciais(item.lead.nome)}
          </span>
          <Link href={`/pipeline/${item.oportunidade.id}`} className="font-headline-md text-headline-md text-text-primary hover:text-primary truncate">
            {item.lead.nome}
          </Link>
        </div>
        <p className="font-body-md text-body-md text-text-primary">
          Toque {item.atividade.sequencia} de {TOTAL_TOQUES}: {TIPO_LABEL[item.atividade.tipo]} · {CANAL_LABEL[item.atividade.canal]}
        </p>
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        <button
          type="button"
          disabled={enviando}
          onClick={() => onConcluir(item, 'conectou')}
          className="h-11 px-5 rounded-xl bg-success-surface text-success-text font-label-lg text-label-lg font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">check_circle</span>
          Concluir Toque com Sucesso
        </button>
        {item.atividade.canal === 'whatsapp' && onAguardar && (
          <button
            type="button"
            disabled={enviando}
            onClick={() => onAguardar(item)}
            className="h-11 px-5 rounded-xl bg-warning-surface text-warning-text font-label-lg text-label-lg font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">hourglass_top</span>
            {item.aguardandoAte ? 'Aguardando resposta (reiniciar prazo)' : 'Aguardando Resposta'}
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={enviando}
            onClick={() => onConcluir(item, 'sem_resposta')}
            className="flex-1 h-11 px-4 rounded-xl bg-danger-surface text-danger-text font-label-md text-label-md font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">phone_missed</span>
            Não Atendeu
          </button>
          <Link
            href={`/pipeline/${item.oportunidade.id}`}
            aria-label="Abrir o card"
            className="h-11 w-11 rounded-xl bg-surface-subtle text-text-secondary flex items-center justify-center hover:bg-surface-container"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">open_in_new</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
