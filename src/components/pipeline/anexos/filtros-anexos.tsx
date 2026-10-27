'use client';

// T-172 (fase4-card-abas, US-112, AC-425): busca por nome e chips por tipo
// ("Todos", "Evidências", "PDFs", "Imagens") com a contagem de cada um.
// Fonte visual: barra de filtros de `12._pipeline_id_anexos_prints_e_evid_ncias_do_card/`.

export type FiltroTipoAnexo = 'todos' | 'evidencias' | 'pdfs' | 'imagens';

export interface ValorFiltrosAnexos {
  busca: string;
  tipo: FiltroTipoAnexo;
}

interface FiltrosAnexosProps {
  valor: ValorFiltrosAnexos;
  contagens: Record<FiltroTipoAnexo, number>;
  onMudar: (parcial: Partial<ValorFiltrosAnexos>) => void;
}

const CHIPS: ReadonlyArray<{ chave: FiltroTipoAnexo; rotulo: string }> = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'evidencias', rotulo: 'Evidências' },
  { chave: 'pdfs', rotulo: 'PDFs' },
  { chave: 'imagens', rotulo: 'Imagens' },
];

export function FiltrosAnexos({ valor, contagens, onMudar }: FiltrosAnexosProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md bg-surface-card p-space-md rounded-xl shadow-sm">
      <div className="relative flex-1 max-w-md">
        <span
          aria-hidden="true"
          className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[19px]"
        >
          search
        </span>
        <input
          type="text"
          value={valor.busca}
          onChange={(evento) => onMudar({ busca: evento.target.value })}
          placeholder="Buscar documento por nome..."
          aria-label="Buscar anexo por nome"
          className="w-full h-10 pl-9 pr-4 bg-surface-subtle rounded-lg font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto py-1" role="group" aria-label="Filtrar por tipo">
        {CHIPS.map((chip) => {
          const ativo = valor.tipo === chip.chave;
          return (
            <button
              key={chip.chave}
              type="button"
              aria-pressed={ativo}
              onClick={() => onMudar({ tipo: chip.chave })}
              className={
                ativo
                  ? 'px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-semibold whitespace-nowrap shadow-sm'
                  : 'px-3 py-1.5 rounded-lg bg-surface-subtle text-text-secondary hover:text-text-primary hover:bg-surface-container font-label-sm text-label-sm font-medium whitespace-nowrap transition-colors'
              }
            >
              {chip.rotulo} ({contagens[chip.chave]})
            </button>
          );
        })}
      </div>
    </div>
  );
}
