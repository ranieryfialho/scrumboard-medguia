// Testes de T-099 (fase2b-fila-tarefas, US-059?): botão "Iniciar cadência"
// no card do board e no detalhe. jsdom (vitest.config.ts:
// environmentMatchGlobs para test/components/**).
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotaoIniciarCadencia } from "../../../src/components/pipeline/botao-iniciar-cadencia";
import { CardOportunidade, type CardBoard } from "../../../src/components/pipeline/card-oportunidade";
// T-164 (fase4-pipeline-telas, AC-415): a tela antiga `src/app/pipeline/[id]/page.tsx`
// saiu de cena (rota duplicada); estes testes passam a provar o botão
// "Iniciar cadência" contra a tela nova, que o embarca por compatibilidade
// (ver comentário em `src/app/(app)/pipeline/[id]/page.tsx`).
import PipelineDetalhePage from "../../../src/app/(app)/pipeline/[id]/page";

const CARD_ID = "ffffffff-0000-0000-0000-0000000000c1";
const LEAD_ID = "lead-1";

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

function cardBoard(overrides: Partial<CardBoard> = {}): CardBoard {
  return {
    id: CARD_ID,
    etapaId: 1,
    leadId: LEAD_ID,
    leadNome: "Maria Souza",
    responsavelId: null,
    responsavelNome: null,
    valor: null,
    version: 3,
    ...overrides,
  };
}

const DETALHE = {
  id: CARD_ID,
  leadId: LEAD_ID,
  etapaId: 1,
  leadNome: "Maria Souza",
  origem: null,
  email: null,
  criadoEm: new Date().toISOString(),
  responsavelId: null,
  responsavelNome: null,
  valor: null,
  proximaAcaoEm: null,
  version: 3,
};

/** Roteador mínimo da tela nova: card, grafo, telefones e linha do tempo, além da cadência sob teste. */
function roteador(detalheAtual: typeof DETALHE, respostaCadencia?: () => Promise<unknown>) {
  return (url: string, init?: RequestInit) => {
    const analisada = new URL(url, "http://localhost");
    const caminho = analisada.pathname;
    const metodo = init?.method ?? "GET";

    if (caminho === `/api/oportunidades/${CARD_ID}` && metodo === "GET") {
      return resposta(200, detalheAtual);
    }
    if (caminho === "/api/oportunidades" && metodo === "GET") {
      return resposta(200, { itens: [], grafo: {} });
    }
    if (caminho === `/api/leads/${detalheAtual.leadId}/telefones`) {
      return resposta(200, { telefones: [] });
    }
    if (caminho === `/api/oportunidades/${CARD_ID}/linha-do-tempo` && metodo === "GET") {
      return resposta(200, { itens: [], totalInteracoes: 0 });
    }
    if (caminho === `/api/oportunidades/${CARD_ID}/cadencia/iniciar` && metodo === "POST" && respostaCadencia) {
      return respostaCadencia();
    }
    return resposta(404, { codigo: "NAO_MAPEADO_NO_TESTE" });
  };
}

async function renderDetalhe(id: string, detalheAtual: typeof DETALHE = DETALHE, respostaCadencia?: () => Promise<unknown>) {
  fetchFalsoGlobal.mockImplementation(roteador(detalheAtual, respostaCadencia));
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PipelineDetalhePage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
}

let fetchFalsoGlobal: ReturnType<typeof vi.fn>;

