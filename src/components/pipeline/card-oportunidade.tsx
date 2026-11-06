"use client";

import { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import { AlarmClock, ExternalLink } from "lucide-react";

import { AvatarContato } from "@/components/whatsapp/avatar-contato";
import { leadEhNovo } from "@/domain/pipeline/lead-novo";
import { BotaoIniciarCadencia } from "./botao-iniciar-cadencia";

const ETAPA_ENTRADA_DE_LEADS = 1;

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
  /** Quando o card nasceu (ISO) — ordena a Entrada de leads e liga o selo "Novo". */
  criadoEm?: string;
}

interface CardOportunidadeProps {
  oportunidade: CardBoard;
  isOverlay?: boolean;
  /** AC-220: o toque de cadência deste card está vencido — mostra o selo "Atrasado" dentro do bloco de próxima ação. */
  atrasado?: boolean;
}

/** Iniciais para o avatar do responsável (ex.: "Diego Ramos" → "DR"). */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return `${primeira}${ultima}`.toUpperCase();
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

/** Hora atual, renovada a cada minuto — o selo "Novo" some sozinho quando o prazo acaba. */
function useAgora(ativo: boolean): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    if (!ativo) return;
    const intervalo = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, [ativo]);
  return agora;
}

export function CardOportunidade({ oportunidade, isOverlay, atrasado }: CardOportunidadeProps) {
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

  const naEntrada = oportunidade.etapaId === ETAPA_ENTRADA_DE_LEADS && !isOverlay;
  const agora = useAgora(naEntrada);
  const mostrarNovo = naEntrada && leadEhNovo(oportunidade.criadoEm, agora);

  const valorFormatado = formatarValor(oportunidade.valor);
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-surface-card rounded-xl p-3.5 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing flex flex-col gap-2.5 ${
        isDragging ? "opacity-40" : "opacity-100"
      } ${isOverlay ? "shadow-lg rotate-2" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {!isOverlay && (
            <AvatarContato
              leadId={oportunidade.leadId}
              nome={oportunidade.leadNome}
              className="size-8 rounded-full bg-surface-container flex items-center justify-center font-label-sm text-[11px] text-text-secondary shrink-0"
            />
          )}
          <span className="font-headline-sm text-headline-sm text-text-primary leading-tight">{oportunidade.leadNome}</span>
          {mostrarNovo && (
            <span
              data-testid="selo-novo"
              className="font-label-sm text-[10px] uppercase font-bold text-success-text bg-success-surface px-1.5 py-0.5 rounded inline-flex items-center gap-1 shrink-0"
            >
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-success-text opacity-75 animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-success-text" />
              </span>
              Novo
            </span>
          )}
        </div>
        <Link
          href={`/pipeline/${oportunidade.id}`}
          onClick={(evento) => evento.stopPropagation()}
          onPointerDown={(evento) => evento.stopPropagation()}
          className="text-text-muted hover:text-primary shrink-0"
          title="Abrir detalhe"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      {valorFormatado && (
        <div className="flex items-center justify-end">
          <span className="font-label-lg text-label-lg font-bold text-text-primary">{valorFormatado}</span>
        </div>
      )}

      <div className="bg-surface-subtle p-2 rounded-lg flex items-center justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="font-label-sm text-[10px] uppercase font-bold text-text-secondary">Próxima ação</span>
          <span className="font-body-sm text-[11px] text-text-secondary">{formatarProximaAcao(oportunidade.proximaAcaoEm)}</span>
        </div>
        {atrasado && (
          <span className="font-label-sm text-[10px] text-danger-text bg-danger-surface px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-1 shrink-0">
            <AlarmClock className="size-3" />
            Atrasado
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <div
          aria-hidden="true"
          className="w-6 h-6 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-bold text-[10px]"
        >
          {oportunidade.responsavelNome ? iniciais(oportunidade.responsavelNome) : "–"}
        </div>
        <span className="font-label-sm text-label-sm text-text-secondary">{oportunidade.responsavelNome ?? "Sem responsável"}</span>
      </div>

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
          <p className="text-xs text-success-text">
            Cadência iniciada — os 3 primeiros toques estão em Minhas tarefas.
          </p>
        )}
        {erroCadencia && <p className="text-xs text-danger-text">{erroCadencia}</p>}
    </div>
  );
}
