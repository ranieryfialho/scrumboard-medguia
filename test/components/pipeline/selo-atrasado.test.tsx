// @vitest-environment jsdom
//
// T-100 (fase2b-fila-tarefas, AC-220): o board cruza `/api/oportunidades`
// com `/api/atividades?atrasados=1` (T-095) pra mostrar o selo "Atrasado"
// no card correspondente, e se atualiza com `cadencia.fila_alterada`
// (T-096) sem recarregar a página — mesmo `FakeEventSource` de
// test/sse/board-evento.test.tsx (jsdom não implementa `EventSource`).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { BoardKanban } from "../../../src/components/pipeline/board-kanban";

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

const CARD_ATRASADO = "ffffffff-0000-0000-0000-0000000000b1";
const CARD_EM_DIA = "ffffffff-0000-0000-0000-0000000000b2";

function cardBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CARD_ATRASADO,
    etapaId: 1,
    leadId: "lead-1",
    leadNome: "Lead Atrasado",
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

function itemFila(oportunidadeId: string, atrasado: boolean) {
  return { oportunidade: { id: oportunidadeId }, atrasado };
}

describe("T-100: selo Atrasado no card do board", () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let atividadesResposta: { itens: ReturnType<typeof itemFila>[] };

  beforeEach(() => {
    FakeEventSource.instancias = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    atividadesResposta = { itens: [itemFila(CARD_ATRASADO, true)] };

    fetchFalso = vi.fn((url: string) => {
      if (url === "/api/oportunidades") {
        return resposta(200, {
          itens: [cardBase({ id: CARD_ATRASADO }), cardBase({ id: CARD_EM_DIA, leadNome: "Lead Em Dia" })],
          grafo: {},
        });
      }
      if (url === "/api/atividades?atrasados=1") {
        return resposta(200, atividadesResposta);
      }
      return resposta(404, { codigo: "NAO_ENCONTRADO" });
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = fetchOriginal;
  });

  test("@spec:AC-220 só o card com toque atrasado mostra o selo", async () => {
    render(<BoardKanban />);

    await screen.findByText("Lead Atrasado");
    await waitFor(() => expect(screen.getAllByText("Atrasado")).toHaveLength(1));

    const cardAtrasado = screen.getByText("Lead Atrasado").closest(".relative")!;
    const cardEmDia = screen.getByText("Lead Em Dia").closest(".relative")!;
    expect(cardAtrasado.textContent).toContain("Atrasado");
    expect(cardEmDia.textContent).not.toContain("Atrasado");
  });

  test("@spec:AC-220 o selo some quando o toque é concluído, sem recarregar a página", async () => {
    render(<BoardKanban />);

    await screen.findByText("Lead Atrasado");
    await waitFor(() => expect(screen.queryByText("Atrasado")).toBeTruthy());

    const chamadasAntes = fetchFalso.mock.calls.filter(([url]) => url === "/api/oportunidades").length;

    // AC-211/AC-220: concluir o toque dispara `cadencia.fila_alterada`; a
    // próxima leitura de `?atrasados=1` já não traz mais esse card.
    atividadesResposta = { itens: [itemFila(CARD_ATRASADO, false)] };

    const origem = FakeEventSource.instancias[0];
    origem.disparar("cadencia.fila_alterada", {
      data: JSON.stringify({ tipo: "cadencia.fila_alterada", empresaId: "empresa-1", oportunidadeId: CARD_ATRASADO }),
    });

    await waitFor(() => expect(screen.queryByText("Atrasado")).toBeNull());

    // Não recarregou o board inteiro — só o conjunto de atrasados.
    const chamadasDepois = fetchFalso.mock.calls.filter(([url]) => url === "/api/oportunidades").length;
    expect(chamadasDepois).toBe(chamadasAntes);
  });
});
