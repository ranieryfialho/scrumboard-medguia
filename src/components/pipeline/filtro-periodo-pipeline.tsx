'use client';

// fase6-periodo-personalizado (US-195, AC-820): o controle de período das telas do pipeline (funil, lista e arquivados).
// Um botão "Período" abre o painel com os períodos prontos, o "Personalizado" (De/Até) e o seletor "Data" — a data do card
// que o intervalo filtra: a entrada do lead ou a última movimentação (mudança de etapa). Quem monta o pedido ao servidor é a
// tela (`parametrosDoPeriodoPipeline`); o servidor recusa período inválido com 400 `PERIODO_INVALIDO` (AC-824).
import { useEffect, useRef, useState } from 'react';

import { periodoDe, rotuloDoPeriodo, type PeriodoEscolhido, type Preset } from '../analises/comum';
import { FiltroPeriodo } from '../analises/filtro-periodo';
import type { CampoDataPeriodo } from '../../domain/pipeline/periodo';

export interface ValorPeriodoPipeline {
  /** Sem período escolhido, o filtro de datas não vale e a tela mostra tudo. */
  periodo?: PeriodoEscolhido;
  data: CampoDataPeriodo;
}

export const PERIODO_PIPELINE_VAZIO: ValorPeriodoPipeline = { data: 'entrada' };

const PRESETS: Preset[] = ['hoje', '7dias', '30dias', 'mes', 'trimestre'];

const ROTULO_DA_DATA: Record<CampoDataPeriodo, string> = {
  entrada: 'Entrada do lead',
  movimentacao: 'Última movimentação',
};

export function periodoPipelineAtivo(valor: ValorPeriodoPipeline): boolean {
  return valor.periodo !== undefined;
}

/** Os parâmetros `de`, `ate` e `data` do pedido ao servidor; vazio quando não há período. */
export function parametrosDoPeriodoPipeline(valor: ValorPeriodoPipeline, agora: Date = new Date()): Record<string, string> {
  if (!valor.periodo) return {};
  const { de, ate } = periodoDe(valor.periodo, agora);
  return { de, ate, data: valor.data };
}

interface FiltroPeriodoPipelineProps {
  valor: ValorPeriodoPipeline;
  onMudar: (valor: ValorPeriodoPipeline) => void;
}

const LARGURA_DO_PAINEL = 336; // 21rem

export function FiltroPeriodoPipeline({ valor, onMudar }: FiltroPeriodoPipelineProps) {
  const [aberto, setAberto] = useState(false);
  // O painel abre alinhado à esquerda do botão; se não couber até a borda direita da tela, alinha à direita (nunca estoura).
  const [alinharADireita, setAlinharADireita] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const ativo = periodoPipelineAtivo(valor);

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (evento: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(evento.target as Node)) setAberto(false);
    };
    const esc = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  function alternar() {
    if (!aberto && raiz.current) {
      setAlinharADireita(raiz.current.getBoundingClientRect().left + LARGURA_DO_PAINEL > window.innerWidth - 16);
    }
    setAberto((atual) => !atual);
  }

  return (
    <div className="relative" ref={raiz}>
      <button
        type="button"
        aria-expanded={aberto}
        title={ativo ? `Filtrando pela data: ${ROTULO_DA_DATA[valor.data].toLowerCase()}` : undefined}
        onClick={alternar}
        className={`h-10 px-3 rounded-xl shadow-sm flex items-center gap-2 font-label-md text-label-md ${ativo ? 'bg-primary/10 text-primary font-semibold' : 'bg-surface-card text-text-secondary'}`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          calendar_today
        </span>
        {ativo && valor.periodo ? `Período: ${rotuloDoPeriodo(valor.periodo)}` : 'Período'}
      </button>
      {aberto && (
        <div
          role="group"
          aria-label="Filtro de período"
          className={`absolute top-full z-30 mt-2 w-[21rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border-subtle bg-surface-card p-space-sm shadow-lg flex flex-col gap-space-sm ${alinharADireita ? 'right-0' : 'left-0'}`}
        >
          <label className="flex flex-col gap-1 font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
            Filtrar pela data de
            <select
              aria-label="Data do período"
              value={valor.data}
              onChange={(evento) => onMudar({ ...valor, data: evento.target.value as CampoDataPeriodo })}
              className="h-9 px-2 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md normal-case tracking-normal"
            >
              <option value="entrada">{ROTULO_DA_DATA.entrada}</option>
              <option value="movimentacao">{ROTULO_DA_DATA.movimentacao}</option>
            </select>
          </label>
          <FiltroPeriodo
            compacto
            valor={valor.periodo ?? null}
            presets={PRESETS}
            onMudar={(periodo) => {
              onMudar({ ...valor, periodo });
              setAberto(false);
            }}
          />
          {ativo && (
            <button
              type="button"
              onClick={() => {
                onMudar({ data: valor.data });
                setAberto(false);
              }}
              className="self-start h-8 px-3 rounded-lg text-text-secondary hover:text-danger-text font-label-md text-label-md font-semibold"
            >
              Remover período
            </button>
          )}
        </div>
      )}
    </div>
  );
}
