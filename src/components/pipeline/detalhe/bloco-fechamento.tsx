'use client';

// T-313 (fase4-pipeline, US-114): o bloco "Fechamento" do detalhe do card — os dados que o CRM antigo pedia ao fechar o cliente.
// Aparece quando o card está em "Contrato (Ganho)" ou já tem fechamento registrado; o botão abre o mesmo modal para preencher ou
// corrigir. Qualquer papel que acessa o card edita (como os demais dados do card).
import { useCallback, useEffect, useState } from 'react';

import { ModalFechamentoDoCard } from '@/components/pipeline/modal-fechamento';
import type { DadosFechamento } from '@/domain/pipeline/fechamento';

const ETAPA_CONTRATO_GANHO = 15;

interface Registrado extends DadosFechamento {
  registradoEm: string;
}

const ROTULOS: [keyof DadosFechamento, string][] = [
  ['plataformaAnterior', 'Plataforma anterior'],
  ['deixouADesejar', 'O que deixou a desejar'],
  ['maisInteressou', 'O que mais interessou na MedGuia'],
  ['plano', 'Plano escolhido'],
  ['porOndeConheceu', 'Por onde conheceu'],
];

export function BlocoFechamento({ cardId, etapaId, versao = 0 }: { cardId: string; etapaId: number; versao?: number }) {
  const [fechamento, setFechamento] = useState<Registrado | null | undefined>(undefined);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/oportunidades/${cardId}/fechamento`);
      setFechamento(r.ok ? ((await r.json()) as { fechamento: Registrado | null }).fechamento : null);
    } catch {
      setFechamento(null);
    }
  }, [cardId]);

  useEffect(() => {
    void carregar();
  }, [carregar, versao, etapaId]);

  async function salvar(dados: DadosFechamento) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/oportunidades/${cardId}/fechamento`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
      if (!r.ok) {
        setErro('Não foi possível salvar o fechamento. Tente de novo.');
        return;
      }
      setFechamento(((await r.json()) as { fechamento: Registrado }).fechamento);
      setEditando(false);
    } catch {
      setErro('Não foi possível salvar o fechamento. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  if (fechamento === undefined) return null;
  if (!fechamento && etapaId !== ETAPA_CONTRATO_GANHO) return null;

  return (
    <section aria-label="Fechamento" className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
      <div className="flex items-center justify-between pb-space-sm border-b border-border-subtle">
        <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-success-text">handshake</span>
          Fechamento
        </h2>
        <button type="button" onClick={() => setEditando(true)} className="h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
          {fechamento ? 'Editar' : 'Registrar fechamento'}
        </button>
      </div>
      {fechamento ? (
        <>
          <dl className="flex flex-col gap-2">
            {ROTULOS.map(([campo, rotulo]) => (
              <div key={campo} className="flex flex-col">
                <dt className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{rotulo}</dt>
                <dd className="font-body-md text-body-md text-text-primary">{fechamento[campo]}</dd>
              </div>
            ))}
            <div className="flex flex-col">
              <dt className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Observações gerais</dt>
              <dd className="font-body-md text-body-md text-text-primary whitespace-pre-wrap">{fechamento.observacoes}</dd>
            </div>
          </dl>
          <p className="font-body-sm text-body-sm text-text-muted">Registrado em {new Date(fechamento.registradoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
        </>
      ) : (
        <p className="font-body-md text-body-md text-text-secondary">Este cliente já fechou, mas os dados do fechamento ainda não foram registrados.</p>
      )}
      {editando && (
        <ModalFechamentoDoCard cardId={cardId} modo="editar" inicial={fechamento ?? undefined} salvando={salvando} erro={erro} onCancelar={() => setEditando(false)} onConfirmar={(d) => void salvar(d)} />
      )}
    </section>
  );
}
