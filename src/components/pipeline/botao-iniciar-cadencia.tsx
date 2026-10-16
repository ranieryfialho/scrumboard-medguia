"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

const ETAPA_ENTRADA_DE_LEADS = 1;

const MENSAGENS_ERRO: Record<string, string> = {
  CONFLITO_DE_VERSAO: "Esse card foi atualizado por outra pessoa. Os dados foram recarregados.",
  OPORTUNIDADE_NAO_ENCONTRADA: "Esse card não foi encontrado. Os dados foram recarregados.",
};

interface ResultadoIniciarCadencia {
  etapaId: number;
  version: number;
}

interface BotaoIniciarCadenciaProps {
  oportunidadeId: string;
  etapaId: number;
  version: number;
  /** AC-215: card passa a aparecer em "1º dia de contato" sem recarregar a página. */
  onIniciado: (resultado: ResultadoIniciarCadencia) => void;
  /** AC-216: explica o motivo em português e recarrega o card. */
  onErro: (mensagem: string) => void;
}

/** AC-214/AC-215/AC-216: só aparece em "Entrada de leads"; chama a rota de início de cadência. */
export function BotaoIniciarCadencia({ oportunidadeId, etapaId, version, onIniciado, onErro }: BotaoIniciarCadenciaProps) {
  const [carregando, setCarregando] = useState(false);

  if (etapaId !== ETAPA_ENTRADA_DE_LEADS) return null;

  const iniciar = async () => {
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/oportunidades/${oportunidadeId}/cadencia/iniciar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });

      if (resposta.ok) {
        const corpo = await resposta.json();
        onIniciado({ etapaId: corpo.oportunidade.etapaId, version: corpo.oportunidade.version });
        return;
      }

      const erro = await resposta.json().catch(() => null);
      const codigo = erro?.codigo as string | undefined;
      onErro(MENSAGENS_ERRO[codigo ?? ""] ?? "Não foi possível iniciar a cadência. Tente de novo.");
    } catch {
      onErro("Não foi possível iniciar a cadência. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={carregando}
      onClick={(evento) => {
        evento.stopPropagation();
        void iniciar();
      }}
      onPointerDown={(evento) => evento.stopPropagation()}
    >
      {carregando ? "Iniciando…" : "Iniciar cadência"}
    </Button>
  );
}
