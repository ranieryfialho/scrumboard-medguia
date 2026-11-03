'use client';

// T-296 (fase4-pipeline-lote, AC-759): a confirmação de "Iniciar Cadência" em vários cards — diz quantos, o que acontece com cada um
// (vai para "1º dia de contato" e ganha os 3 primeiros toques do turno) e só então dispara. Sem campos: não há o que escolher.
interface DialogoIniciarCadenciaProps {
  quantidade: number;
  enviando: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onFechar: () => void;
}

export function DialogoIniciarCadencia({ quantidade, enviando, erro, onConfirmar, onFechar }: DialogoIniciarCadenciaProps) {
  const cards = `${quantidade} ${quantidade === 1 ? 'card' : 'cards'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="iniciar-cadencia-titulo">
      <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-space-lg flex flex-col gap-space-md">
        <h2 id="iniciar-cadencia-titulo" className="font-headline-sm text-headline-sm text-text-primary">
          Iniciar a cadência de {cards}?
        </h2>
        <p className="font-body-md text-body-md text-text-secondary">
          Cada card de <strong>Entrada de leads</strong> vai para <strong>1º dia de contato</strong> e ganha os 3 primeiros toques do turno, que passam a aparecer
          em Tarefas do Turno. Cards que já estão em outra etapa ou que já têm toques ficam de fora e aparecem no resultado.
        </p>
        {erro && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={enviando} className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-60"
          >
            {enviando ? 'Iniciando…' : `Iniciar ${cards}`}
          </button>
        </div>
      </div>
    </div>
  );
}
