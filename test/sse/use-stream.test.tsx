// @vitest-environment jsdom
//
// T-064 (fase2c-sse, US-038): prova do hook `useStreamOportunidades`
// (src/hooks/use-stream-oportunidades.ts). jsdom não implementa
// `EventSource`, então o teste stuba o global com um fake controlável
// (`FakeEventSource`) que permite disparar 'error'/'open' manualmente — o
// ponto do AC-118 é o comportamento do hook diante dessas falhas, não o
// transporte HTTP real (isso já é coberto pelos testes de rota/fim-a-fim).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useStreamOportunidades } from '../../src/hooks/use-stream-oportunidades';

type Ouvinte = (evento: unknown) => void;

class FakeEventSource {
  static instancias: FakeEventSource[] = [];

  url: string;
  fechado = false;
  private ouvintes = new Map<string, Set<Ouvinte>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instancias.push(this);
  }

  addEventListener(tipo: string, ouvinte: Ouvinte): void {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo)!.add(ouvinte);
  }

  removeEventListener(tipo: string, ouvinte: Ouvinte): void {
    this.ouvintes.get(tipo)?.delete(ouvinte);
  }

  close(): void {
    this.fechado = true;
  }

  disparar(tipo: string, evento: unknown = {}): void {
    for (const ouvinte of this.ouvintes.get(tipo) ?? []) ouvinte(evento);
  }
}

beforeEach(() => {
  FakeEventSource.instancias = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useStreamOportunidades', () => {
  it('@spec:AC-118 sem SSE o board continua se atualizando por polling e volta ao SSE quando reconecta', () => {
    const aoPolling = vi.fn();
    const { result } = renderHook(() => useStreamOportunidades({ aoPolling }));

    expect(result.current.modo).toBe('sse');
    const origem = FakeEventSource.instancias[0];
    expect(origem).toBeDefined();

    // 2 erros seguidos ainda não bastam (limite é 3 — ASM-031).
    act(() => {
      origem.disparar('error');
      origem.disparar('error');
    });
    expect(result.current.modo).toBe('sse');
    expect(aoPolling).not.toHaveBeenCalled();

    // 3º erro consecutivo liga o polling, já disparando uma releitura imediata.
    act(() => {
      origem.disparar('error');
    });
    expect(result.current.modo).toBe('polling');
    expect(aoPolling).toHaveBeenCalledTimes(1);

    // Releitura a cada 30s enquanto o SSE não volta.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(aoPolling).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(aoPolling).toHaveBeenCalledTimes(3);

    // O EventSource nativo reconecta sozinho por trás; quando o 'open' chega,
    // o hook volta para o modo SSE e para o polling.
    act(() => {
      origem.disparar('open');
    });
    expect(result.current.modo).toBe('sse');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(aoPolling).toHaveBeenCalledTimes(3);
  });

  it('@spec:AC-118 repassa oportunidade.movida e stream.reconectado para quem usa o hook', () => {
    const aoReceberEvento = vi.fn();
    renderHook(() => useStreamOportunidades({ aoReceberEvento }));
    const origem = FakeEventSource.instancias[0];

    const payload = {
      empresaId: 'empresa-1',
      oportunidadeId: 'oport-1',
      etapaOrigemId: 2,
      etapaDestinoId: 3,
      atorId: 'user-1',
      ocorridoEm: '2026-10-05T12:00:00.000Z',
    };

    act(() => {
      origem.disparar('oportunidade.movida', { data: JSON.stringify(payload) });
    });
    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'oportunidade.movida', ...payload });

    act(() => {
      origem.disparar('stream.reconectado', {});
    });
    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'stream.reconectado' });
  });
});
