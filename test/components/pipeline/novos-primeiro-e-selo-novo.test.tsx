// @vitest-environment jsdom
//
// Entrada de leads: o card mais novo fica sempre no topo e ganha o selo "Novo"
// (verde, pulsante) pelo prazo da regra de `lead-novo.ts`. Só a Entrada de leads
// reordena e mostra o selo; as outras colunas seguem como o servidor mandou.
// Só o relógio (`Date`) é falso — os timers reais seguem, senão o `waitFor` trava.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

const AGORA = new Date("2026-11-09T13:00:00Z"); // segunda-feira, 10h em Brasília
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600 * 1000).toISOString();

function card(id: string, nome: string, criadoEm: string, etapaId = 1) {
  return { id, etapaId, leadId: `lead-${id}`, leadNome: nome, responsavelId: null, responsavelNome: null, valor: null, version: 1, criadoEm };
}

function resposta(corpo: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
}

describe("Entrada de leads: mais novo primeiro e selo Novo", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    vi.stubGlobal("EventSource", FakeEventSource);
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/oportunidades") {
        return resposta({
          // De propósito fora de ordem: o antigo vem antes do novo.
          itens: [
            card("a", "Lead Antigo", horasAtras(30)),
            card("b", "Lead Recente", horasAtras(1)),
            card("c", "Lead Do Meio", horasAtras(13)),
            card("d", "Lead Na Reunião", horasAtras(1), 8),
          ],
          grafo: {},
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ codigo: "NAO_ENCONTRADO" }) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.fetch = fetchOriginal;
  });

  test("a coluna Entrada de leads lista do card mais novo para o mais antigo", async () => {
    render(<BoardKanban />);
    await screen.findByText("Lead Recente");

    const coluna = document.querySelector('[data-etapa-id="1"]')!;
    const nomes = [...coluna.querySelectorAll(".relative")].map((el) => el.textContent ?? "");
    const posicao = (nome: string) => nomes.findIndex((texto) => texto.includes(nome));

    expect(posicao("Lead Recente")).toBeLessThan(posicao("Lead Do Meio"));
    expect(posicao("Lead Do Meio")).toBeLessThan(posicao("Lead Antigo"));
  });

  test("cada card do funil mostra a foto do WhatsApp do lead ao lado do nome", async () => {
    render(<BoardKanban />);
    await screen.findByText("Lead Recente");

    const cardRecente = screen.getByText("Lead Recente").closest(".relative")!;
    expect(cardRecente.querySelector('img[src="/api/whatsapp/foto?leadId=lead-b"]')).not.toBeNull();
  });

  test("o selo Novo aparece só em quem chegou dentro das 12h de dia útil, e só na Entrada de leads", async () => {
    render(<BoardKanban />);
    await screen.findByText("Lead Recente");

    const comSelo = (nome: string) => screen.getByText(nome).closest(".relative")!.querySelector('[data-testid="selo-novo"]');

    expect(comSelo("Lead Recente")).not.toBeNull();
    expect(comSelo("Lead Recente")!.textContent).toContain("Novo");
    expect(comSelo("Lead Do Meio")).toBeNull(); // 13h atrás: passou das 12h
    expect(comSelo("Lead Antigo")).toBeNull();
    expect(comSelo("Lead Na Reunião")).toBeNull(); // fora da Entrada de leads
  });
});
