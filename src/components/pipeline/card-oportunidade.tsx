"use client";

import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export interface CardBoard {
  id: string;
  etapaId: number;
  leadId: string;
  leadNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  valor: string | null;
  version: number;
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

export function CardOportunidade({ oportunidade, isOverlay }: CardOportunidadeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: oportunidade.id,
    data: { etapaId: oportunidade.etapaId, version: oportunidade.version },
    disabled: isOverlay,
  });

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
      </CardContent>
    </Card>
  );
}
