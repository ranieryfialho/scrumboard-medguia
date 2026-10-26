// T-158 (fase4-pipeline-telas, US-106/US-108): cartão de indicador do topo
// das telas de funil e arquivados — mesma marcação do protótipo Stitch
// (`6._pipeline_funil_pipeline/code.html` e
// `8._pipeline_arquivados_cards_arquivados/code.html`): rótulo em
// maiúsculas, valor grande, legenda e um selo de ícone. Só exibe o que vem
// por prop; não sabe de onde vêm os números (AC-389/AC-403 ficam na tela
// que o usa).
interface CartaoIndicadorProps {
  titulo: string;
  valor: string;
  legenda?: string;
  icone: string;
  /** Cor do selo de ícone — combinações do design system (fundo claro / texto escuro). */
  cor?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

const CORES: Record<NonNullable<CartaoIndicadorProps['cor']>, string> = {
  primary: 'bg-info-surface text-primary',
  success: 'bg-success-surface text-success-text',
  warning: 'bg-warning-surface text-warning-text',
  danger: 'bg-danger-surface text-danger-text',
  info: 'bg-info-surface text-info-text',
};

export function CartaoIndicador({ titulo, valor, legenda, icone, cor = 'primary' }: CartaoIndicadorProps) {
  return (
    <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center justify-between">
      <div className="flex flex-col">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">{titulo}</span>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="font-metric-stat text-metric-stat text-text-primary">{valor}</span>
        </div>
        {legenda && <span className="font-body-sm text-body-sm text-text-muted mt-1">{legenda}</span>}
      </div>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${CORES[cor]}`}>
        <span aria-hidden="true" className="material-symbols-outlined text-[24px]">
          {icone}
        </span>
      </div>
    </div>
  );
}
