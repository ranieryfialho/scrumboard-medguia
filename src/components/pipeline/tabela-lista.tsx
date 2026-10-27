'use client';

// T-161 (fase4-pipeline-telas, US-107, AC-394/AC-399): a tabela da lista —
// lead, etapa atual, responsável, valor estimado e próxima ação
// (`7._pipeline_lista_vis_o_em_lista/code.html`). Cada linha leva ao card
// (AC-399) e a marcação de linha/cabeçalho mostra "N selecionados" na barra
// de ações; as ações em lote ficam "em breve" (feature `fase4-pipeline-lote`,
// mesma peça `ItemEmBreve` de T-158).
import type { ReactNode } from 'react';
import Link from 'next/link';

import { SeloEtapa } from './pecas/selo-etapa';
import { nomeDaEtapaLista } from './filtros-lista';

export interface ItemTabelaLista {
  id: string;
  etapaId: number;
  valor: string | null;
  proximaAcaoEm: string | null;
  lead: {
    id: string;
    nome: string;
    email: string | null;
    telefoneE164: string | null;
  };
  responsavel: { id: string; nome: string } | null;
}

interface TabelaListaProps {
  itens: ItemTabelaLista[];
  selecionados: Set<string>;
  onAlternarSelecao: (id: string) => void;
  onAlternarTodos: () => void;
  /** T-178: a barra de ações em lote (feature `fase4-pipeline-lote`), desenhada acima da tabela. */
  barraDeAcoes?: ReactNode;
}

function formatarValor(valor: string | null): string | null {
  if (!valor) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarProximaAcao(iso: string | null): string {
  if (!iso) return 'Sem próxima ação';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function TabelaLista({ itens, selecionados, onAlternarSelecao, onAlternarTodos, barraDeAcoes }: TabelaListaProps) {
  const todosSelecionados = itens.length > 0 && itens.every((item) => selecionados.has(item.id));

  return (
    <div className="rounded-xl bg-surface-card shadow-sm overflow-hidden flex flex-col">
      {barraDeAcoes}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-subtle text-text-secondary font-table-header text-table-header uppercase tracking-wider h-11">
              <th className="w-12 px-4 py-2 text-center">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={todosSelecionados}
                  onChange={onAlternarTodos}
                  className="rounded text-primary focus:ring-0 cursor-pointer w-4 h-4"
                />
              </th>
              <th className="px-4 py-2 min-w-[220px]">Lead</th>
              <th className="px-4 py-2 min-w-[170px]">Etapa Atual</th>
              <th className="px-4 py-2 min-w-[160px]">Responsável</th>
              <th className="px-4 py-2 min-w-[120px] text-right">Valor Estimado</th>
              <th className="px-4 py-2 min-w-[180px]">Próxima Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y-0 text-text-primary font-body-md text-body-md">
            {itens.map((item) => {
              const valorFormatado = formatarValor(item.valor);
              return (
                <tr key={item.id} className="hover:bg-surface-subtle transition-colors h-14">
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${item.lead.nome}`}
                      checked={selecionados.has(item.id)}
                      onChange={() => onAlternarSelecao(item.id)}
                      className="rounded text-primary focus:ring-0 cursor-pointer w-4 h-4"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/pipeline/${item.id}`}
                      className="font-headline-sm text-[14px] text-text-primary hover:text-primary font-semibold transition-colors"
                    >
                      {item.lead.nome}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <SeloEtapa nome={nomeDaEtapaLista(item.etapaId)} />
                  </td>
                  <td className="px-4 py-2 text-text-secondary font-label-md text-label-md">
                    {item.responsavel?.nome ?? 'Sem responsável'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {valorFormatado ? (
                      <>
                        <span className="font-headline-sm text-[14px] font-bold text-text-primary">{valorFormatado}</span>
                        <span className="block text-text-muted font-label-sm text-[10px]">/mês</span>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-secondary font-label-md text-label-md">
                    {formatarProximaAcao(item.proximaAcaoEm)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
