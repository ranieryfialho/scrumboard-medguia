// Testes de T-107 (fase2d-campanhas, US-068): as telas de Mala Direta
// (lista, modal de criação/edição e detalhe) falam só com as rotas novas
// (src/app/api/campanhas/**, T-105) via src/hooks/use-campanhas.ts — nada
// aqui consulta o Supabase direto. jsdom (vitest.config.ts:
// environmentMatchGlobs para test/components/**). Mesmo molde de fetch
// falso de test/components/pipeline/iniciar-cadencia.test.tsx.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CampanhasTab } from "../../../src/components/campanhas/campanhas-tab";
import { CampanhaDetalhes } from "../../../src/components/campanhas/campanha-detalhes";
import { NovaCampanhaModal } from "../../../src/components/campanhas/nova-campanha-modal";

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function detalheCampanha(overrides: {
  status: string;
  contagemPorStatus?: Record<string, number>;
}) {
  return {
    campanha: {
      id: "c1",
      nome: "Campanha",
      assunto: "Assunto",
      corpoHtml: "<p>Olá</p>",
      status: overrides.status,
      criadoPor: "usuario-1",
      criadoEm: "2026-01-01T00:00:00.000Z",
    },
    destinatarios: [],
    contagemPorStatus: overrides.contagemPorStatus ?? {},
  };
}

