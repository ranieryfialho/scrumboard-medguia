'use client';

// T-233 (fase5-acoes-rapidas, US-152, AC-650): "Promover a Lead" de um número avulso — pede o nome,
// cria o lead com o card em "Entrada de leads" e leva ao card (navegação simples, sem depender do roteador).
import { useState } from 'react';

const MENSAGENS: Record<string, string> = {
  NOME_OBRIGATORIO: 'Informe o nome do lead (de 2 a 120 caracteres).',
  NUMERO_INVALIDO: 'O número não é válido.',
  NUMERO_JA_E_LEAD: 'Este número já é de um lead.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

export function PromoverLead({ numero }: { numero: string }) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  async function promover() {
    setTrabalhando(true);
    setErro(null);
    try {
      const r = await fetch('/api/whatsapp/promover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ numero, nome }) });
      const corpo = (await r.json().catch(() => ({}))) as { codigo?: string; oportunidadeId?: string };
      if (r.ok && corpo.oportunidadeId) {
        window.location.assign(`/pipeline/${corpo.oportunidadeId}`);
        return;
      }
      setErro((corpo.codigo && MENSAGENS[corpo.codigo]) || 'Não foi possível promover. Tente de novo.');
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          aria-label={`Nome do lead para ${numero}`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do lead"
          className="h-9 flex-1 min-w-32 rounded-lg border border-border-subtle bg-surface-card px-3 font-body-sm text-body-sm"
        />
        <button type="button" disabled={trabalhando} onClick={() => void promover()} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50">
          Promover a Lead
        </button>
      </div>
      {erro && (
        <p role="alert" className="font-body-sm text-body-sm text-danger-text">
          {erro}
        </p>
      )}
    </div>
  );
}