describe("T-099: botão Iniciar cadência", () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
    fetchFalsoGlobal = fetchFalso;
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  describe("AC-214: só aparece em card de Entrada de leads", () => {
    test("card do board: etapaId 1 mostra o botão @spec:AC-214", () => {
      render(<CardOportunidade oportunidade={cardBoard({ etapaId: 1 })} />);
      expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy();
    });

    test("card do board: outra etapa não mostra o botão @spec:AC-214", () => {
      render(<CardOportunidade oportunidade={cardBoard({ etapaId: 2 })} />);
      expect(screen.queryByRole("button", { name: "Iniciar cadência" })).toBeNull();
    });

    test("detalhe: etapaId 1 mostra o botão @spec:AC-214", async () => {
      await renderDetalhe(CARD_ID, DETALHE);

      await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy());
    });

    test("detalhe: outra etapa não mostra o botão @spec:AC-214", async () => {
      await renderDetalhe(CARD_ID, { ...DETALHE, etapaId: 5 });

      await waitFor(() => expect(screen.queryByText("Maria Souza")).toBeTruthy());
      expect(screen.queryByRole("button", { name: "Iniciar cadência" })).toBeNull();
    });
  });

  describe("AC-215: iniciar chama a rota e mostra o primeiro bloco", () => {
    test("BotaoIniciarCadencia: chama a rota com a version atual e confirma o bloco @spec:AC-215", async () => {
      fetchFalso.mockReturnValue(
        resposta(200, { oportunidade: { etapaId: 2, version: 4 }, toques: [1, 2, 3] })
      );
      const onIniciado = vi.fn();
      const onErro = vi.fn();
      const usuario = userEvent.setup();

      render(
        <BotaoIniciarCadencia
          oportunidadeId={CARD_ID}
          etapaId={1}
          version={3}
          onIniciado={onIniciado}
          onErro={onErro}
        />
      );

      await usuario.click(screen.getByRole("button", { name: "Iniciar cadência" }));

      await waitFor(() => expect(onIniciado).toHaveBeenCalledWith({ etapaId: 2, version: 4 }));
      expect(onErro).not.toHaveBeenCalled();
      expect(fetchFalso).toHaveBeenCalledWith(
        `/api/oportunidades/${CARD_ID}/cadencia/iniciar`,
        expect.objectContaining({ method: "POST", body: JSON.stringify({ version: 3 }) })
      );
    });

    test("card do board: sucesso mostra a confirmação de Minhas tarefas @spec:AC-215", async () => {
      fetchFalso.mockReturnValue(
        resposta(200, { oportunidade: { etapaId: 2, version: 4 }, toques: [1, 2, 3] })
      );
      const usuario = userEvent.setup();

      render(<CardOportunidade oportunidade={cardBoard()} />);
      await usuario.click(screen.getByRole("button", { name: "Iniciar cadência" }));

      await waitFor(() =>
        expect(screen.getByText(/os 3 primeiros toques estão em Minhas tarefas/i)).toBeTruthy()
      );
    });

    test("detalhe: sucesso mostra a confirmação de Minhas tarefas @spec:AC-215", async () => {
      await renderDetalhe(CARD_ID, DETALHE, async () =>
        resposta(200, { oportunidade: { etapaId: 2, version: 4 }, toques: [1, 2, 3] })
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy());

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole("button", { name: "Iniciar cadência" }));

      await waitFor(() =>
        expect(screen.getByText(/os 3 primeiros toques estão em Minhas tarefas/i)).toBeTruthy()
      );
    });
  });

  describe("AC-216: erros ao iniciar são explicados", () => {
    test("409 CONFLITO_DE_VERSAO: explica o motivo e não trava em carregando @spec:AC-216", async () => {
      fetchFalso.mockReturnValue(resposta(409, { codigo: "CONFLITO_DE_VERSAO" }));
      const onIniciado = vi.fn();
      const onErro = vi.fn();
      const usuario = userEvent.setup();

      render(
        <BotaoIniciarCadencia
          oportunidadeId={CARD_ID}
          etapaId={1}
          version={3}
          onIniciado={onIniciado}
          onErro={onErro}
        />
      );

      const botao = screen.getByRole("button", { name: "Iniciar cadência" }) as HTMLButtonElement;
      await usuario.click(botao);

      await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringMatching(/atualizado por outra pessoa/i)));
      expect(onIniciado).not.toHaveBeenCalled();
      expect(botao.disabled).toBe(false);
      expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy();
    });

    test("404 OPORTUNIDADE_NAO_ENCONTRADA: explica o motivo @spec:AC-216", async () => {
      fetchFalso.mockReturnValue(resposta(404, { codigo: "OPORTUNIDADE_NAO_ENCONTRADA" }));
      const onIniciado = vi.fn();
      const onErro = vi.fn();
      const usuario = userEvent.setup();

      render(
        <BotaoIniciarCadencia
          oportunidadeId={CARD_ID}
          etapaId={1}
          version={3}
          onIniciado={onIniciado}
          onErro={onErro}
        />
      );

      await usuario.click(screen.getByRole("button", { name: "Iniciar cadência" }));

      await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringMatching(/não foi encontrado/i)));
      expect(onIniciado).not.toHaveBeenCalled();
    });

    test("card do board: erro recarrega o card e mostra a mensagem @spec:AC-216", async () => {
      fetchFalso
        .mockReturnValueOnce(resposta(409, { codigo: "CONFLITO_DE_VERSAO" }))
        .mockReturnValueOnce(resposta(200, { id: CARD_ID, etapaId: 1, version: 5 }));
      const usuario = userEvent.setup();

      render(<CardOportunidade oportunidade={cardBoard({ version: 3 })} />);
      await usuario.click(screen.getByRole("button", { name: "Iniciar cadência" }));

      await waitFor(() =>
        expect(screen.getByText(/atualizado por outra pessoa/i)).toBeTruthy()
      );
      await waitFor(() => expect(fetchFalso).toHaveBeenCalledWith(`/api/oportunidades/${CARD_ID}`));
      const botao = screen.getByRole("button", { name: "Iniciar cadência" }) as HTMLButtonElement;
      expect(botao.disabled).toBe(false);
    });
  });
});
