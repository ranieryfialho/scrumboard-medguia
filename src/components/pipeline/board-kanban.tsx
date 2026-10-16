"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CodigoErroTransicao } from "@/domain/pipeline/tipos";
import { exigeDadoFaltante } from "@/domain/pipeline/classificar-erro-transicao";
import {
  useStreamOportunidades,
  type EventoOportunidadeMovidaCliente,
  type EventoStreamCliente,
} from "@/hooks/use-stream-oportunidades";
import { CardOportunidade, type CardBoard } from "./card-oportunidade";
import { ColunaEtapa } from "./coluna-etapa";
import { ModalDadoFaltante } from "./modal-dado-faltante";

// Espelha `pipeline_etapas` (drizzle/0005_seeds.sql) — as 15 etapas são seed
// fixo, versionado por migration; não vale buscar isso por rede toda vez.
const ETAPAS: { id: number; nome: string }[] = [
  { id: 1, nome: "Entrada de leads" },
  { id: 2, nome: "1º dia de contato" },
  { id: 3, nome: "2º dia de contato" },
  { id: 4, nome: "3º dia de contato" },
  { id: 5, nome: "Qualificando" },
  { id: 6, nome: "Qualificado p/ reunião" },
  { id: 7, nome: "Follow de longo prazo" },
  { id: 8, nome: "Reunião agendada" },
  { id: 9, nome: "No-show" },
  { id: 10, nome: "Reunião realizada" },
  { id: 11, nome: "Proposta" },
  { id: 12, nome: "Teste (Trial)" },
  { id: 13, nome: "Negociação" },
  { id: 14, nome: "Perdido" },
  { id: 15, nome: "Contrato (Ganho)" },
];

const MENSAGENS_ERRO: Partial<Record<CodigoErroTransicao, string>> = {
  TRANSICAO_NAO_PERMITIDA: "Essa etapa não pode ser alcançada a partir da etapa atual.",
  PAPEL_NAO_PERMITIDO: "Seu papel não tem permissão para fazer essa transição.",
};

interface DadoFaltantePendente {
  oportunidadeId: string;
  etapaDestinoId: number;
  version: number;
  codigo: CodigoErroTransicao;
}

