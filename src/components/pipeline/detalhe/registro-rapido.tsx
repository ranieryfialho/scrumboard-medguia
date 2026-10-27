// T-163 (fase4-pipeline-telas, US-109, AC-409): "Registrar Interação Rápida"
// — só a aba "Anotação Interna" tem backend (`POST
// /api/oportunidades/:id/anotacoes`, T-156); as outras três do protótipo
// (Registrar Ligação, Agendar Reunião, Disparar WhatsApp) ficam fora do
// escopo desta feature (decisão do usuário, 26/10) e aparecem "em breve"
// (AC-411), sem alternar para elas.
'use client';

import { useState } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';

interface RegistroRapidoProps {
  oportunidadeId: string;
  onRegistrado: () => void;
}

/** AC-409: texto vazio não envia; ao salvar, o campo é limpo e a linha do tempo recarrega. */
export function RegistroRapido({ oportunidadeId, onRegistrado }: RegistroRapidoProps) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const textoLimpo = texto.trim();
    if (!textoLimpo) return;

    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/oportunidades/${oportunidadeId}/anotacoes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: textoLimpo }),
      });
      if (!resposta.ok) throw new Error(`anotações respondeu ${resposta.status}`);
      setTexto('');
      onRegistrado();
    } catch {
      setErro('Não foi possível salvar a anotação. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
      <div className="flex items-center gap-2 font-headline-sm text-headline-sm text-text-primary border-b border-border-subtle pb-space-sm">
        <span aria-hidden="true" className="material-symbols-outlined text-primary text-[22px]">
          bolt
        </span>
        Registrar Interação Rápida
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          aria-pressed="true"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md shadow-sm"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            note_alt
          </span>
          Anotação Interna
        </button>
        <ItemEmBreve rotulo="Registrar Ligação" icone="phone_in_talk" className="px-3 py-1.5 rounded-lg bg-surface-subtle" />
        <ItemEmBreve rotulo="Agendar Reunião" icone="event" className="px-3 py-1.5 rounded-lg bg-surface-subtle" />
        <ItemEmBreve rotulo="Disparar WhatsApp" icone="send" className="px-3 py-1.5 rounded-lg bg-surface-subtle" />
      </div>

      <textarea
        aria-label="Anotação interna"
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        placeholder="Digite uma anotação médica comercial, resumo de chamada telefônica ou pontos combinados..."
        rows={3}
        disabled={enviando}
        className="w-full p-3 bg-surface-subtle rounded-lg font-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none transition-all resize-none"
      />

      {erro && <p className="font-body-sm text-body-sm text-danger-text">{erro}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => setTexto('')}
          disabled={enviando}
          className="px-3 py-1.5 rounded-lg font-label-md text-label-md text-text-secondary hover:bg-surface-subtle transition-colors disabled:opacity-50"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={enviando || !texto.trim()}
          className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[17px]">
            save
          </span>
          Salvar Registro
        </button>
      </div>
    </div>
  );
}
