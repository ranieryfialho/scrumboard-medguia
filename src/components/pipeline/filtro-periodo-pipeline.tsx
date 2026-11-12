'use client';

// fase6-periodo-personalizado (US-195, AC-820): o controle de período das telas do pipeline (funil, lista e arquivados).
// Um botão "Período" abre o painel com os períodos prontos, o "Personalizado" (De/Até) e o seletor "Data" — a data do card
// que o intervalo filtra: a entrada do lead ou a última movimentação (mudança de etapa). Quem monta o pedido ao servidor é a
// tela (`parametrosDoPeriodoPipeline`); o servidor recusa período inválido com 400 `PERIODO_INVALIDO` (AC-824).
import { useState } from 'react';

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

export function FiltroPeriodoPipeline({ valor, onMudar }: FiltroPeriodoPipelineProps) {
  const [aberto, setAberto] = useState(false);
  const ativo = periodoPipelineAtivo(valor);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((atual) => !atual)}
        className={`h-10 px-3 rounded-xl shadow-sm flex items-center gap-2 font-label-md text-label-md ${ativo ? 'bg-primary/10 text-primary font-semibold' : 'bg-surface-card text-text-secondary'}`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          calendar_today
        </span>
        {ativo && valor.periodo ? `Período: ${rotuloDoPeriodo(valor.periodo)} · ${ROTULO_DA_DATA[valor.data]}` : 'Período'}
      </button>
      {aberto && (
        <div role="group" aria-label="Filtro de período" className="absolute left-0 top-full z-20 mt-2 w-max max-w-[90vw] rounded-xl bg-surface-card p-space-sm shadow-lg flex flex-col gap-space-sm">
          <FiltroPeriodo valor={valor.periodo ?? null} presets={PRESETS} onMudar={(periodo) => onMudar({ ...valor, periodo })} />
          <label className="flex items-center gap-2 font-label-md text-label-md text-text-secondary">
            Data
            <select
              aria-label="Data do período"
              value={valor.data}
              onChange={(evento) => onMudar({ ...valor, data: evento.target.value as CampoDataPeriodo })}
              className="h-8 px-2 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md"
            >
              <option value="entrada">{ROTULO_DA_DATA.entrada}</option>
              <option value="movimentacao">{ROTULO_DA_DATA.movimentacao}</option>
            </select>
          </label>
          {ativo && (
            <button
              type="button"
              onClick={() => onMudar({ data: valor.data })}
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
