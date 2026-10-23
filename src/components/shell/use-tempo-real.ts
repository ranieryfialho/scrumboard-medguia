'use client';

// T-146 (fase4-design-system-shell-acesso, US-098): estado real da conexão
// SSE para o indicador do topo (AC-354) — mesmo canal `/api/stream` de
// `src/hooks/use-stream-oportunidades.ts` (T-064), mas este hook só expõe o
// estado da conexão (não repassa eventos de negócio: o topo não reage a
// `oportunidade.movida`). Começa em 'reconectando' (o `EventSource` ainda
// não confirmou `open`) para "dizer a verdade" em vez de otimisticamente
// anunciar conectado antes da hora.
import { useEffect, useState } from 'react';

export type EstadoTempoReal = 'conectado' | 'reconectando';

export function useTempoReal(url = '/api/stream'): EstadoTempoReal {
  const [estado, setEstado] = useState<EstadoTempoReal>('reconectando');

  useEffect(() => {
    const origem = new EventSource(url);

    origem.addEventListener('open', () => setEstado('conectado'));
    origem.addEventListener('error', () => setEstado('reconectando'));

    return () => {
      origem.close();
    };
  }, [url]);

  return estado;
}
