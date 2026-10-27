'use client';

// T-178 (fase4-pipeline-lote, AC-447): o resultado de uma ação em lote —
// "N movidos, M não movidos" e, para cada card que falhou, o nome do lead e o
// motivo em português. Os que falharam continuam marcados na lista.
import { ROTULO_DA_ACAO, mensagemDoCodigo, type AcaoEmLote, type ResultadoDoLoteView } from './tipos';

interface ResultadoLoteProps {
  acao: AcaoEmLote;
  lote: ResultadoDoLoteView;
  /** Nome do lead de cada card (da lista, antes de ela recarregar). */
  nomes: Record<string, string>;
  onFechar: () => void;
}

export function ResultadoLote({ acao, lote, nomes, onFechar }: ResultadoLoteProps) {
  const rotulos = ROTULO_DA_ACAO[acao];
  const falhas = lote.resultados.filter((resultado) => !resultado.ok);

  return (
    <section
      aria-label="Resultado da ação em lote"
      className={`rounded-xl p-space-md shadow-sm flex flex-col gap-2 ${falhas.length === 0 ? 'bg-success-surface' : 'bg-warning-surface'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-headline-sm text-headline-sm text-text-primary">
          {lote.aplicados} {rotulos.feitos}
          {lote.falhas > 0 ? `, ${lote.falhas} ${rotulos.naoFeitos}` : ''}
        </p>
        <button type="button" onClick={onFechar} className="font-label-md text-label-md text-text-secondary hover:text-text-primary underline">
          Fechar
        </button>
      </div>
      {falhas.length > 0 && (
        <ul className="flex flex-col gap-1">
          {falhas.map((falha) => (
            <li key={falha.id} className="font-body-md text-body-md text-text-primary">
              <strong>{nomes[falha.id] ?? 'Card'}</strong>: {mensagemDoCodigo(falha.codigo)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
