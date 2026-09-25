"use client";

import { useDroppable } from "@dnd-kit/core";

import { Badge } from "@/components/ui/badge";
import { CardOportunidade, type CardBoard } from "./card-oportunidade";

interface ColunaEtapaProps {
  etapaId: number;
  nome: string;
  cards: CardBoard[];
  /** `false` enquanto um card está sendo arrastado e esta etapa não está no mapa de destinos alcançáveis (AC-094) a partir da etapa de origem. */
  podeReceberDrop: boolean;
  /** Alguma etapa está sendo arrastada agora (independente de ser esta a permitida) — usado só pro estilo "esmaecida". */
  arrastando: boolean;
}

export function ColunaEtapa({ etapaId, nome, cards, podeReceberDrop, arrastando }: ColunaEtapaProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: String(etapaId),
    disabled: !podeReceberDrop,
  });

  const restrita = arrastando && !podeReceberDrop;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[260px] max-w-[260px] rounded-xl p-3 border transition-colors ${
        isOver ? "bg-indigo-100/60 border-indigo-300" : "bg-slate-100/50 border-slate-200/60"
      } ${restrita ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-semibold text-slate-700 text-xs uppercase tracking-wide">{nome}</h3>
        <Badge variant="secondary" className="bg-slate-200 text-slate-600 hover:bg-slate-200">
          {cards.length}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[80px]">
        {cards.map((card) => (
          <CardOportunidade key={card.id} oportunidade={card} />
        ))}
        {cards.length === 0 && (
          <div className="h-16 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-xs">
            Vazio
          </div>
        )}
      </div>
    </div>
  );
}