describe("T-107: telas de Mala Direta nas rotas novas", () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  describe("AC-249: a lista de campanhas usa a rota nova", () => {
    test("busca GET /api/campanhas e mostra nome, status, destinatários e ações @spec:AC-249", async () => {
      fetchFalso.mockReturnValue(
        resposta(200, {
          campanhas: [
            { id: "c1", nome: "Campanha A", assunto: "Assunto A", status: "RASCUNHO", totalDestinatarios: 3 },
            { id: "c2", nome: "Campanha B", assunto: "Assunto B", status: "FINALIZADA", totalDestinatarios: 10 },
          ],
        })
      );

      render(<CampanhasTab leads={[]} />);

      await waitFor(() => expect(fetchFalso).toHaveBeenCalledWith("/api/campanhas"));
      expect(await screen.findByText("Campanha A")).toBeTruthy();
      expect(screen.getByText("Campanha B")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
      expect(screen.getByText("10")).toBeTruthy();
      expect(screen.getByRole("button", { name: /ver e iniciar/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /ver relatório/i })).toBeTruthy();
    });

    test("falha da rota mostra mensagem com 'Tentar de novo' e refaz a busca ao clicar @spec:AC-249", async () => {
      fetchFalso.mockReturnValueOnce(resposta(500, { codigo: "ERRO_INTERNO" }));
      render(<CampanhasTab leads={[]} />);

      const botaoTentar = await screen.findByRole("button", { name: /tentar de novo/i });
      expect(botaoTentar).toBeTruthy();

      fetchFalso.mockReturnValueOnce(resposta(200, { campanhas: [] }));
      const usuario = userEvent.setup();
      await usuario.click(botaoTentar);

      await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/nenhuma campanha encontrada/i)).toBeTruthy();
    });
  });

  describe("AC-250: nova campanha pela tela grava pela rota", () => {
    test("salvar chama POST /api/campanhas com a origem escolhida e mostra o resultado @spec:AC-250", async () => {
      fetchFalso.mockReturnValue(
        resposta(201, { id: "nova-1", totalDestinatarios: 4, descartadosInvalidos: 1, descartadosRepetidos: 2 })
      );
      const onSuccess = vi.fn();
      const usuario = userEvent.setup();

      render(<NovaCampanhaModal leads={[]} onSuccess={onSuccess} />);
      await usuario.click(screen.getByRole("button", { name: /nova campanha/i }));

      await usuario.type(screen.getByPlaceholderText(/campanha março 2026/i), "Campanha Teste");
      await usuario.type(screen.getByPlaceholderText(/o que o cliente verá/i), "Assunto Teste");
      await usuario.type(screen.getByPlaceholderText(/temos uma proposta/i), "<p>Olá</p>");

      await usuario.click(screen.getByRole("button", { name: /salvar como rascunho/i }));

      await waitFor(() =>
        expect(fetchFalso).toHaveBeenCalledWith("/api/campanhas", expect.objectContaining({ method: "POST" }))
      );
      const [, init] = fetchFalso.mock.calls[0];
      expect(JSON.parse(init.body as string)).toEqual({
        nome: "Campanha Teste",
        assunto: "Assunto Teste",
        corpoHtml: "<p>Olá</p>",
        origem: { tipo: "etapa", etapaId: 1 },
      });

      expect(await screen.findByText(/4 destinatário/i)).toBeTruthy();
      expect(screen.getByText(/1 e-mail\(s\) inválido\(s\)/i)).toBeTruthy();
      expect(screen.getByText(/2 repetido\(s\)/i)).toBeTruthy();
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    test("erro da rota mostra a mensagem e mantém os campos preenchidos @spec:AC-250", async () => {
      fetchFalso.mockReturnValue(
        resposta(400, { codigo: "PARAMETRO_INVALIDO", mensagem: "O campo nome é obrigatório." })
      );
      const usuario = userEvent.setup();

      render(<NovaCampanhaModal leads={[]} />);
      await usuario.click(screen.getByRole("button", { name: /nova campanha/i }));

      await usuario.type(screen.getByPlaceholderText(/campanha março 2026/i), "Campanha X");
      await usuario.type(screen.getByPlaceholderText(/o que o cliente verá/i), "Assunto X");
      await usuario.type(screen.getByPlaceholderText(/temos uma proposta/i), "<p>Corpo</p>");

      await usuario.click(screen.getByRole("button", { name: /salvar como rascunho/i }));

      const alerta = await screen.findByRole("alert");
      expect(alerta.textContent).toMatch("O campo nome é obrigatório.");
      expect((screen.getByPlaceholderText(/campanha março 2026/i) as HTMLInputElement).value).toBe("Campanha X");
      expect((screen.getByPlaceholderText(/o que o cliente verá/i) as HTMLInputElement).value).toBe("Assunto X");
    });

    test("editar uma campanha existente busca o detalhe e grava por PATCH @spec:AC-250", async () => {
      fetchFalso.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/campanhas/c1" && !init) {
          return resposta(200, {
            campanha: {
              id: "c1",
              nome: "Antiga",
              assunto: "Assunto antigo",
              corpoHtml: "<p>Velho</p>",
              status: "RASCUNHO",
              criadoPor: "u1",
              criadoEm: "2026-01-01T00:00:00.000Z",
            },
            destinatarios: [],
            contagemPorStatus: {},
          });
        }
        if (url === "/api/campanhas/c1" && init?.method === "PATCH") {
          return resposta(200, {
            id: "c1",
            nome: "Nova",
            assunto: "Assunto antigo",
            corpoHtml: "<p>Velho</p>",
            status: "RASCUNHO",
            criadoPor: "u1",
            criadoEm: "2026-01-01T00:00:00.000Z",
          });
        }
        return resposta(404, { codigo: "NAO_ENCONTRADO" });
      });

      const usuario = userEvent.setup();
      render(
        <NovaCampanhaModal leads={[]} campanhaExistente={{ id: "c1", nome: "Antiga", assunto: "Assunto antigo" }} />
      );

      await usuario.click(screen.getByRole("button", { name: /editar campanha/i }));

      const campoNome = await screen.findByDisplayValue("Antiga");
      await usuario.clear(campoNome);
      await usuario.type(campoNome, "Nova");

      await usuario.click(screen.getByRole("button", { name: /salvar alterações/i }));

      await waitFor(() =>
        expect(fetchFalso).toHaveBeenCalledWith("/api/campanhas/c1", expect.objectContaining({ method: "PATCH" }))
      );
      expect(await screen.findByText(/campanha atualizada com sucesso/i)).toBeTruthy();
    });
  });

  describe("AC-251: Play, reenviar e acompanhamento usam as rotas novas", () => {
    test("Play chama POST .../iniciar @spec:AC-251", async () => {
      fetchFalso.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/campanhas/c1" && !init) {
          return resposta(200, detalheCampanha({ status: "RASCUNHO" }));
        }
        if (url === "/api/campanhas/c1/iniciar" && init?.method === "POST") {
          return resposta(200, { id: "c1", status: "PROCESSANDO", totalLiberados: 2 });
        }
        return resposta(404, { codigo: "NAO_ENCONTRADO" });
      });

      vi.spyOn(window, "confirm").mockReturnValue(true);
      const onRefresh = vi.fn();
      const usuario = userEvent.setup();

      render(<CampanhaDetalhes campanhaId="c1" onBack={() => {}} onRefresh={onRefresh} />);

      await screen.findByRole("heading", { name: "Campanha" });
      await usuario.click(screen.getByRole("button", { name: /iniciar disparos/i }));

      await waitFor(() =>
        expect(fetchFalso).toHaveBeenCalledWith(
          "/api/campanhas/c1/iniciar",
          expect.objectContaining({ method: "POST" })
        )
      );
      expect(onRefresh).toHaveBeenCalled();
    });

    test("reenviar falhas chama POST .../reenviar-falhas @spec:AC-251", async () => {
      let statusAtual = "FINALIZADA";
      fetchFalso.mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/campanhas/c1" && !init) {
          return resposta(200, detalheCampanha({ status: statusAtual, contagemPorStatus: { ERRO: 2 } }));
        }
        if (url === "/api/campanhas/c1/reenviar-falhas" && init?.method === "POST") {
          statusAtual = "PROCESSANDO";
          return resposta(200, { id: "c1", status: "PROCESSANDO", totalReenviados: 2 });
        }
        return resposta(404, { codigo: "NAO_ENCONTRADO" });
      });

      const onRefresh = vi.fn();
      const usuario = userEvent.setup();
      render(<CampanhaDetalhes campanhaId="c1" onBack={() => {}} onRefresh={onRefresh} />);

      const botao = await screen.findByRole("button", { name: /reenviar falhas/i });
      await usuario.click(botao);

      await waitFor(() =>
        expect(fetchFalso).toHaveBeenCalledWith(
          "/api/campanhas/c1/reenviar-falhas",
          expect.objectContaining({ method: "POST" })
        )
      );
      expect(onRefresh).toHaveBeenCalled();
    });

    test("faz polling a cada 5s enquanto PROCESSANDO e para ao finalizar @spec:AC-251", async () => {
      vi.useFakeTimers();
      let chamadas = 0;
      fetchFalso.mockImplementation((url: string) => {
        if (url === "/api/campanhas/c1") {
          chamadas += 1;
          const status = chamadas < 3 ? "PROCESSANDO" : "FINALIZADA";
          return resposta(200, detalheCampanha({ status }));
        }
        return resposta(404, { codigo: "NAO_ENCONTRADO" });
      });

      const onRefresh = vi.fn();
      render(<CampanhaDetalhes campanhaId="c1" onBack={() => {}} onRefresh={onRefresh} />);

      await act(async () => {
        await flush();
      });
      expect(fetchFalso).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await flush();
      });
      expect(fetchFalso).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await flush();
      });
      expect(fetchFalso).toHaveBeenCalledTimes(3);
      expect(onRefresh).toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await flush();
      });
      // Já FINALIZADA: o polling parou, nenhuma chamada nova.
      expect(fetchFalso).toHaveBeenCalledTimes(3);
    });

    test("nenhum arquivo de src/components/campanhas importa o cliente do Supabase @spec:AC-251", () => {
      const arquivos = ["campanhas-tab.tsx", "campanha-detalhes.tsx", "nova-campanha-modal.tsx"].map((nome) =>
        readFileSync(path.join(__dirname, "../../../src/components/campanhas", nome), "utf-8")
      );

      for (const conteudo of arquivos) {
        expect(conteudo).not.toMatch(/from ["']@\/lib\/supabase/);
        expect(conteudo).not.toMatch(/createClient/);
      }
    });
  });
});
