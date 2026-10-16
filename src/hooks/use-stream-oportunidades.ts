// T-064 (fase2c-sse, US-038): hook de cliente do canal `/api/stream`
// (T-062). Abre um `EventSource` e repassa `oportunidade.movida` e
// `stream.reconectado` (T-061) para quem usa o hook. Se o `EventSource`
// falhar 3 vezes seguidas (ASM-031), liga um polling de 30 s (AC-118) — o
// `EventSource` nativo continua tentando reconectar sozinho em paralelo; ao
// disparar `open` de novo, o polling para e o hook volta para o modo 'sse'.
//
// T-096 (fase2b-fila-tarefas, US-060, AC-219): também repassa
// `cadencia.fila_alterada` — a página `/tarefas` (T-097) usa esse evento
// (e `stream.reconectado`, e o próprio `aoPolling` do fallback) como os três
// gatilhos para recarregar a fila; este hook não decide o que recarregar,
// só entrega o evento.
'use client';

import { useEffect, useRef, useState } from 'react';

export type ModoConexaoStream = 'sse' | 'polling';

export interface EventoOportunidadeMovidaCliente {
  tipo: 'oportunidade.movida';
  empresaId: string;
  oportunidadeId: string;
  etapaOrigemId: number;
  etapaDestinoId: number;
  atorId: string;
  ocorridoEm: string;
}

export interface EventoCadenciaFilaAlteradaCliente {
  tipo: 'cadencia.fila_alterada';
  empresaId: string;
  oportunidadeId: string;
}

export interface EventoStreamReconectadoCliente {
  tipo: 'stream.reconectado';
}

export type EventoStreamCliente =
  | EventoOportunidadeMovidaCliente
  | EventoCadenciaFilaAlteradaCliente
  | EventoStreamReconectadoCliente;

export interface UseStreamOportunidadesOpcoes {
  /** URL do canal SSE. Default: '/api/stream'. */
  url?: string;
  /** Chamado a cada `oportunidade.movida`/`stream.reconectado` recebido pelo SSE. */
  aoReceberEvento?: (evento: EventoStreamCliente) => void;
  /** Chamado a cada ciclo de polling de fallback: imediatamente ao entrar nele e depois a cada `intervaloPollingMs` (AC-118). */
  aoPolling?: () => void;
  /** Erros consecutivos do EventSource até entrar em modo polling. Default 3 (ASM-031). */
  limiteErrosConsecutivos?: number;
  /** Intervalo do polling de fallback, em ms. Default 30000 (ASM-031/D-S4). */
  intervaloPollingMs?: number;
}

export interface UseStreamOportunidadesResultado {
  /** 'sse' com o EventSource saudável, 'polling' durante o fallback (AC-118). */
  modo: ModoConexaoStream;
}

const LIMITE_ERROS_PADRAO = 3;
const INTERVALO_POLLING_PADRAO_MS = 30_000;

function parseEventoOportunidadeMovida(data: string): EventoOportunidadeMovidaCliente {
  const payload = JSON.parse(data) as Omit<EventoOportunidadeMovidaCliente, 'tipo'>;
  return { tipo: 'oportunidade.movida', ...payload };
}

function parseEventoCadenciaFilaAlterada(data: string): EventoCadenciaFilaAlteradaCliente {
  const payload = JSON.parse(data) as Omit<EventoCadenciaFilaAlteradaCliente, 'tipo'>;
  return { tipo: 'cadencia.fila_alterada', ...payload };
}

export function useStreamOportunidades(
  opcoes: UseStreamOportunidadesOpcoes = {},
): UseStreamOportunidadesResultado {
  const {
    url = '/api/stream',
    aoReceberEvento,
    aoPolling,
    limiteErrosConsecutivos = LIMITE_ERROS_PADRAO,
    intervaloPollingMs = INTERVALO_POLLING_PADRAO_MS,
  } = opcoes;

  const [modo, setModo] = useState<ModoConexaoStream>('sse');

  // Callbacks em ref: evita recriar o EventSource a cada render por causa de
  // uma nova identidade de função vinda do chamador.
  const aoReceberEventoRef = useRef(aoReceberEvento);
  const aoPollingRef = useRef(aoPolling);
  // Atualizado em efeito (não durante a renderização): `react-hooks/refs` proíbe
  // escrever em ref no corpo do componente.
  useEffect(() => {
    aoReceberEventoRef.current = aoReceberEvento;
    aoPollingRef.current = aoPolling;
  });

  useEffect(() => {
    let errosConsecutivos = 0;
    let timerPolling: ReturnType<typeof setInterval> | undefined;
    let emPolling = false;

    function iniciarPolling(): void {
      if (emPolling) return;
      emPolling = true;
      setModo('polling');
      aoPollingRef.current?.();
      timerPolling = setInterval(() => {
        aoPollingRef.current?.();
      }, intervaloPollingMs);
    }

    function pararPolling(): void {
      if (!emPolling) return;
      emPolling = false;
      if (timerPolling) {
        clearInterval(timerPolling);
        timerPolling = undefined;
      }
      setModo('sse');
    }

    const origem = new EventSource(url);

    origem.addEventListener('open', () => {
      errosConsecutivos = 0;
      pararPolling();
    });

    origem.addEventListener('error', () => {
      errosConsecutivos += 1;
      if (errosConsecutivos >= limiteErrosConsecutivos) {
        iniciarPolling();
      }
    });

    origem.addEventListener('oportunidade.movida', (evento) => {
      const mensagem = evento as MessageEvent<string>;
      aoReceberEventoRef.current?.(parseEventoOportunidadeMovida(mensagem.data));
    });

    origem.addEventListener('cadencia.fila_alterada', (evento) => {
      const mensagem = evento as MessageEvent<string>;
      aoReceberEventoRef.current?.(parseEventoCadenciaFilaAlterada(mensagem.data));
    });

    origem.addEventListener('stream.reconectado', () => {
      aoReceberEventoRef.current?.({ tipo: 'stream.reconectado' });
    });

    return () => {
      origem.close();
      if (timerPolling) clearInterval(timerPolling);
    };
  }, [url, limiteErrosConsecutivos, intervaloPollingMs]);

  return { modo };
}
