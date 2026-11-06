'use client';

// T-162 (fase4-pipeline-telas, US-108, AC-401/AC-404): a tabela dos
// arquivados — status, lead, consultor (responsável), motivo (perdido) ou
// valor (ganho) e data de fechamento, como o
// `8._pipeline_arquivados_cards_arquivados/code.html`, sem os campos sem
// backend do protótipo (CNPJ, especialidade, ciclo de vendas). "Reabrir"
// por linha é a peça `BotaoReabrir` (T-156).
import { BotaoReabrir } from './botao-reabrir';

export interface ItemTabelaArquivados {
  id: string;
  status: 'ganho' | 'perdido';
  valor: string | null;
  /** ISO — `dataFechamento` já serializada pela rota (`ASM-134`). */
  dataFechamento: string;
  lead: { id: string; nome: string; email: string | null; telefoneE164: string | null };
  responsavel: { id: string; nome: string } | null;
  motivoPerda: { id: string; nome: string } | null;
}

interface TabelaArquivadosProps {
  itens: ItemTabelaArquivados[];
  podeReabrir: boolean;
  onReaberto: () => void;
}

function formatarValor(valor: string | null): string | null {
  if (!valor) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataFechamento(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function TabelaArquivados({ itens, podeReabrir, onReaberto }: TabelaArquivadosProps) {
  return (
    <div className="overflow-x-auto rounded-xl shadow-xs">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface-subtle text-text-secondary font-table-header text-table-header uppercase tracking-wider h-11">
            <th className="py-2.5 px-4 font-semibold">Status</th>
            <th className="py-2.5 px-4 font-semibold">Lead</th>
            <th className="py-2.5 px-4 font-semibold">Consultor</th>
            <th className="py-2.5 px-4 font-semibold">Motivo / Valor</th>
            <th className="py-2.5 px-4 font-semibold">Data Fechamento</th>
            <th className="py-2.5 px-4 font-semibold text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y-0 text-text-primary font-body-md text-body-md">
          {itens.map((item) => {
            const valorFormatado = formatarValor(item.valor);
            return (
              <tr key={item.id} className="bg-surface-card hover:bg-surface-subtle transition-colors">
                <td className="py-3 px-4">
                  {item.status === 'ganho' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm font-semibold">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                        check_circle
                      </span>
                      Ganho
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm font-semibold">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                        cancel
                      </span>
                      Perdido
                    </span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <span className="font-headline-sm text-[14px] text-text-primary font-semibold">{item.lead.nome}</span>
                </td>
                <td className="py-3 px-4 text-text-secondary font-label-md text-label-md">
                  {item.responsavel?.nome ?? 'Sem responsável'}
                </td>
                <td className="py-3 px-4">
                  {item.status === 'ganho' ? (
                    valorFormatado ? (
                      <>
                        <span className="font-metric-stat text-[15px] font-bold text-success-text">{valorFormatado}</span>
                        <span className="text-text-muted font-label-sm text-[10px]"> /mês</span>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )
                  ) : (
                    <span className="font-label-sm text-label-sm text-danger-text font-semibold">
                      {item.motivoPerda?.nome ?? 'Sem motivo registrado'}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-text-secondary font-label-md text-label-md">
                  {formatarDataFechamento(item.dataFechamento)}
                </td>
                <td className="py-3 px-4 text-right">
                  <BotaoReabrir
                    oportunidadeId={item.id}
                    leadNome={item.lead.nome}
                    podeReabrir={podeReabrir}
                    onReaberto={onReaberto}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
