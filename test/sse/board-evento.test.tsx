// @vitest-environment jsdom
//
// T-065 (fase2c-sse, US-037): prova do `BoardKanban` (src/components/pipeline/board-kanban.tsx)
// aplicando `oportunidade.movida` sem recarregar a página. Usa o mesmo
// `FakeEventSource` de test/sse/use-stream.test.tsx (jsdom não implementa
// `EventSource`) e mocka `fetch` pra responder `/api/oportunidades` (carga
// inicial) e `/api/oportunidades/:id` (releitura do card, ASM-032).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

import { BoardKanban } from '../../src/components/pipeline/board-kanban';

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

const CARD_A = 'ffffffff-0000-0000-0000-0000000000a1';
const CARD_B = 'ffffffff-0000-0000-0000-0000000000a2';

function cardBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CARD_A,
    etapaId: 1,
    leadId: 'lead-1',
    leadNome: 'Lead A',
    responsavelId: null,
    responsavelNome: null,
    valor: null,
    version: 1,
    ...overrides,
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

// Estrutura de ColunaEtapa (src/components/pipeline/coluna-etapa.tsx): div da
// coluna > [div do cabeçalho com o <h3>nome</h3>, div com os cards].
function coluna(nome: string): HTMLElement {
  return screen.getByText(nome).closest('div')!.parentElement!;
}

describe('T-065: BoardKanban aplica oportunidade.movida sem recarregar', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    fetchFalso = vi.fn();
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = fetchOriginal;
  });

  function mockCargaInicial(itens: ReturnType<typeof cardBase>[]) {
    fetchFalso.mockImplementation((url: string) => {
      if (url === '/api/oportunidades') {
        return resposta(200, { itens, grafo: { 1: [2], 2: [1] } });
      }
      return resposta(404, { codigo: 'NAO_ENCONTRADO' });
    });
  }

  test('@spec:AC-112 card se move de coluna sem recarregar a lista', async () => {
    mockCargaInicial([cardBase()]);
    render(<BoardKanban />);

    await screen.findByText('Lead A');
    expect(within(coluna('1º dia de contato')).queryByText('Lead A')).toBeFalsy();

    const chamadasAntes = fetchFalso.mock.calls.filter(([url]) => url === '/api/oportunidades').length;

    fetchFalso.mockImplementation((url: string) => {
      if (url === `/api/oportunidades/${CARD_A}`) {
        return resposta(200, cardBase({ etapaId: 2, version: 2 }));
      }
      return resposta(404, {});
    });

    const origem = FakeEventSource.instancias[0];
    origem.disparar('oportunidade.movida', {
      data: JSON.stringify({
        empresaId: 'empresa-1',
        oportunidadeId: CARD_A,
        etapaOrigemId: 1,
        etapaDestinoId: 2,
        atorId: 'outro-usuario',
        ocorridoEm: '2026-10-05T12:00:00.000Z',
      }),
    });

    await waitFor(() => {
      expect(within(coluna('1º dia de contato')).queryByText('Lead A')).toBeTruthy();
    });

    // AC-112: aplicou via releitura do card — não refez a carga inteira do board.
    const chamadasDepois = fetchFalso.mock.calls.filter(([url]) => url === '/api/oportunidades').length;
    expect(chamadasDepois).toBe(chamadasAntes);
  });

  test('@spec:AC-112 evento do próprio ator é ignorado por version já atualizada', async () => {
    mockCargaInicial([cardBase({ version: 3 })]);
    render(<BoardKanban />);
    await screen.findByText('Lead A');

    let chamouDetalhe = false;
    fetchFalso.mockImplementation((url: string) => {
      if (url === `/api/oportunidades/${CARD_A}`) {
        chamouDetalhe = true;
        // Mesma version que o board já tem: a transição foi feita pelo
        // próprio ator e `carregarBoard` já aplicou antes do evento chegar.
        return resposta(200, cardBase({ etapaId: 2, version: 3 }));
      }
      return resposta(404, {});
    });

    const origem = FakeEventSource.instancias[0];
    origem.disparar('oportunidade.movida', {
      data: JSON.stringify({
        empresaId: 'empresa-1',
        oportunidadeId: CARD_A,
        etapaOrigemId: 1,
        etapaDestinoId: 2,
        atorId: 'o-proprio-usuario',
        ocorridoEm: '2026-10-05T12:00:00.000Z',
      }),
    });

    await waitFor(() => expect(chamouDetalhe).toBe(true));

    expect(within(coluna('Entrada de leads')).queryByText('Lead A')).toBeTruthy();
  });

  test('@spec:AC-112 evento de card fora do filtro do board é ignorado sem erro', async () => {
    mockCargaInicial([cardBase()]);
    render(<BoardKanban />);
    await screen.findByText('Lead A');

    const chamadasAntes = fetchFalso.mock.calls.length;

    const origem = FakeEventSource.instancias[0];
    expect(() =>
      origem.disparar('oportunidade.movida', {
        data: JSON.stringify({
          empresaId: 'empresa-1',
          oportunidadeId: CARD_B,
          etapaOrigemId: 1,
          etapaDestinoId: 2,
          atorId: 'outro-usuario',
          ocorridoEm: '2026-10-05T12:00:00.000Z',
        }),
      })
    ).not.toThrow();

    // Card continua só na coluna original e nenhuma releitura foi disparada
    // pra um id que o board nem está mostrando.
    expect(screen.getByText('Lead A')).toBeTruthy();
    expect(fetchFalso.mock.calls.length).toBe(chamadasAntes);
  });
});
