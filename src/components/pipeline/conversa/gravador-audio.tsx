'use client';

// T-290 (fase4-card-abas, US-114, AC-744): o botão de microfone do campo da mensagem. Clicar começa a gravar (pede o microfone ao
// navegador), mostra o tempo e dois botões: descartar e enviar. Para sozinho aos 5 minutos. Se o navegador não grava áudio ou o
// usuário nega o microfone, avisa e não quebra a conversa. Quem envia o áudio é a tela (`onEnviar`), com o arquivo gravado.
import { useCallback, useEffect, useRef, useState } from 'react';

import { DURACAO_MAXIMA_AUDIO_S } from '@/domain/whatsapp/midia';

const FORMATOS = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

function formatoSuportado(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return FORMATOS.find((formato) => MediaRecorder.isTypeSupported(formato)) ?? null;
}

function tempo(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;
}

interface GravadorAudioProps {
  /** Desabilita o botão (WhatsApp desconectado, envio em andamento…). */
  desabilitado: boolean;
  /** Recebe o áudio gravado; devolve quando o envio terminou (certo ou errado). */
  onEnviar: (audio: File) => Promise<void>;
  /** Avisos do gravador (microfone negado, navegador sem suporte). */
  onAviso: (mensagem: string | null) => void;
}

export function GravadorAudio({ desabilitado, onEnviar, onAviso }: GravadorAudioProps) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const fluxo = useRef<MediaStream | null>(null);
  const descartar = useRef(false);

  const soltarMicrofone = useCallback(() => {
    fluxo.current?.getTracks().forEach((faixa) => faixa.stop());
    fluxo.current = null;
  }, []);

  useEffect(() => {
    if (!gravando) return;
    const relogio = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(relogio);
  }, [gravando]);

  // Saiu da tela no meio da gravação: solta o microfone e não envia nada.
  useEffect(
    () => () => {
      descartar.current = true;
      if (gravador.current && gravador.current.state !== 'inactive') gravador.current.stop();
      soltarMicrofone();
    },
    [soltarMicrofone]
  );

  const parar = useCallback((enviar: boolean) => {
    descartar.current = !enviar;
    if (gravador.current && gravador.current.state !== 'inactive') gravador.current.stop();
  }, []);

  useEffect(() => {
    if (gravando && segundos >= DURACAO_MAXIMA_AUDIO_S) parar(true);
  }, [gravando, segundos, parar]);

  async function comecar() {
    onAviso(null);
    const formato = formatoSuportado();
    if (!formato || !navigator.mediaDevices?.getUserMedia) {
      onAviso('Este navegador não grava áudio. Use o Chrome, o Edge ou o Firefox atualizados.');
      return;
    }
    try {
      fluxo.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onAviso('Não foi possível usar o microfone. Libere o acesso ao microfone no navegador e tente de novo.');
      return;
    }
    pedacos.current = [];
    descartar.current = false;
    const novo = new MediaRecorder(fluxo.current, { mimeType: formato });
    gravador.current = novo;
    novo.ondataavailable = (evento) => {
      if (evento.data.size > 0) pedacos.current.push(evento.data);
    };
    novo.onstop = () => {
      soltarMicrofone();
      setGravando(false);
      setSegundos(0);
      const descartado = descartar.current;
      const blob = new Blob(pedacos.current, { type: formato.split(';')[0] });
      pedacos.current = [];
      if (descartado || blob.size === 0) return;
      const extensao = formato.startsWith('audio/mp4') ? 'm4a' : formato.startsWith('audio/ogg') ? 'ogg' : 'webm';
      void onEnviar(new File([blob], `audio.${extensao}`, { type: blob.type }));
    };
    novo.start();
    setSegundos(0);
    setGravando(true);
  }

  if (gravando) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Gravando áudio">
        <button type="button" onClick={() => parar(false)} aria-label="Descartar gravação" className="h-12 w-12 rounded-xl bg-surface-subtle hover:bg-surface-container flex items-center justify-center text-danger-text">
          <span aria-hidden="true" className="material-symbols-outlined">
            delete
          </span>
        </button>
        <span role="timer" className="font-label-md text-label-md text-danger-text tabular-nums flex items-center gap-1.5">
          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-danger-text animate-pulse" />
          {tempo(segundos)}
        </span>
        <button type="button" onClick={() => parar(true)} aria-label="Enviar áudio" className="h-12 w-12 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-md">
          <span aria-hidden="true" className="material-symbols-outlined">
            send
          </span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void comecar()}
      disabled={desabilitado}
      aria-label="Gravar áudio"
      title="Gravar áudio"
      className="h-12 w-12 shrink-0 rounded-xl bg-surface-subtle hover:bg-surface-container flex items-center justify-center text-text-primary disabled:opacity-50"
    >
      <span aria-hidden="true" className="material-symbols-outlined">
        mic
      </span>
    </button>
  );
}
