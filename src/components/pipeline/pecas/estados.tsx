// T-158 (fase4-pipeline-telas, AC-413): os três estados que as quatro telas
// do pipeline (funil, lista, arquivados, detalhe) precisam tratar —
// carregamento, vazio e erro — como peças únicas para não repetir a
// marcação em cada tela.

/** AC-413: esqueleto de carregamento — linhas pulsando no lugar do conteúdo real. */
export function EsqueletoCarregando({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, indice) => (
        <div key={indice} className="h-16 rounded-xl bg-surface-container animate-pulse" />
      ))}
    </div>
  );
}

interface EstadoVazioProps {
  /** Mensagem de vazio (ex.: "Nenhum lead ainda"). */
  titulo: string;
  /** O próximo passo sugerido (ex.: "crie o primeiro"). */
  proximoPasso?: string;
  icone?: string;
}

/** AC-413: mensagem de vazio com o próximo passo. */
export function EstadoVazio({ titulo, proximoPasso, icone = 'inbox' }: EstadoVazioProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-space-2xl gap-2">
      <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[40px]">
        {icone}
      </span>
      <p className="font-headline-sm text-headline-sm text-text-primary">{titulo}</p>
      {proximoPasso && <p className="font-body-md text-body-md text-text-secondary">{proximoPasso}</p>}
    </div>
  );
}

interface EstadoErroProps {
  mensagem?: string;
  onTentarDeNovo: () => void;
}

/** AC-413: mensagem de erro com "Tentar de novo". */
export function EstadoErro({ mensagem = 'Não foi possível carregar os dados.', onTentarDeNovo }: EstadoErroProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-space-2xl gap-3">
      <span aria-hidden="true" className="material-symbols-outlined text-danger-text text-[32px]">
        error
      </span>
      <p className="font-body-md text-body-md text-text-secondary">{mensagem}</p>
      <button
        type="button"
        onClick={onTentarDeNovo}
        className="flex items-center gap-1.5 bg-surface hover:bg-surface-subtle text-text-primary font-label-lg text-label-lg py-2 px-4 rounded-lg shadow-sm hover:shadow transition-all"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
          refresh
        </span>
        Tentar de novo
      </button>
    </div>
  );
}
