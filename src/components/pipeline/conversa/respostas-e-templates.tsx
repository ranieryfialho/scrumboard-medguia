'use client';

// T-288 (fase4-card-abas, US-114, AC-741): "Respostas rápidas" e "Templates" da conversa. As duas usam os templates APROVADOS da
// empresa (`GET /api/whatsapp/templates`, os mesmos de `/whatsapp/templates`): as respostas rápidas são os primeiros como atalhos
// de um clique e "Templates" abre a lista inteira com a prévia. Escolher um coloca o texto, com {{nome}} e {{primeiro_nome}} já
// trocados pelos do lead, no campo da mensagem — nada é enviado até o usuário apertar enviar.
import { useEffect, useRef, useState } from 'react';

import { renderizarTemplate } from '@/lib/whatsapp/template';

interface TemplateDaLista {
  id: string;
  nome: string;
  corpo: string;
  status: 'rascunho' | 'aprovado' | 'arquivado';
}

const RAPIDAS = 4;

interface Props {
  leadNome: string;
  /** Recebe o texto já preenchido para pôr no campo da mensagem. */
  onEscolher: (texto: string) => void;
}

export function RespostasETemplates({ leadNome, onEscolher }: Props) {
  const [templates, setTemplates] = useState<TemplateDaLista[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/whatsapp/templates')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { templates?: TemplateDaLista[] } | null) => {
        if (!cancelado) setTemplates((corpo?.templates ?? []).filter((t) => t.status === 'aprovado'));
      })
      .catch(() => {
        if (!cancelado) setTemplates([]);
      });
    return () => {
      cancelado = true;
    };
  }, []);

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

  const escolher = (t: TemplateDaLista) => {
    setAberto(false);
    onEscolher(renderizarTemplate(t.corpo, leadNome));
  };

  const lista = templates ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2" ref={raiz}>
      <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Respostas rápidas:</span>
      {lista.slice(0, RAPIDAS).map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => escolher(t)}
          title={renderizarTemplate(t.corpo, leadNome)}
          className="h-9 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container font-label-md text-label-md text-text-primary flex items-center gap-1.5 max-w-[16rem]"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-primary">
            bolt
          </span>
          <span className="truncate">{t.nome}</span>
        </button>
      ))}
      {templates !== null && lista.length === 0 && (
        <span className="font-body-sm text-body-sm text-text-muted">Nenhum template aprovado ainda.</span>
      )}
      <div className="relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
          className="h-9 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container font-label-md text-label-md text-text-primary flex items-center gap-1.5"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            chat_paste_go
          </span>
          Templates
        </button>
        {aberto && (
          <div role="dialog" aria-label="Templates" className="absolute bottom-full left-0 z-20 mb-1 w-80 max-h-72 overflow-y-auto rounded-xl bg-surface-card shadow-xl py-1">
            {lista.length === 0 ? (
              <p className="px-3 py-2 font-body-sm text-body-sm text-text-muted">Nenhum template aprovado ainda.</p>
            ) : (
              lista.map((t) => (
                <button key={t.id} type="button" onClick={() => escolher(t)} className="w-full text-left px-3 py-2 hover:bg-surface-subtle flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md text-text-primary font-semibold">{t.nome}</span>
                  <span className="font-body-sm text-body-sm text-text-secondary line-clamp-2">{renderizarTemplate(t.corpo, leadNome)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
