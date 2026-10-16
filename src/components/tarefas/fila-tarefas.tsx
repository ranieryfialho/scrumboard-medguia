"use client";

// T-097 (fase2b-fila-tarefas, US-056/US-058/US-060): tela "Minhas tarefas" —
// consome GET /api/atividades?atrasados=1 (T-095), que já devolve o turno
// vigente (AC-192) e os atrasados (AC-212) numa única resposta, atrasados
// primeiro. Esta tela só separa visualmente por `item.atrasado` (AC-213); não
// há filtro de responsável aqui — a rota já resolve isso pela sessão
// (ASM-061). Concluir o toque e iniciar cadência são T-098/T-099 — esta
// tarefa só lista.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlarmClock, Inbox, MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { podeLiberar } from "@/domain/cadencia/feriados";
import { turnoVigente } from "@/domain/cadencia/turno";
import {
  useStreamOportunidades,
  type EventoStreamCliente,
} from "@/hooks/use-stream-oportunidades";

type Canal = "telefone" | "whatsapp";
type Tipo = "ligacao" | "mensagem" | "breakup";

interface AtividadeFila {
  id: string;
  sequencia: number;
  canal: Canal;
  tipo: Tipo;
}

interface ItemFila {
  atividade: AtividadeFila;
  oportunidade: { id: string };
  /** AC-205: dados do lead exibidos no item. */
  lead: { id: string; nome: string; telefoneE164: string | null };
  /** AC-212/AC-213: toques liberados em turno ou dia anterior ao vigente. */
  atrasado: boolean;
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

/** AC-206: "fora do horário de atendimento" (fim de semana, feriado ou fora das janelas 8h–12h/13h–18h de `America/Sao_Paulo`) é um motivo distinto de "sem toques neste turno". Mesmo domínio puro do repositório (T-088/T-090), só que com o relógio real da tela (ASM-062 é regra de servidor/teste, não de UI). */
function estaForaDoHorarioDeAtendimento(agora: Date): boolean {
  return !podeLiberar(agora) || turnoVigente(agora) === null;
}

export function FilaTarefas() {
  const [itens, setItens] = useState<ItemFila[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conversaDe, setConversaDe] = useState<{ id: string; nome: string } | null>(null);

  const carregarFila = useCallback(async () => {
    try {
      const resposta = await fetch("/api/atividades?atrasados=1");
      if (!resposta.ok) throw new Error(`fila respondeu ${resposta.status}`);
      const corpo = await resposta.json();
      setItens((corpo.itens ?? []) as ItemFila[]);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar a fila. Tente de novo.");
    }
  }, []);

  useEffect(() => {
    carregarFila();
  }, [carregarFila]);

  // AC-219: recarrega ao vir `cadencia.fila_alterada` (concluir, iniciar,
  // virada de dia) ou `stream.reconectado`; o fallback de polling (ASM-031)
  // chama o mesmo `carregarFila`. Como a recarga sempre substitui `itens`
  // pela resposta da rota (nunca concatena), o evento disparado pela própria
  // conclusão do operador não duplica itens.
  const aoReceberEvento = useCallback(
    (evento: EventoStreamCliente) => {
      if (evento.tipo === "cadencia.fila_alterada" || evento.tipo === "stream.reconectado") {
        void carregarFila();
      }
    },
    [carregarFila]
  );

  useStreamOportunidades({ aoReceberEvento, aoPolling: carregarFila });

  if (erro) {
    return <p className="text-sm text-rose-600">{erro}</p>;
  }

  if (itens === null) {
    return <p className="text-sm text-slate-500">Carregando fila...</p>;
  }

  const atrasados = itens.filter((item) => item.atrasado);
  const vigentes = itens.filter((item) => !item.atrasado);
  const foraDoHorario = estaForaDoHorarioDeAtendimento(new Date());

  return (
    <div className="flex flex-col gap-6">
      {atrasados.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-amber-700">Atrasadas</h2>
          <div className="flex flex-col gap-2">
            {atrasados.map((item) => (
              <ItemFilaLinha key={item.atividade.id} item={item} onAbrirConversa={setConversaDe} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Turno vigente</h2>
        {vigentes.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-4 py-6">
            <Inbox className="size-4 shrink-0" />
            <span>
              {foraDoHorario
                ? "Fora do horário de atendimento (fins de semana, feriados ou fora das janelas 8h–12h e 13h–18h)."
                : "Nenhum toque pendente neste turno."}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {vigentes.map((item) => (
              <ItemFilaLinha key={item.atividade.id} item={item} onAbrirConversa={setConversaDe} />
            ))}
          </div>
        )}
      </section>

      {conversaDe && (
        <ConversaDoLead lead={conversaDe} onClose={() => setConversaDe(null)} />
      )}
    </div>
  );
}

interface ItemFilaLinhaProps {
  item: ItemFila;
  onAbrirConversa: (lead: { id: string; nome: string }) => void;
}

function ItemFilaLinha({ item, onAbrirConversa }: ItemFilaLinhaProps) {
  const { atividade, lead } = item;
  const IconeCanal = atividade.canal === "whatsapp" ? MessageCircle : Phone;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          {item.atrasado && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
              <AlarmClock className="size-3" />
              Atrasado
            </span>
          )}
          {/* AC-207: abre o detalhe do card. */}
          <Link href={`/pipeline/${item.oportunidade.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 truncate">
            {lead.nome}
          </Link>
        </div>
        <p className="text-xs text-slate-500 flex items-center gap-1">
          <IconeCanal className="size-3.5" />
          {CANAL_LABEL[atividade.canal]} · {TIPO_LABEL[atividade.tipo]} · toque {atividade.sequencia} de {TOTAL_TOQUES}
        </p>
      </div>

      {/* AC-207: só o toque de WhatsApp mostra o atalho pra conversa. */}
      {atividade.canal === "whatsapp" && (
        <Button variant="outline" size="sm" onClick={() => onAbrirConversa({ id: lead.id, nome: lead.nome })}>
          Abrir conversa
        </Button>
      )}
    </div>
  );
}

interface Mensagem {
  mensagem: string;
  direcao: "enviada" | "recebida";
  created_at: string;
}

/** AC-207: a conversa do lead, lida pela mesma rota tenant-isolada que a aba WhatsApp (fase2c-whatsapp-conversa, ASM-068). Só leitura — responder continua pela tela de WhatsApp. */
function ConversaDoLead({ lead, onClose }: { lead: { id: string; nome: string }; onClose: () => void }) {
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/whatsapp/messages?leadId=${lead.id}`)
      .then(async (resposta) => {
        if (cancelado) return;
        if (!resposta.ok) throw new Error(`conversa respondeu ${resposta.status}`);
        const corpo = await resposta.json();
        setMensagens(corpo.mensagens ?? []);
      })
      .catch(() => {
        if (!cancelado) setErro("Não foi possível carregar a conversa.");
      });
    return () => {
      cancelado = true;
    };
  }, [lead.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conversa com {lead.nome}</DialogTitle>
          <DialogDescription>Histórico de mensagens do WhatsApp com este lead.</DialogDescription>
        </DialogHeader>

        {erro && <p className="text-sm text-rose-600">{erro}</p>}
        {!erro && mensagens === null && <p className="text-sm text-slate-500">Carregando conversa...</p>}
        {!erro && mensagens !== null && mensagens.length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma mensagem ainda.</p>
        )}
        {!erro && mensagens !== null && mensagens.length > 0 && (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
            {mensagens.map((mensagem, indice) => (
              <div
                key={indice}
                className={`text-sm rounded-lg px-3 py-2 max-w-[80%] ${
                  mensagem.direcao === "enviada" ? "self-end bg-indigo-50 text-slate-800" : "self-start bg-slate-100 text-slate-800"
                }`}
              >
                {mensagem.mensagem}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
