'use client';

// T-288 (fase4-card-abas, US-114, AC-740): o menu "Mais opções" da conversa — atualizar, marcar como lidas e abrir o número
// no WhatsApp Web. Fecha ao escolher um item, ao clicar fora ou com Esc.
import { useEffect, useRef, useState } from 'react';

interface MenuOpcoesProps {
  /** Dígitos do telefone escolhido; sem ele o item do WhatsApp Web não aparece. */
  numero: string | null;
  onAtualizar: () => void;
  onMarcarLidas: () => void;
}

export function MenuOpcoes({ numero, onAtualizar, onMarcarLidas }: MenuOpcoesProps) {
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

  const itemClasse = 'w-full text-left px-3 py-2 flex items-center gap-2 font-body-md text-body-md text-text-primary hover:bg-surface-subtle';

  return (
    <div className="relative" ref={raiz}>
      <button
        type="button"
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="h-10 w-10 rounded-xl bg-surface-subtle hover:bg-surface-container flex items-center justify-center"
      >
        <span aria-hidden="true" className="material-symbols-outlined">
          more_vert
        </span>
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-60 rounded-xl bg-surface-card shadow-xl py-1 overflow-hidden">
          <button
            type="button"
            role="menuitem"
            className={itemClasse}
            onClick={() => {
              setAberto(false);
              onAtualizar();
            }}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            Atualizar conversa
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClasse}
            onClick={() => {
              setAberto(false);
              onMarcarLidas();
            }}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              done_all
            </span>
            Marcar como lidas
          </button>
          {numero && (
            <a role="menuitem" className={itemClasse} href={`https://wa.me/${numero}`} target="_blank" rel="noopener noreferrer" onClick={() => setAberto(false)}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                open_in_new
              </span>
              Abrir no WhatsApp Web
            </a>
          )}
        </div>
      )}
    </div>
  );
}
