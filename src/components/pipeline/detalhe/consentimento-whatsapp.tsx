'use client';

// T-248 (fase5-whatsapp-lote-base, US-159, AC-669): "Autoriza receber WhatsApp" no card do lead — mostra se há
// consentimento (por quem e quando) e deixa registrar ou revogar. Fica em bloco próprio, abaixo de
// "Informações Principais" (que só mostra os dados do card, AC-407). Falha da API vira aviso, nunca derruba a tela.
import { useCallback, useEffect, useState } from 'react';

interface Estado {
  consentimento: boolean;
  em: string | null;
  porNome: string | null;
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function ConsentimentoWhatsapp({ leadId }: { leadId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/leads/${leadId}/consentimento`);
      if (!r?.ok) throw new Error(`consentimento respondeu ${r?.status}`);
      setEstado((await r.json()) as Estado);
    } catch {
      setAviso('Não foi possível carregar o consentimento.');
    }
  }, [leadId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mudar(consentimento: boolean) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/consentimento`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consentimento }) });
      if (!r?.ok) throw new Error(`consentimento respondeu ${r?.status}`);
      setEstado((await r.json()) as Estado);
    } catch {
      setAviso('Não foi possível salvar o consentimento. Tente de novo.');
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <section aria-label="Consentimento de WhatsApp" className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
      <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-primary text-[20px]">
          verified_user
        </span>
        Autoriza receber WhatsApp
      </h2>
      {estado && (
        <p className="font-body-md text-body-md text-text-secondary">
          {estado.consentimento ? `Consentido${estado.porNome ? ` por ${estado.porNome}` : ''}${estado.em ? ` em ${data(estado.em)}` : ''}` : 'Sem consentimento'}
        </p>
      )}
      {estado && (
        <button
          type="button"
          disabled={trabalhando}
          onClick={() => void mudar(!estado.consentimento)}
          className={`self-start h-9 px-3 rounded-lg font-label-md text-label-md font-semibold disabled:opacity-50 ${estado.consentimento ? 'bg-surface-subtle text-text-primary' : 'bg-primary text-on-primary'}`}
        >
          {estado.consentimento ? 'Revogar' : 'Registrar consentimento'}
        </button>
      )}
      {aviso && (
        <p role="alert" className="font-body-sm text-body-sm text-danger-text">
          {aviso}
        </p>
      )}
    </section>
  );
}
