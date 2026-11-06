'use client';

import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';

export interface ReacaoView {
  autor: 'nos' | 'contato';
  emoji: string;
}

/** As reações rápidas do WhatsApp. */
export const EMOJIS_DE_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** O emoji embaixo do balão (a reação da empresa e/ou a do cliente). Não aparece sem reação. */
export function ReacoesDaMensagem({ reacoes, enviada }: { reacoes: ReacaoView[]; enviada: boolean }) {
  if (reacoes.length === 0) return null;
  const emojis = [...new Set(reacoes.map((r) => r.emoji))];
  const quem = reacoes.map((r) => `${r.autor === 'nos' ? 'Você' : 'Contato'}: ${r.emoji}`).join(', ');
  return (
    <span
      data-testid="reacoes-da-mensagem"
      title={quem}
      aria-label={`Reações — ${quem}`}
      className={`absolute -bottom-3.5 ${enviada ? 'right-2' : 'left-2'} inline-flex items-center gap-0.5 rounded-full bg-surface-card border border-border-subtle shadow-sm px-1.5 py-0.5 text-[13px] leading-none text-text-primary`}
    >
      {emojis.map((emoji) => (
        <span key={emoji} aria-hidden="true">
          {emoji}
        </span>
      ))}
      {reacoes.length > 1 && emojis.length === 1 && (
        <span aria-hidden="true" className="font-label-sm text-[10px] text-text-secondary">
          {reacoes.length}
        </span>
      )}
    </span>
  );
}

interface BotaoReagirProps {
  /** A reação da empresa nesta mensagem, se houver (clicar nela de novo retira). */
  minhaReacao: string | null;
  onReagir: (emoji: string) => void;
}

/** O botão de carinha que aparece ao passar o mouse no balão e abre as reações rápidas. */
export function BotaoReagir({ minhaReacao, onReagir }: BotaoReagirProps) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);

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

  const escolher = (emoji: string) => {
    setAberto(false);
    // Clicar na reação que já é sua tira a reação, como no WhatsApp.
    onReagir(emoji === minhaReacao ? '' : emoji);
  };

  return (
    <div ref={raiz} className="relative shrink-0 self-center">
      <button
        type="button"
        aria-label="Reagir à mensagem"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={`size-7 rounded-full flex items-center justify-center text-text-muted hover:text-primary hover:bg-surface-subtle transition-opacity focus-visible:opacity-100 ${aberto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <SmilePlus aria-hidden="true" className="size-4" />
      </button>
      {aberto && (
        <div
          role="menu"
          aria-label="Reações"
          className="absolute z-20 bottom-full mb-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-surface-card shadow-lg border border-border-subtle px-1.5 py-1"
        >
          {EMOJIS_DE_REACAO.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              aria-label={emoji === minhaReacao ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}
              onClick={() => escolher(emoji)}
              className={`size-8 rounded-full text-lg leading-none hover:bg-surface-subtle hover:scale-110 transition-transform ${emoji === minhaReacao ? 'bg-primary-fixed' : ''}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
