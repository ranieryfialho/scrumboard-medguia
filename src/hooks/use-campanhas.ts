"use client";

// T-107 (fase2d-campanhas, US-068): camada de acesso às rotas novas de
// campanhas (src/app/api/campanhas/**, T-105) para as telas de Mala Direta.
// Nenhuma chamada aqui usa o cliente do Supabase — só `fetch` contra as
// rotas do próprio CRM, que resolvem sessão/empresa/papel no servidor
// (AC-249/AC-250/AC-251).
import { useCallback, useState } from "react";

export interface CampanhaResumo {
  id: string;
  nome: string;
  assunto: string;
  status: string;
  totalDestinatarios: number;
}

export interface CampanhaCompleta {
  id: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
  status: string;
  criadoPor: string;
  criadoEm: string;
}

export interface DestinatarioCampanha {
  id: string;
  nome: string;
  email: string;
  status: string;
  tentativas: number;
  enviadoEm: string | null;
}

export interface DetalheCampanha {
  campanha: CampanhaCompleta;
  destinatarios: DestinatarioCampanha[];
  contagemPorStatus: Record<string, number>;
}

export interface ContatoOrigem {
  nome: string;
  email: string;
}

/** AC-234/AC-235 (ASM-077/ASM-078): planilha já lida no navegador, ou uma etapa do pipeline. */
export type OrigemCampanha =
  | { tipo: "planilha"; contatos: ContatoOrigem[] }
  | { tipo: "etapa"; etapaId: number };

export interface DadosCampanha {
  nome: string;
  assunto: string;
  corpoHtml: string;
}

export interface ResultadoCriacao {
  id: string;
  totalDestinatarios: number;
  descartadosInvalidos: number;
  descartadosRepetidos: number;
}

export interface ResultadoIniciar {
  id: string;
  status: string;
  totalLiberados: number;
}

export interface ResultadoReenviar {
  id: string;
  status: string;
  totalReenviados: number;
}

interface RespostaErro {
  codigo?: string;
  mensagem?: string;
}

const MENSAGENS_ERRO: Record<string, string> = {
  PARAMETRO_INVALIDO: "Dados inválidos. Confira os campos e tente de novo.",
  SEM_PERMISSAO: "Você não tem permissão para fazer isso.",
  NAO_AUTENTICADO: "Sua sessão expirou. Faça login de novo.",
  CAMPANHA_NAO_ENCONTRADA: "Campanha não encontrada.",
  CAMPANHA_NAO_EDITAVEL: "Só é possível editar uma campanha enquanto ela está em rascunho.",
  CAMPANHA_JA_INICIADA: "Esta campanha já foi iniciada.",
  CAMPANHA_EM_ENVIO: "Não é possível excluir uma campanha em andamento.",
  SEM_DESTINATARIOS: "A campanha não tem destinatários para enviar.",
  SEM_FALHAS: "Não há falhas para reenviar.",
};

function mensagemDoErro(corpo: RespostaErro): string {
  if (corpo.mensagem) return corpo.mensagem;
  if (corpo.codigo && MENSAGENS_ERRO[corpo.codigo]) return MENSAGENS_ERRO[corpo.codigo];
  return "Ocorreu um erro inesperado. Tente de novo.";
}

async function tratarResposta<T>(resposta: Response): Promise<T> {
  if (resposta.ok) return (await resposta.json()) as T;
  const corpo: RespostaErro = await resposta.json().catch(() => ({}));
  throw new Error(mensagemDoErro(corpo));
}

export function useCampanhas() {
  const [campanhas, setCampanhas] = useState<CampanhaResumo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** AC-249: a lista vem de GET /api/campanhas (nunca de uma consulta direta ao banco). */
  const carregarCampanhas = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await fetch("/api/campanhas");
      const corpo = await tratarResposta<{ campanhas: CampanhaResumo[] }>(resposta);
      setCampanhas(corpo.campanhas ?? []);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar as campanhas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  /** AC-250: nova campanha é um POST /api/campanhas. */
  const criarCampanha = useCallback(async (dados: DadosCampanha, origem: OrigemCampanha) => {
    const resposta = await fetch("/api/campanhas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...dados, origem }),
    });
    return tratarResposta<ResultadoCriacao>(resposta);
  }, []);

  /** AC-250/AC-237: edição é um PATCH /api/campanhas/:id (só vale em RASCUNHO). */
  const editarCampanha = useCallback(async (id: string, dados: DadosCampanha) => {
    const resposta = await fetch(`/api/campanhas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    return tratarResposta<CampanhaCompleta>(resposta);
  }, []);

  const excluirCampanha = useCallback(async (id: string) => {
    const resposta = await fetch(`/api/campanhas/${id}`, { method: "DELETE" });
    if (resposta.status === 204) {
      setCampanhas((anteriores) => anteriores.filter((campanha) => campanha.id !== id));
      return;
    }
    await tratarResposta(resposta);
  }, []);

  const buscarDetalhe = useCallback(async (id: string) => {
    const resposta = await fetch(`/api/campanhas/${id}`);
    return tratarResposta<DetalheCampanha>(resposta);
  }, []);

  /** AC-251: Play chama POST /api/campanhas/:id/iniciar. */
  const iniciarCampanha = useCallback(async (id: string) => {
    const resposta = await fetch(`/api/campanhas/${id}/iniciar`, { method: "POST" });
    return tratarResposta<ResultadoIniciar>(resposta);
  }, []);

  /** AC-251: reenviar falhas chama POST /api/campanhas/:id/reenviar-falhas. */
  const reenviarFalhas = useCallback(async (id: string) => {
    const resposta = await fetch(`/api/campanhas/${id}/reenviar-falhas`, { method: "POST" });
    return tratarResposta<ResultadoReenviar>(resposta);
  }, []);

  return {
    campanhas,
    carregando,
    erro,
    carregarCampanhas,
    criarCampanha,
    editarCampanha,
    excluirCampanha,
    buscarDetalhe,
    iniciarCampanha,
    reenviarFalhas,
  };
}
