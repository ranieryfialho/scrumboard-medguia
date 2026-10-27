"use client";

import { useDroppable } from "@dnd-kit/core";

import { CardOportunidade, type CardBoard } from "./card-oportunidade";

interface ColunaEtapaProps {
  etapaId: number;
  nome: string;
  cards: CardBoard[];
  /** `false` enquanto um card está sendo arrastado e esta etapa não está no mapa de destinos alcançáveis (AC-094) a partir da etapa de origem. */
  podeReceberDrop: boolean;
  /** Alguma etapa está sendo arrastada agora (independente de ser esta a permitida) — usado só pro estilo "esmaecida". */
  arrastando: boolean;
  /** AC-220: ids de oportunidade com toque de cadência atrasado — mostram o selo "Atrasado" sobre o card. */
  oportunidadesAtrasadas: Set<string>;
}

/** AC-388: soma dos valores dos cards da coluna — `null`/inválido não entra na soma. */
function somarValores(cards: CardBoard[]): number {
  return cards.reduce((total, card) => {
    const numero = Number(card.valor);
    return Number.isFinite(numero) ? total + numero : total;
  }, 0);
}

function formatarSoma(soma: number): string {
  return soma.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ColunaEtapa({
  etapaId,
  nome,
  cards,
  podeReceberDrop,
  arrastando,
  oportunidadesAtrasadas,
}: ColunaEtapaProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: String(etapaId),
    disabled: !podeReceberDrop,
  });

  const restrita = arrastando && !podeReceberDrop;

  return (
    <div
      ref={setNodeRef}
      data-etapa-id={etapaId}
      className={`w-80 flex-shrink-0 flex flex-col rounded-2xl p-3 shadow-sm transition-colors ${
        isOver ? "bg-primary-fixed/60 ring-2 ring-primary/40" : "bg-surface-subtle/80"
      } ${restrita ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between pb-2.5 mb-2 px-1">
        <div className="flex flex-col">
          <h3 className="font-headline-sm text-headline-sm text-text-primary">{nome}</h3>
          <span className="font-label-sm text-label-sm text-text-secondary">
            {cards.length} {cards.length === 1 ? "card" : "cards"} • {formatarSoma(somarValores(cards))}
          </span>
        </div>
        <span className="font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-bold">
          {cards.length}
        </span>
      </div>

      <div className="space-y-3 min-h-[80px]">
        {cards.map((card) => (
          <div key={card.id} className="relative">
            <CardOportunidade oportunidade={card} atrasado={oportunidadesAtrasadas.has(card.id)} />
          </div>
        ))}
        {cards.length === 0 && (
          <div className="h-16 border-2 border-dashed border-border-subtle rounded-xl flex items-center justify-center text-text-muted text-xs">
            Vazio
          </div>
        )}
      </div>
    </div>
  );
}
