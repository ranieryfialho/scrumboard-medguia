// T-162 (fase4-pipeline-telas, US-108, AC-403): bloco "Distribuição de
// Motivos de Perda" dos arquivados — cada motivo com a contagem e o
// percentual (`obterIndicadoresArquivados`, T-154, repositories/pipeline-
// indicadores.ts), como o bloco do protótipo
// (`8._pipeline_arquivados_cards_arquivados/code.html`). Só mostra o que
// recebe por prop; sem nenhuma perda no período, mostra o estado vazio.
export interface MotivoDistribuicaoView {
  motivoId: string;
  motivo: string;
  quantidade: number;
  /** Fração 0-1, `null` sem nenhum perdido (mesmo padrão null-safe de `Indicador`). */
  percentual: number | null;
}

interface DistribuicaoMotivosProps {
  motivos: MotivoDistribuicaoView[];
}

function formatarPercentual(percentual: number | null): string {
  if (percentual === null) return '0%';
  return `${(percentual * 100).toFixed(1)}%`;
}

export function DistribuicaoMotivos({ motivos }: DistribuicaoMotivosProps) {
  return (
    <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between pb-space-sm">
        <h3 className="font-headline-sm text-headline-sm text-text-primary">Distribuição de Motivos de Perda</h3>
        <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[20px]">
          donut_large
        </span>
      </div>
      {motivos.length === 0 ? (
        <p className="font-body-sm text-body-sm text-text-muted py-2">Nenhuma perda no período.</p>
      ) : (
        <div className="space-y-3 py-2">
          {motivos.map((motivo) => (
            <div key={motivo.motivoId}>
              <div className="flex justify-between text-label-md font-label-md mb-1">
                <span className="text-text-primary font-medium">{motivo.motivo}</span>
                <span className="text-text-secondary font-bold">
                  {motivo.quantidade} ({formatarPercentual(motivo.percentual)})
                </span>
              </div>
              <div className="w-full bg-surface-subtle h-2 rounded-full overflow-hidden">
                <div
                  className="bg-danger-text h-full rounded-full"
                  style={{ width: `${motivo.percentual ? motivo.percentual * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
