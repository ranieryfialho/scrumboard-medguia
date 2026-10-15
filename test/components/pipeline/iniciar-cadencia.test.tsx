// Testes de T-099 (fase2b-fila-tarefas, US-059?): botão "Iniciar cadência"
// no card do board e no detalhe. jsdom (vitest.config.ts:
// environmentMatchGlobs para test/components/**).
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BotaoIniciarCadencia } from "../../../src/components/pipeline/botao-iniciar-cadencia";
import { CardOportunidade, type CardBoard } from "../../../src/components/pipeline/card-oportunidade";
import DetalheOportunidadePage from "../../../src/app/pipeline/[id]/page";

const CARD_ID = "ffffffff-0000-0000-0000-0000000000c1";

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

function cardBoard(overrides: Partial<CardBoard> = {}): CardBoard {
  return {
    id: CARD_ID,
    etapaId: 1,
    leadId: "lead-1",
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
  etapaId: 1,
  leadNome: "Maria Souza",
  responsavelNome: null,
  valor: null,
  motivoPerdaNome: null,
  proximaAcaoEm: null,
  version: 3,
};

async function renderDetalhe(id: string) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <DetalheOportunidadePage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
}

describe("T-099: botão Iniciar cadência", () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
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
      fetchFalso.mockReturnValue(resposta(200, DETALHE));
      await renderDetalhe(CARD_ID);

      await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy());
    });

    test("detalhe: outra etapa não mostra o botão @spec:AC-214", async () => {
      fetchFalso.mockReturnValue(resposta(200, { ...DETALHE, etapaId: 5 }));
      await renderDetalhe(CARD_ID);

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
      fetchFalso.mockReturnValueOnce(resposta(200, DETALHE));
      await renderDetalhe(CARD_ID);
      await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar cadência" })).toBeTruthy());

      fetchFalso.mockReturnValueOnce(
        resposta(200, { oportunidade: { etapaId: 2, version: 4 }, toques: [1, 2, 3] })
      );
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
