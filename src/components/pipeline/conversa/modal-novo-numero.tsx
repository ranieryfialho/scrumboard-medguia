'use client';

// T-288 (fase4-card-abas, US-114, AC-740): "Novo Número" — cadastra um telefone extra do lead sem sair da conversa
// (`POST /api/leads/:id/telefones`, o mesmo cadastro de AC-160 a AC-162). Mostra o motivo da recusa e mantém o que foi digitado.
import { useState } from 'react';

const MENSAGENS: Record<string, string> = {
  REQUISICAO_INVALIDA: 'Número inválido. Use DDD e número, por exemplo (11) 98765-4321.',
  TELEFONE_DUPLICADO: 'Esse número já está cadastrado para este lead.',
  LEAD_NAO_ENCONTRADO: 'Lead não encontrado.',
};

interface ModalNovoNumeroProps {
  leadId: string;
  onFechar: () => void;
  /** Chamado depois de salvar, para a conversa reler os telefones. */
  onSalvo: () => void;
}

export function ModalNovoNumero({ leadId, onFechar, onSalvo }: ModalNovoNumeroProps) {
  const [numero, setNumero] = useState('');
  const [rotulo, setRotulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (numero.trim() === '') {
      setErro('Informe o número.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/leads/${leadId}/telefones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero, ...(rotulo.trim() ? { rotulo: rotulo.trim() } : {}) }),
      });
      if (resposta.ok) {
        onSalvo();
        return;
      }
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      setErro(MENSAGENS[corpo?.codigo ?? ''] ?? 'Não foi possível salvar o número. Tente de novo.');
    } catch {
      setErro('Não foi possível salvar o número. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const classe =
    'w-full h-10 px-3 bg-surface-subtle rounded-xl font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="novo-numero-titulo">
      <form onSubmit={salvar} className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-space-lg flex flex-col gap-space-md">
        <h2 id="novo-numero-titulo" className="font-headline-sm text-headline-sm text-text-primary">
          Novo número
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="novo-numero-numero" className="font-label-md text-label-md text-text-secondary">
            Telefone *
          </label>
          <input id="novo-numero-numero" type="tel" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="(11) 98765-4321" className={classe} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="novo-numero-rotulo" className="font-label-md text-label-md text-text-secondary">
            Rótulo
          </label>
          <input id="novo-numero-rotulo" type="text" maxLength={60} value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Recepção, Financeiro…" className={classe} />
        </div>
        {erro && (
          <p role="alert" className="font-body-sm text-danger-text">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={salvando} className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
      </form>
    </div>
  );
}
