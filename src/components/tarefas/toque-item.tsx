"use client";

// T-098 (fase2b-fila-tarefas, US-057): os dois botões que concluem um toque
// direto da fila — "Sem resposta" (AC-208) e "Conectou" (AC-209) — chamando
// `POST /api/atividades/:id/concluir` (T-092) com a `version` do card
// (lock otimista, mesmo padrão de `src/components/pipeline/board-kanban.tsx`).
// AC-210: a rota pode recusar com 409 CONFLITO_DE_VERSAO ou 422
// TURNO_NAO_LIBERADO/CADENCIA_ENCERRADA — cada código tem uma mensagem em
// português; nos dois casos (sucesso ou recusa) `onAtualizarFila` é chamado
// para a tela recarregar a fila com o estado real (ela decide como: refetch
// de `/api/atividades?atrasados=1`, já concatenado com o evento
// `cadencia.fila_alterada` de T-096). AC-211: um `ref` síncrono impede que um
// segundo clique, antes da resposta do primeiro, dispare outra requisição —
// o estado do React só reflete no próximo render, tarde demais pra um
// clique duplo na mesma função de evento.
import { useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";

type Canal = "telefone" | "whatsapp";
type Tipo = "ligacao" | "mensagem" | "breakup";
type ResultadoToque = "sem_resposta" | "conectou";

interface AtividadeToque {
  id: string;
  sequencia: number;
  canal: Canal;
  tipo: Tipo;
}

export interface ItemToque {
  atividade: AtividadeToque;
  oportunidade: { id: string; version: number };
  lead: { id: string; nome: string };
  atrasado: boolean;
}

interface ToqueItemProps {
  item: ItemToque;
  onAbrirConversa: (lead: { id: string; nome: string }) => void;
  /** Chamado após a resposta da rota (sucesso ou erro tratado) para a tela recarregar a fila com o estado real. */
  onAtualizarFila: () => void;
}

const TOTAL_TOQUES = 18;

const TIPO_LABEL: Record<Tipo, string> = {
  ligacao: "Ligação",
  mensagem: "Mensagem",
  breakup: "Breakup",
};

const CANAL_LABEL: Record<Canal, string> = {
  telefone: "Telefone",
  whatsapp: "WhatsApp",
};

/** AC-210: mensagem em português por motivo de recusa da conclusão. */
const MENSAGENS_ERRO: Record<string, string> = {
  CONFLITO_DE_VERSAO: "Este card foi alterado por outra ação enquanto você respondia. A fila foi recarregada com o estado atual.",
  TURNO_NAO_LIBERADO: "Este toque ainda não foi liberado para o turno atual. A fila foi recarregada com o estado atual.",
  BLOCO_ANTERIOR_PENDENTE: "O bloco anterior deste card ainda não foi concluído. A fila foi recarregada com o estado atual.",
  CADENCIA_ENCERRADA: "Esta cadência já foi encerrada, ou este toque não está mais pendente. A fila foi recarregada com o estado atual.",
};

const MENSAGEM_ERRO_PADRAO = "Não foi possível concluir este toque. A fila foi recarregada com o estado atual.";

/** AC-208/AC-209/AC-210/AC-211: o item da fila com os botões de conclusão. */
export function ToqueItem({ item, onAbrirConversa, onAtualizarFila }: ToqueItemProps) {
  const { atividade, oportunidade, lead } = item;
  const IconeCanal = atividade.canal === "whatsapp" ? MessageCircle : Phone;

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  // AC-211: guarda síncrona — `enviando` só reflete no próximo render, o que
  // não basta para impedir dois cliques disparados antes desse render.
  const envioEmAndamentoRef = useRef(false);

  async function concluir(resultado: ResultadoToque) {
    if (envioEmAndamentoRef.current) return;
    envioEmAndamentoRef.current = true;
    setEnviando(true);
    setErro(null);
    setMensagem(null);

    try {
      const resposta = await fetch(`/api/atividades/${atividade.id}/concluir`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: oportunidade.version, resultado }),
      });

      if (resposta.ok) {
        // AC-209: "Conectou" encerra a cadência do card — avisa para onde ele foi.
        if (resultado === "conectou") {
          setMensagem('O card foi para "Qualificando".');
        }
        onAtualizarFila();
      } else {
        const corpo = await resposta.json().catch(() => ({}) as { codigo?: string });
        setErro((corpo.codigo && MENSAGENS_ERRO[corpo.codigo]) ?? MENSAGEM_ERRO_PADRAO);
        onAtualizarFila();
      }
    } catch {
      setErro(MENSAGEM_ERRO_PADRAO);
    } finally {
      envioEmAndamentoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            {item.atrasado && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                <AlarmClock className="size-3" />
                Atrasado
              </span>
            )}
            <Link href={`/pipeline/${oportunidade.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 truncate">
              {lead.nome}
            </Link>
          </div>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <IconeCanal className="size-3.5" />
            {CANAL_LABEL[atividade.canal]} · {TIPO_LABEL[atividade.tipo]} · toque {atividade.sequencia} de {TOTAL_TOQUES}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {atividade.canal === "whatsapp" && (
            <Button variant="outline" size="sm" onClick={() => onAbrirConversa({ id: lead.id, nome: lead.nome })}>
              Abrir conversa
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={enviando} onClick={() => concluir("sem_resposta")}>
            Sem resposta
          </Button>
          <Button size="sm" disabled={enviando} onClick={() => concluir("conectou")}>
            Conectou
          </Button>
        </div>
      </div>

      {mensagem && <p className="text-sm text-emerald-700">{mensagem}</p>}
      {erro && (
        <p role="alert" className="text-sm text-rose-600">
          {erro}
        </p>
      )}
    </div>
  );
}
