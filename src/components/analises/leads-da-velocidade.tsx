'use client';

// fase6-leads-da-velocidade (US-196, AC-826/AC-827): a lista dos leads que entraram na conta da "Velocidade do 1º contato". Uma linha
// por lead, da maior espera para a menor; o nome leva ao card. O filtro por faixa vem do clique nas faixas do bloco acima.
import Link from 'next/link';
import { useState } from 'react';

import { faixaDaEspera, type ChaveDeFaixa } from '@/domain/atendimento/horario-comercial';
import { OPCOES_POR_PAGINA, Paginacao } from '@/components/pipeline/pecas/paginacao';

export interface LeadDaVelocidadeView {
  oportunidadeId: string | null;
  lead: string;
  responsavel: string | null;
  entrada: string;
  primeiroContato: string;
  esperaCorrida: number;
  esperaComercial: number;
}

export interface FiltroDeFaixa {
  criterio: 'corrido' | 'comercial';
  faixa: ChaveDeFaixa;
}

const ROTULO_DA_FAIXA: Record<ChaveDeFaixa, string> = { ate1h: 'Até 1 h', de1a4h: '1 a 4 h', de4a24h: '4 a 24 h', mais24h: 'Mais de 24 h' };
const ROTULO_DO_CRITERIO: Record<FiltroDeFaixa['criterio'], string> = { corrido: 'relógio corrido', comercial: 'horário comercial' };

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/** AC-784: minutos até 2 h ("45 min"), horas até 2 dias ("19 h 41 min") e dias a partir daí ("3 d 4 h"). */
export function formatarEspera(minutos: number): string {
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 120) return `${Math.round(minutos)} min`;
  if (minutos < 2880) {
    const horas = Math.floor(minutos / 60);
    const resto = Math.round(minutos - horas * 60);
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  }
  const dias = Math.floor(minutos / 1440);
  const horas = Math.round((minutos - dias * 1440) / 60);
  return horas === 0 ? `${dias} d` : `${dias} d ${horas} h`;
}

interface Props {
  leads: LeadDaVelocidadeView[];
  filtro: FiltroDeFaixa | null;
  onLimparFiltro: () => void;
}

export function LeadsDaVelocidade({ leads, filtro, onLimparFiltro }: Props) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(OPCOES_POR_PAGINA[0]);

  const filtrados = filtro ? leads.filter((l) => faixaDaEspera(filtro.criterio === 'corrido' ? l.esperaCorrida : l.esperaComercial) === filtro.faixa) : leads;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);

  return (
    <section aria-label="Leads do tempo de resposta" className="rounded-xl border border-border-subtle overflow-hidden">
      <div className="p-space-sm flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <h4 className="font-label-lg text-label-lg text-text-primary">Leads do tempo de resposta</h4>
          <span className="font-body-sm text-body-sm text-text-muted">Quem esperou mais vem primeiro. Clique numa faixa acima para filtrar.</span>
        </div>
        {filtro && (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-subtle text-text-primary font-label-md text-label-md">
            {ROTULO_DA_FAIXA[filtro.faixa]} · {ROTULO_DO_CRITERIO[filtro.criterio]}
            <button type="button" onClick={onLimparFiltro} className="font-semibold underline">
              Limpar
            </button>
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-subtle font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
              <th className="px-space-sm py-2">Lead</th>
              <th className="px-space-sm py-2">Responsável</th>
              <th className="px-space-sm py-2">Entrada</th>
              <th className="px-space-sm py-2">1º contato</th>
              <th className="px-space-sm py-2">Espera (relógio)</th>
              <th className="px-space-sm py-2">Espera (comercial)</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l, i) => (
              <tr key={`${l.oportunidadeId ?? l.lead}-${i}`} className="border-t border-border-subtle font-body-md text-body-md text-text-primary">
                <td className="px-space-sm py-2.5">
                  {l.oportunidadeId ? (
                    <Link href={`/pipeline/${l.oportunidadeId}`} className="text-primary font-semibold hover:underline">
                      {l.lead}
                    </Link>
                  ) : (
                    l.lead
                  )}
                </td>
                <td className="px-space-sm py-2.5">{l.responsavel ?? <span className="text-text-muted">Sem responsável</span>}</td>
                <td className="px-space-sm py-2.5">{dataHora(l.entrada)}</td>
                <td className="px-space-sm py-2.5">{dataHora(l.primeiroContato)}</td>
                <td className="px-space-sm py-2.5">{formatarEspera(l.esperaCorrida)}</td>
                <td className="px-space-sm py-2.5">{formatarEspera(l.esperaComercial)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao
        pagina={paginaAtual}
        porPagina={porPagina}
        total={filtrados.length}
        onMudarPagina={setPagina}
        rotuloItem="leads"
        opcoesPorPagina={OPCOES_POR_PAGINA}
        onMudarPorPagina={(tamanho) => {
          setPorPagina(tamanho);
          setPagina(1);
        }}
      />
    </section>
  );
}
