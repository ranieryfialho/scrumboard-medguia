// T-158 (fase4-pipeline-telas, US-106/US-108): peça compartilhada para os
// itens e blocos do protótipo Stitch sem backend ainda (AC-393: busca
// global, "Iniciar Cadência em Massa" e visões salvas no funil; AC-405: os
// quatro blocos de análise dos arquivados). Mesmo padrão visual já usado
// solto em `src/components/shell/topo.tsx` e
// `src/components/auth/painel-sem-acesso.tsx` (T-140/T-152): o selo "Em
// breve" e um wrapper que mantém o item visível, porém inerte — sem
// `onClick`, sem `href`, para nenhum papel.

/** O selo isolado, para compor dentro de um item já existente. */
export function SeloEmBreve({ texto = 'Em breve' }: { texto?: string }) {
  return (
    <span className="font-label-sm text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-text-muted uppercase tracking-wider font-semibold">
      {texto}
    </span>
  );
}

interface ItemEmBreveProps {
  /** Texto do item do protótipo (ex.: "Iniciar Cadência em Massa"). */
  rotulo: string;
  /** Nome do ícone do Material Symbols, quando o item tiver um. */
  icone?: string;
  /** Classe extra para encaixar no layout do chamador (bloco, botão de barra, item de menu…). */
  className?: string;
}

/**
 * AC-393/AC-405: o item/bloco do protótipo inteiro, visível e com o selo,
 * mas sem nenhum manipulador de evento — clicar nele não faz nada. Usa
 * `<div role="button" aria-disabled>` em vez de `<button disabled>` porque
 * alguns dos itens do protótipo são blocos inteiros (cartão de análise), não
 * só botões pequenos, e `disabled` nativo barraria até o hover de prova
 * visual que os outros itens "em breve" da casca mantêm.
 */
export function ItemEmBreve({ rotulo, icone, className = '' }: ItemEmBreveProps) {
  return (
    <div
      role="button"
      aria-disabled="true"
      aria-label={`${rotulo} (em breve)`}
      className={`cursor-not-allowed text-text-muted flex items-center gap-2 ${className}`}
    >
      {icone && (
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          {icone}
        </span>
      )}
      <span className="font-body-md text-body-md">{rotulo}</span>
      <SeloEmBreve />
    </div>
  );
}
