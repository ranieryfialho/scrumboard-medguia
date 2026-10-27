// T-165/T-167 (fase4-pipeline-telas, AC-391/AC-392): criação do lead + card
// pelo modal "Novo Lead", compartilhada pelo funil e pela lista.
import type { DadosNovoLead } from "./modal-novo-lead";

export interface ResultadoCriarCard {
  ok: boolean;
  id?: string;
  version?: number;
  erro?: string;
  campo?: "nome" | "telefone" | "origem";
}

/** T-165 (AC-391/AC-392): cria o lead e o card em "Entrada de leads" num só passo. */
export async function criarCardNovoLead(dados: DadosNovoLead): Promise<ResultadoCriarCard> {
  const resposta = await fetch("/api/oportunidades", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      novoLead: { nome: dados.nome, telefone: dados.telefone, email: dados.email, origem: dados.origem },
      valor: dados.valor,
      responsavelId: dados.responsavelId,
    }),
  });

  if (resposta.ok) {
    const corpo = await resposta.json();
    return { ok: true, id: corpo.id, version: corpo.version };
  }

  const erro = await resposta.json().catch(() => null);
  if (erro?.codigo === "CAMPO_OBRIGATORIO") {
    return { ok: false, erro: "Esse campo é obrigatório.", campo: erro.campo };
  }
  if (erro?.codigo === "RESPONSAVEL_INVALIDO") {
    return { ok: false, erro: "Esse responsável não está ativo nesta empresa." };
  }
  return { ok: false, erro: "Não foi possível salvar o lead. Tente de novo." };
}

/** AC-392: cria o card e já inicia a cadência de 18 toques (API de iniciar cadência já existente). */
export async function criarLeadEIniciarCadencia(dados: DadosNovoLead): Promise<ResultadoCriarCard> {
  const resultado = await criarCardNovoLead(dados);
  if (resultado.ok && resultado.id && typeof resultado.version === "number") {
    await fetch(`/api/oportunidades/${resultado.id}/cadencia/iniciar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: resultado.version }),
    });
  }
  return resultado;
}
