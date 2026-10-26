// T-163 (fase4-pipeline-telas, US-109, AC-406): barra "Jornada de Conversão"
// do detalhe — as 15 etapas do playbook, com as já percorridas preenchidas e
// a atual destacada, fonte visual
// `docs/ui/stitch_medcrm_interface_design/9._pipeline_id_detalhe_do_card/`.
// ASM-132: os nomes são sempre os do banco (`pipeline_etapas`, seed fixo de
// `drizzle/0005_seeds.sql`), não os do protótipo — mesma lista que
// `board-kanban.tsx` já usa para o funil, repetida aqui porque este
// componente é da pasta `detalhe/` (arquivos disjuntos da T-160) e também é
// reaproveitada por `page.tsx` para rotular "Mover de Etapa".
export const ETAPAS_PIPELINE: { id: number; nome: string }[] = [
  { id: 1, nome: 'Entrada de leads' },
  { id: 2, nome: '1º dia de contato' },
  { id: 3, nome: '2º dia de contato' },
  { id: 4, nome: '3º dia de contato' },
  { id: 5, nome: 'Qualificando' },
  { id: 6, nome: 'Qualificado p/ reunião' },
  { id: 7, nome: 'Follow de longo prazo' },
  { id: 8, nome: 'Reunião agendada' },
  { id: 9, nome: 'No-show' },
  { id: 10, nome: 'Reunião realizada' },
  { id: 11, nome: 'Proposta' },
  { id: 12, nome: 'Teste (Trial)' },
  { id: 13, nome: 'Negociação' },
  { id: 14, nome: 'Perdido' },
  { id: 15, nome: 'Contrato (Ganho)' },
];

export function nomeDaEtapa(etapaId: number): string {
  return ETAPAS_PIPELINE.find((etapa) => etapa.id === etapaId)?.nome ?? `Etapa ${etapaId}`;
}

interface JornadaProps {
  etapaAtualId: number;
}

/** AC-406: as 15 etapas, as já percorridas preenchidas, a atual destacada, e o percentual concluído. */
export function Jornada({ etapaAtualId }: JornadaProps) {
  const percentual = Math.round((etapaAtualId / ETAPAS_PIPELINE.length) * 100);

  return (
    <div className="w-full bg-surface-card shadow-sm py-3 px-gutter overflow-x-auto">
      <div className="min-w-[860px]">
        <div className="flex items-center justify-between text-[11px] font-label-sm text-text-muted mb-2">
          <span className="font-semibold text-text-primary flex items-center gap-1">
            <span aria-hidden="true" className="material-symbols-outlined text-primary text-[15px]">
              flag
            </span>
            Jornada de Conversão (Etapa {etapaAtualId} de {ETAPAS_PIPELINE.length})
          </span>
          <span className="text-primary font-bold">{percentual}% Concluído</span>
        </div>
        <div className="grid grid-cols-15 gap-1.5 items-center">
          {ETAPAS_PIPELINE.map((etapa) => {
            const percorrida = etapa.id < etapaAtualId;
            const atual = etapa.id === etapaAtualId;
            return (
              <div key={etapa.id} className="flex flex-col gap-1" title={etapa.nome}>
                <div
                  className={
                    atual
                      ? 'h-2 rounded-full bg-warning-text ring-2 ring-warning-border'
                      : percorrida
                        ? 'h-2 rounded-full bg-primary'
                        : 'h-2 rounded-full bg-surface-container-highest'
                  }
                />
                <span
                  className={
                    atual
                      ? 'truncate text-[10px] text-warning-text font-bold'
                      : percorrida
                        ? 'truncate text-[10px] text-text-secondary font-medium'
                        : 'truncate text-[10px] text-text-muted'
                  }
                >
                  {etapa.nome}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
