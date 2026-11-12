'use client';

// fase6-perdas-por-lead (US-194, AC-816/AC-817): a lista "Leads perdidos" do relatório comercial — uma linha por lead perdido no
// período, com o responsável, o motivo, a etapa em que estava, a origem e a data da perda; o nome leva ao card. Paginada de 10 em 10
// (20, 50 e 100 no seletor). Quem filtra por motivo é a tela (o clique no bloco de motivos); aqui só se mostra o filtro ativo.
import Link from 'next/link';
import { useState } from 'react';

import { OPCOES_POR_PAGINA, Paginacao } from '@/components/pipeline/pecas/paginacao';

export interface LeadPerdidoView {
  oportunidadeId: string;
  lead: string;
  responsavel: string | null;
  motivo: string;
  etapaOrigem: string | null;
  origem: string | null;
  perdidoEm: string;
}

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

interface Props {
  leads: LeadPerdidoView[];
  /** O motivo escolhido no bloco de motivos, para mostrar o filtro ativo; `null` = lista completa. */
  filtroMotivo: string | null;
  onLimparFiltro: () => void;
}

export function ListaLeadsPerdidos({ leads, filtroMotivo, onLimparFiltro }: Props) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(OPCOES_POR_PAGINA[0]);
  const totalPaginas = Math.max(1, Math.ceil(leads.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = leads.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);

  return (
    <section aria-label="Leads perdidos" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
      <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Leads perdidos</h2>
          <p className="font-body-sm text-body-sm text-text-muted">Quem foi perdido no período, de quem era e por quê. Clique num motivo acima para filtrar.</p>
        </div>
        {filtroMotivo && (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-danger-surface text-danger-text font-label-md text-label-md">
            Motivo: {filtroMotivo}
            <button type="button" onClick={onLimparFiltro} className="font-semibold underline">
              Limpar
            </button>
          </span>
        )}
      </div>
      {leads.length === 0 ? (
        <p className="px-space-md pb-space-md font-body-md text-body-md text-text-secondary">{filtroMotivo ? 'Nenhum lead perdido por este motivo no período.' : 'Nenhum lead perdido no período.'}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-subtle font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
                  <th className="px-space-md py-2">Lead</th>
                  <th className="px-space-md py-2">Responsável</th>
                  <th className="px-space-md py-2">Motivo</th>
                  <th className="px-space-md py-2">Etapa em que estava</th>
                  <th className="px-space-md py-2">Origem</th>
                  <th className="px-space-md py-2">Perdido em</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => (
                  <tr key={l.oportunidadeId} className="border-t border-border-subtle font-body-md text-body-md text-text-primary">
                    <td className="px-space-md py-2.5">
                      <Link href={`/pipeline/${l.oportunidadeId}`} className="text-primary font-semibold hover:underline">
                        {l.lead}
                      </Link>
                    </td>
                    <td className="px-space-md py-2.5">{l.responsavel ?? <span className="text-text-muted">Sem responsável</span>}</td>
                    <td className="px-space-md py-2.5">{l.motivo}</td>
                    <td className="px-space-md py-2.5">{l.etapaOrigem ?? <span className="text-text-muted">—</span>}</td>
                    <td className="px-space-md py-2.5">{l.origem ?? <span className="text-text-muted">—</span>}</td>
                    <td className="px-space-md py-2.5 whitespace-nowrap">{data(l.perdidoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacao
            pagina={paginaAtual}
            porPagina={porPagina}
            total={leads.length}
            onMudarPagina={setPagina}
            rotuloItem="leads"
            opcoesPorPagina={OPCOES_POR_PAGINA}
            onMudarPorPagina={(tamanho) => {
              setPorPagina(tamanho);
              setPagina(1);
            }}
          />
        </>
      )}
    </section>
  );
}
