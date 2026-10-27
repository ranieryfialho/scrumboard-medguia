// @vitest-environment jsdom
//
// T-159 (fase4-pipeline-telas, AC-416): o hook `useStreamOportunidades`
// expõe o estado real da conexão (não só o modo sse/polling do fallback de
// AC-118) e o aviso `AvisoTempoReal` aparece/some com ele. jsdom não
// implementa `EventSource`; mesmo fake controlável de
// `test/sse/use-stream.test.tsx` (T-064) para disparar 'open'/'error'.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';

import { useStreamOportunidades } from '../../../src/hooks/use-stream-oportunidades';
import { AvisoTempoReal } from '../../../src/components/pipeline/pecas/aviso-tempo-real';

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
  cleanup();
});

describe('T-159: @spec:AC-416 estado de conexão do useStreamOportunidades', () => {
  it('começa reconectando (ainda sem `open`) e passa a conectado no primeiro `open`', () => {
    const { result } = renderHook(() => useStreamOportunidades());

    expect(result.current.estadoConexao).toBe('reconectando');

    const origem = FakeEventSource.instancias[0];
    act(() => {
      origem.disparar('open');
    });
    expect(result.current.estadoConexao).toBe('conectado');
  });

  it('volta a reconectando no primeiro erro, sem esperar os 3 do fallback de polling (AC-118)', () => {
    const { result } = renderHook(() => useStreamOportunidades());
    const origem = FakeEventSource.instancias[0];

    act(() => {
      origem.disparar('open');
    });
    expect(result.current.estadoConexao).toBe('conectado');

    act(() => {
      origem.disparar('error');
    });
    expect(result.current.estadoConexao).toBe('reconectando');
    // Um só erro não basta para ligar o polling (ASM-031 exige 3 seguidos).
    expect(result.current.modo).toBe('sse');
  });

  it('entrega `oportunidade.movida` a um callback genérico — quem usa decide se move o card ou recarrega a página e os indicadores', () => {
    const aoReceberEvento = vi.fn();
    renderHook(() => useStreamOportunidades({ aoReceberEvento }));
    const origem = FakeEventSource.instancias[0];

    const payload = {
      empresaId: 'empresa-1',
      oportunidadeId: 'oport-1',
      etapaOrigemId: 2,
      etapaDestinoId: 3,
      atorId: 'user-1',
      ocorridoEm: '2026-10-26T12:00:00.000Z',
    };

    act(() => {
      origem.disparar('oportunidade.movida', { data: JSON.stringify(payload) });
    });

    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'oportunidade.movida', ...payload });
  });

  it('só repassa os eventos que o EventSource entrega — o isolamento por empresa é da rota /api/stream (test/sse/stream-route.test.ts), não deste hook', () => {
    const aoReceberEvento = vi.fn();
    renderHook(() => useStreamOportunidades({ aoReceberEvento }));
    const origem = FakeEventSource.instancias[0];

    const deOutraEmpresa = {
      empresaId: 'empresa-2',
      oportunidadeId: 'oport-9',
      etapaOrigemId: 1,
      etapaDestinoId: 2,
      atorId: 'user-2',
      ocorridoEm: '2026-10-26T12:00:00.000Z',
    };

    // O hook não filtra por empresa: se o transporte entregar, ele repassa.
    // A garantia de que eventos de outra empresa nunca chegam é da rota SSE.
    act(() => {
      origem.disparar('oportunidade.movida', { data: JSON.stringify(deOutraEmpresa) });
    });

    expect(aoReceberEvento).toHaveBeenCalledTimes(1);
    expect(aoReceberEvento).toHaveBeenCalledWith({ tipo: 'oportunidade.movida', ...deOutraEmpresa });
  });
});

describe('T-159: @spec:AC-416 AvisoTempoReal', () => {
  it('não mostra nada quando conectado', () => {
    render(<AvisoTempoReal estadoConexao="conectado" />);
    expect(screen.queryByText('Tempo real desconectado')).toBeNull();
  });

  it('mostra "Tempo real desconectado" quando reconectando', () => {
    render(<AvisoTempoReal estadoConexao="reconectando" />);
    expect(screen.getByText('Tempo real desconectado')).toBeTruthy();
  });
});
