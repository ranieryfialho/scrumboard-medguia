'use client';

// T-290 (fase4-card-abas, US-114, AC-745): a mídia dentro do balão da conversa — player para áudio e vídeo, miniatura que abre a
// imagem, e um link de download para o documento. O arquivo vem de `GET /api/whatsapp/midia/:id` (a rota busca na Evolution na
// primeira vez); se não abrir, a mídia mostra "Mídia indisponível" em vez de um player quebrado.
import { useState } from 'react';

import type { MidiaDaMensagemView } from './formatos';

export function MidiaDaMensagem({ mensagemId, midia }: { mensagemId: string; midia: MidiaDaMensagemView }) {
  const [falhou, setFalhou] = useState(false);
  const url = `/api/whatsapp/midia/${mensagemId}`;

  if (falhou) {
    return (
      <p className="font-body-sm text-body-sm flex items-center gap-1.5 opacity-80">
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          error
        </span>
        Mídia indisponível
      </p>
    );
  }

  if (midia.tipo === 'audio') {
    return <audio controls preload="none" src={url} onError={() => setFalhou(true)} aria-label="Áudio da mensagem" className="w-64 max-w-full" />;
  }
  if (midia.tipo === 'imagem' || midia.tipo === 'figurinha') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir imagem">
        {/* eslint-disable-next-line @next/next/no-img-element -- o arquivo vem de uma rota autenticada, sem otimização do Next */}
        <img src={url} alt="Imagem da mensagem" loading="lazy" onError={() => setFalhou(true)} className={midia.tipo === 'figurinha' ? 'w-32 h-32 object-contain' : 'max-h-64 max-w-full rounded-lg object-cover'} />
      </a>
    );
  }
  if (midia.tipo === 'video') {
    return <video controls preload="metadata" src={url} onError={() => setFalhou(true)} aria-label="Vídeo da mensagem" className="max-h-64 max-w-full rounded-lg" />;
  }
  return (
    <a href={url} download={midia.nome ?? undefined} className="flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 hover:bg-black/20 transition-colors">
      <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
        description
      </span>
      <span className="font-label-md text-label-md font-semibold break-all">{midia.nome ?? 'Documento'}</span>
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] ml-auto">
        download
      </span>
    </a>
  );
}
