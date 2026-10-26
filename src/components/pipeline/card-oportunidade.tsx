"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { BotaoIniciarCadencia } from "./botao-iniciar-cadencia";

export interface CardBoard {
  id: string;
  etapaId: number;
  leadId: string;
  leadNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  valor: string | null;
  version: number;
  /**
   * T-160 (AC-388): hora da próxima ação, quando o board souber dela — vem
   * do mesmo cruzamento com a fila de cadência que já traz o selo
   * "Atrasado" (`/api/atividades?atrasados=1`, AC-220); card sem toque
   * pendente nessa fila mostra "Sem próxima ação", mesmo rótulo de
   * `tabela-lista.tsx`.
   */
  proximaAcaoEm?: string | null;
}

interface CardOportunidadeProps {
  oportunidade: CardBoard;
  isOverlay?: boolean;
}

function formatarValor(valor: string | null): string | null {
  if (!valor) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** AC-388: mesmo rótulo de `tabela-lista.tsx` para "sem próxima ação". */
function formatarProximaAcao(iso: string | null | undefined): string {
  if (!iso) return "Sem próxima ação";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function CardOportunidade({ oportunidade, isOverlay }: CardOportunidadeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: oportunidade.id,
    data: { etapaId: oportunidade.etapaId, version: oportunidade.version },
    disabled: isOverlay,
  });

  const [dadosCadencia, setDadosCadencia] = useState<{ etapaId: number; version: number } | null>(null);
  const [cadenciaIniciada, setCadenciaIniciada] = useState(false);
  const [erroCadencia, setErroCadencia] = useState<string | null>(null);

  // AC-216: em erro, recarrega o card (etapa/version atuais) antes de deixar
  // o operador tentar de novo — nunca reusa a version que já se provou velha.
  const recarregarCard = async () => {
    try {
      const resposta = await fetch(`/api/oportunidades/${oportunidade.id}`);
      if (!resposta.ok) return;
      const corpo = await resposta.json();
      setDadosCadencia({ etapaId: corpo.etapaId, version: corpo.version });
    } catch {
      // Sem conectividade: mantém os dados locais, a mensagem de erro já foi mostrada.
    }
  };

  const etapaId = dadosCadencia?.etapaId ?? oportunidade.etapaId;
  const version = dadosCadencia?.version ?? oportunidade.version;

  const valorFormatado = formatarValor(oportunidade.valor);
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`p-0 cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging ? "opacity-40" : "opacity-100"
      } ${isOverlay ? "shadow-lg rotate-2" : ""}`}
    >
      <CardContent className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-slate-800 leading-tight">{oportunidade.leadNome}</p>
          <Link
            href={`/pipeline/${oportunidade.id}`}
            onClick={(evento) => evento.stopPropagation()}
            onPointerDown={(evento) => evento.stopPropagation()}
            className="text-slate-400 hover:text-indigo-600 shrink-0"
            title="Abrir detalhe"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{oportunidade.responsavelNome ?? "Sem responsável"}</span>
          {valorFormatado && <span className="font-semibold text-emerald-700">{valorFormatado}</span>}
        </div>
        <p className="text-[11px] text-slate-400">{formatarProximaAcao(oportunidade.proximaAcaoEm)}</p>

        {!isOverlay && (
          <div onPointerDown={(evento) => evento.stopPropagation()}>
            <BotaoIniciarCadencia
              oportunidadeId={oportunidade.id}
              etapaId={etapaId}
              version={version}
              onIniciado={(resultado) => {
                setDadosCadencia(resultado);
                setCadenciaIniciada(true);
                setErroCadencia(null);
              }}
              onErro={(mensagem) => {
                setErroCadencia(mensagem);
                void recarregarCard();
              }}
            />
          </div>
        )}

        {cadenciaIniciada && (
          <p className="text-xs text-emerald-700">
            Cadência iniciada — os 3 primeiros toques estão em Minhas tarefas.
          </p>
        )}
        {erroCadencia && <p className="text-xs text-rose-600">{erroCadencia}</p>}
      </CardContent>
    </Card>
  );
}
