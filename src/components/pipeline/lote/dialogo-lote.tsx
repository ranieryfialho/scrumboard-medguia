'use client';

// T-178 (fase4-pipeline-lote, AC-446/AC-450/AC-453/AC-454): o diálogo de cada
// ação em lote — etapa de destino (mover), responsável (reatribuir) ou motivo da
// perda (arquivar). "Arquivar" pede um segundo clique de confirmação, com a
// quantidade de cards, e não deixa confirmar sem motivo.
import { useState } from 'react';

import { ROTULO_DA_ACAO, type AcaoEmLote } from './tipos';

export interface OpcaoDoDialogo {
  id: string;
  nome: string;
}

interface DialogoLoteProps {
  acao: AcaoEmLote;
  quantidade: number;
  opcoes: OpcaoDoDialogo[];
  carregandoOpcoes: boolean;
  enviando: boolean;
  erro: string | null;
  onConfirmar: (valor: string) => void;
  onFechar: () => void;
}

const TITULO: Record<AcaoEmLote, string> = {
  mover: 'Mover Etapa em Lote',
  reatribuir: 'Reatribuir Comercial',
  arquivar: 'Arquivar cards',
};

const ROTULO_DO_CAMPO: Record<AcaoEmLote, { rotulo: string; placeholder: string }> = {
  mover: { rotulo: 'Etapa de destino', placeholder: 'Escolha a etapa' },
  reatribuir: { rotulo: 'Novo responsável', placeholder: 'Escolha o responsável' },
  arquivar: { rotulo: 'Motivo da perda', placeholder: 'Escolha o motivo' },
};

export function DialogoLote({ acao, quantidade, opcoes, carregandoOpcoes, enviando, erro, onConfirmar, onFechar }: DialogoLoteProps) {
  const [valor, setValor] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const campo = ROTULO_DO_CAMPO[acao];
  const cards = `${quantidade} ${quantidade === 1 ? 'card' : 'cards'}`;

  function aoClicarNoBotao() {
    if (!valor) return;
    // Arquivar: o primeiro clique só pede a confirmação (AC-454).
    if (acao === 'arquivar' && !confirmando) {
      setConfirmando(true);
      return;
    }
    onConfirmar(valor);
  }

  const textoDoBotao =
    acao === 'arquivar' && confirmando
      ? `Confirmar: arquivar ${cards}`
      : `${ROTULO_DA_ACAO[acao].botao} ${cards}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-space-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITULO[acao]}
        className="bg-surface-card rounded-2xl shadow-xl w-full max-w-md p-space-lg flex flex-col gap-space-md"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-headline-md text-headline-md text-text-primary">{TITULO[acao]}</h2>
            <p className="font-body-sm text-body-sm text-text-secondary">{cards} selecionado{quantidade === 1 ? '' : 's'}.</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onFechar} className="text-text-muted hover:text-text-primary">
            <span aria-hidden="true" className="material-symbols-outlined">
              close
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lote-campo" className="font-label-md text-label-md font-semibold text-text-primary">
            {campo.rotulo}
          </label>
          <div className="relative">
            <select
              id="lote-campo"
              value={valor}
              disabled={carregandoOpcoes || enviando}
              onChange={(evento) => {
                setValor(evento.target.value);
                setConfirmando(false);
              }}
              className="w-full h-10 pl-3 pr-8 rounded-xl bg-surface-subtle text-text-primary font-body-md text-body-md appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value="">{carregandoOpcoes ? 'Carregando...' : campo.placeholder}</option>
              {opcoes.map((opcao) => (
                <option key={opcao.id} value={opcao.id}>
                  {opcao.nome}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]"
            >
              expand_more
            </span>
          </div>
        </div>

        {acao === 'arquivar' && confirmando && (
          <p role="status" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            Vai marcar {cards} como perdido{quantidade === 1 ? '' : 's'}. Clique de novo para confirmar.
          </p>
        )}
        {erro && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            {erro}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="h-10 px-4 rounded-xl text-text-secondary hover:text-text-primary font-label-md text-label-md font-semibold"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valor || enviando}
            onClick={aoClicarNoBotao}
            className={`h-10 px-4 rounded-xl text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50 ${
              acao === 'arquivar' ? 'bg-danger-text' : 'bg-primary hover:bg-primary-container'
            }`}
          >
            {enviando ? 'Aplicando...' : textoDoBotao}
          </button>
        </div>
      </div>
    </div>
  );
}
