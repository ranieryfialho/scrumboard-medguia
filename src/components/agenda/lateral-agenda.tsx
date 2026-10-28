// T-186 (fase4-tarefas-agenda, AC-487/AC-488): a coluna da direita — fila de
// resgate de no-shows e desempenho por closer na semana. "Protocolo Anti-No-Show"
// e "aproveitamento de agenda" do protótipo não existem no sistema e não aparecem.
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { diaDe, horaDe, rotuloDoDia } from './datas';
import type { ResumoAgendaView } from './tipos';

export function LateralAgenda({
  resumo,
  onReagendar,
}: {
  resumo: ResumoAgendaView;
  onReagendar: (reuniao: { id: string; leadNome: string }) => void;
}) {
  return (
    <aside className="flex flex-col gap-space-md">
      <section aria-label="Fila de Resgate de No-Shows" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Fila de Resgate de No-Shows</h2>
          <span className="px-2 py-0.5 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm">
            {resumo.resgateDeNoShows.length} pendentes
          </span>
        </div>
        {resumo.resgateDeNoShows.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">Nenhum no-show para resgatar.</p>}
        {resumo.resgateDeNoShows.map((n) => (
          <div key={n.reuniaoId} className="rounded-xl bg-surface-subtle p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-lg text-label-lg text-text-primary">{n.leadNome}</span>
              <span className="font-body-sm text-body-sm text-text-muted">
                {rotuloDoDia(diaDe(n.agendadaPara)).split(' de ').slice(0, 2).join(' ')} {horaDe(n.agendadaPara)}
              </span>
            </div>
            <span className="font-body-sm text-body-sm text-text-muted">Closer: {n.closer?.nome ?? 'Sem responsável'}</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onReagendar({ id: n.reuniaoId, leadNome: n.leadNome })}
                aria-label={`Reagendar no-show: ${n.leadNome}`}
                className="h-8 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50"
              >
                Reagendar
              </button>
              <ItemEmBreve rotulo="Enviar Template Médico de Resgate" className="h-8 px-2 rounded-lg bg-surface-card" />
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Performance por Closer" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
        <h2 className="font-headline-sm text-headline-sm text-text-primary">Performance por Closer (Semana)</h2>
        <p className="font-body-sm text-body-sm text-text-muted">Taxa de realização de reuniões agendadas.</p>
        {resumo.desempenhoPorCloser.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">Sem reuniões com resultado na semana.</p>}
        {resumo.desempenhoPorCloser.map((c) => (
          <div key={c.closerId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between font-label-md text-label-md text-text-primary">
              <span>{c.nome}</span>
              <span>
                {c.taxa ?? 0}% ({c.realizadas}/{c.comResultado})
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${c.taxa ?? 0}%` }} />
            </div>
          </div>
        ))}
      </section>
    </aside>
  );
}
