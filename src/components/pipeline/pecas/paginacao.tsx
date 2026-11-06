'use client';

// T-158 (fase4-pipeline-telas, AC-395/AC-402): paginação compartilhada da
// lista e dos arquivados — "Exibindo N a M de T" e os botões de página do
// protótipo (`7._pipeline_lista_vis_o_em_lista/code.html`). Só mostra o que
// recebe por prop; quem busca a página no servidor e valida o tamanho
// é a tela que a usa (T-161/T-162). Com `opcoesPorPagina` + `onMudarPorPagina`
// aparece também o seletor "Itens por página" (as telas sem altura fixa).

/** Tamanhos de página oferecidos no seletor das telas de lista. */
export const OPCOES_POR_PAGINA = [10, 20, 50, 100] as const;

interface PaginacaoProps {
  pagina: number;
  porPagina: number;
  total: number;
  onMudarPagina: (pagina: number) => void;
  /** Nome do item no plural, para a frase "Exibindo N a M de T <rotuloItem>". */
  rotuloItem?: string;
  /** Tamanhos do seletor "Itens por página"; sem isto (ou sem `onMudarPorPagina`) o seletor não aparece. */
  opcoesPorPagina?: readonly number[];
  onMudarPorPagina?: (porPagina: number) => void;
}

export function Paginacao({
  pagina,
  porPagina,
  total,
  onMudarPagina,
  rotuloItem = 'itens',
  opcoesPorPagina,
  onMudarPorPagina,
}: PaginacaoProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = total === 0 ? 0 : Math.min(pagina * porPagina, total);
  const paginas = paginasVisiveis(pagina, totalPaginas);

  return (
    <div className="px-space-md py-3 bg-surface-card flex flex-col sm:flex-row items-center justify-between gap-space-sm">
      <span className="font-body-sm text-body-sm text-text-secondary">
        {total === 0 ? (
          `Nenhum ${rotuloItem.replace(/s$/, '')} encontrado`
        ) : (
          <>
            Exibindo{' '}
            <strong>
              {inicio} a {fim}
            </strong>{' '}
            de <strong>{total}</strong> {rotuloItem}
          </>
        )}
      </span>
      <div className="flex items-center gap-space-md flex-wrap justify-center">
        {opcoesPorPagina && onMudarPorPagina && (
          <label className="flex items-center gap-2 font-body-sm text-body-sm text-text-secondary">
            Itens por página
            <select
              value={porPagina}
              onChange={(evento) => onMudarPorPagina(Number(evento.target.value))}
              className="h-8 px-2 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {opcoesPorPagina.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {opcao}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMudarPagina(pagina - 1)}
          disabled={pagina <= 1}
          aria-label="Página anterior"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            chevron_left
          </span>
        </button>
        {paginas.map((p, indice) =>
          p === null ? (
            <span key={`reticencias-${indice}`} className="w-8 h-8 flex items-center justify-center text-text-muted">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onMudarPagina(p)}
              aria-current={p === pagina ? 'page' : undefined}
              className={
                p === pagina
                  ? 'w-8 h-8 rounded-lg flex items-center justify-center bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-xs'
                  : 'w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-subtle font-label-md text-label-md transition-colors'
              }
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onMudarPagina(pagina + 1)}
          disabled={pagina >= totalPaginas}
          aria-label="Próxima página"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            chevron_right
          </span>
        </button>
        </div>
      </div>
    </div>
  );
}

/** Todas as páginas se couberem em 7 botões; senão mantém pontas e vizinhas da atual, com reticências entre lacunas. */
function paginasVisiveis(atual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const fixas = new Set<number>([1, 2, total - 1, total, atual - 1, atual, atual + 1]);
  const ordenadas = [...fixas].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const resultado: (number | null)[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    if (i > 0 && ordenadas[i] - ordenadas[i - 1] > 1) resultado.push(null);
    resultado.push(ordenadas[i]);
  }
  return resultado;
}