export function BoardKanban() {
  const [itens, setItens] = useState<CardBoard[]>([]);
  const [grafo, setGrafo] = useState<Record<number, number[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [cardAtivo, setCardAtivo] = useState<CardBoard | null>(null);
  const [dadoFaltante, setDadoFaltante] = useState<DadoFaltantePendente | null>(null);
  const [oportunidadesAtrasadas, setOportunidadesAtrasadas] = useState<Set<string>>(new Set());

  const carregarBoard = useCallback(async () => {
    setErroCarga(null);
    try {
      const resposta = await fetch("/api/oportunidades");
      if (!resposta.ok) throw new Error(`board respondeu ${resposta.status}`);
      const corpo = await resposta.json();
      setItens(corpo.itens ?? []);
      setGrafo(corpo.grafo ?? {});
    } catch {
      setErroCarga("Não foi possível carregar o board. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarBoard();
  }, [carregarBoard]);

  // AC-220: cruza o board com `?atrasados=1` (T-095) pra saber quais cards
  // mostram o selo "Atrasado" — mesma rota que a fila (T-097), só que aqui
  // só importa o conjunto de `oportunidadeId` com `atrasado: true`.
  const carregarAtrasados = useCallback(async () => {
    try {
      const resposta = await fetch("/api/atividades?atrasados=1");
      if (!resposta.ok) return;
      const corpo = await resposta.json();
      const itensFila = (corpo.itens ?? []) as { oportunidade: { id: string }; atrasado: boolean }[];
      setOportunidadesAtrasadas(
        new Set(itensFila.filter((item) => item.atrasado).map((item) => item.oportunidade.id))
      );
    } catch {
      // Sem conectividade: mantém o selo como estava até a próxima tentativa.
    }
  }, []);

  useEffect(() => {
    carregarAtrasados();
  }, [carregarAtrasados]);

  // T-065 (fase2c-sse, US-037): ref com o estado atual pra checar, no
  // momento em que o evento chega, se o card aparece no board — sem recriar
  // o EventSource a cada atualização de `itens` (useStreamOportunidades só
  // reabre a conexão se a identidade do callback mudar).
  const itensRef = useRef(itens);
  itensRef.current = itens;

  const aplicarEventoMovido = useCallback(async (evento: EventoOportunidadeMovidaCliente) => {
    // AC-112: card que o board não mostra (fora do filtro) é ignorado sem erro.
    if (!itensRef.current.some((item) => item.id === evento.oportunidadeId)) return;

    const resposta = await fetch(`/api/oportunidades/${evento.oportunidadeId}`);
    if (!resposta.ok) return;
    const card = await resposta.json();

    setItens((atual) =>
      atual.map((item) => {
        if (item.id !== card.id) return item;
        // Q-010: o próprio ator já recebeu essa versão via `carregarBoard`
        // depois da transição — não há o que reposicionar.
        if (card.version <= item.version) return item;
        return {
          ...item,
          etapaId: card.etapaId,
          responsavelId: card.responsavelId,
          responsavelNome: card.responsavelNome,
          valor: card.valor,
          version: card.version,
        };
      })
    );
  }, []);

  const aoReceberEventoStream = useCallback(
    (evento: EventoStreamCliente) => {
      if (evento.tipo === "stream.reconectado") {
        void carregarBoard();
        void carregarAtrasados();
        return;
      }
      // AC-220: o selo some sem recarregar a página — qualquer alteração na
      // fila (concluir o toque, por exemplo) refaz só o conjunto de atrasados.
      if (evento.tipo === "cadencia.fila_alterada") {
        void carregarAtrasados();
        return;
      }
      if (evento.tipo !== "oportunidade.movida") return;
      void aplicarEventoMovido(evento);
    },
    [carregarBoard, carregarAtrasados, aplicarEventoMovido]
  );

  const aoPolling = useCallback(() => {
    void carregarBoard();
    void carregarAtrasados();
  }, [carregarBoard, carregarAtrasados]);

  useStreamOportunidades({ aoReceberEvento: aoReceberEventoStream, aoPolling });

  useEffect(() => {
    if (!mensagem) return;
    const timeout = setTimeout(() => setMensagem(null), 5000);
    return () => clearTimeout(timeout);
  }, [mensagem]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const card = itens.find((item) => item.id === event.active.id);
    setCardAtivo(card ?? null);
  };

  const handleDragCancel = () => setCardAtivo(null);

  const enviarTransicao = useCallback(
    async (oportunidadeId: string, corpo: Record<string, unknown>) => {
      const resposta = await fetch(`/api/oportunidades/${oportunidadeId}/transicao`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });

      if (resposta.ok) {
        await carregarBoard();
        setMensagem(null);
        setDadoFaltante(null);
        return;
      }

      const erro = await resposta.json().catch(() => null);
      const codigo = erro?.codigo as CodigoErroTransicao | undefined;
      if (!codigo) {
        setMensagem("Não foi possível mover o card. Tente de novo.");
        return;
      }

      // AC-088: dado faltante abre o modal correspondente. AC-091: grafo/papel
      // só mostram mensagem — o card nunca chega a mudar de coluna, porque
      // `itens` só é atualizado depois de uma resposta OK (nenhum "reverter"
      // é necessário).
      if (exigeDadoFaltante(codigo)) {
        const version = typeof corpo.version === "number" ? corpo.version : 0;
        const etapaDestinoId = typeof corpo.etapaDestinoId === "number" ? corpo.etapaDestinoId : 0;
        setDadoFaltante({ oportunidadeId, etapaDestinoId, version, codigo });
      } else {
        setMensagem(MENSAGENS_ERRO[codigo] ?? "Não foi possível mover o card.");
      }
    },
    [carregarBoard]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setCardAtivo(null);
    const { active, over } = event;
    if (!over) return;

    const card = itens.find((item) => item.id === active.id);
    if (!card) return;

    const etapaDestinoId = Number(over.id);
    if (etapaDestinoId === card.etapaId) return;

    const alcancaveis = grafo[card.etapaId] ?? [];
    if (!alcancaveis.includes(etapaDestinoId)) return; // AC-094: coluna nem deveria estar droppable.

    enviarTransicao(card.id, { version: card.version, etapaDestinoId });
  };

  const alcancaveisDoAtivo = cardAtivo ? new Set(grafo[cardAtivo.etapaId] ?? []) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Pipeline</h1>
        <Button variant="outline" size="sm" onClick={carregarBoard} disabled={carregando}>
          <RefreshCcw className={`size-4 mr-1.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {erroCarga && <p className="text-sm text-rose-600">{erroCarga}</p>}
      {mensagem && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {mensagem}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className="flex-1 flex w-full overflow-x-auto gap-3 pb-2">
          {ETAPAS.map((etapa) => (
            <ColunaEtapa
              key={etapa.id}
              etapaId={etapa.id}
              nome={etapa.nome}
              cards={itens.filter((item) => item.etapaId === etapa.id)}
              podeReceberDrop={cardAtivo ? (alcancaveisDoAtivo?.has(etapa.id) ?? false) : true}
              arrastando={cardAtivo !== null}
              oportunidadesAtrasadas={oportunidadesAtrasadas}
            />
          ))}
        </div>

        <DragOverlay>{cardAtivo ? <CardOportunidade oportunidade={cardAtivo} isOverlay /> : null}</DragOverlay>
      </DndContext>

      {dadoFaltante && (
        <ModalDadoFaltante
          codigo={dadoFaltante.codigo}
          oportunidadeId={dadoFaltante.oportunidadeId}
          aberto
          onCancelar={() => setDadoFaltante(null)}
          onConfirmar={(dado) =>
            enviarTransicao(dadoFaltante.oportunidadeId, {
              version: dadoFaltante.version,
              etapaDestinoId: dadoFaltante.etapaDestinoId,
              ...dado,
            })
          }
        />
      )}
    </div>
  );
}
