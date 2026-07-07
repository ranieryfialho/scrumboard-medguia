"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWhatsappUnread } from "@/contexts/whatsapp-unread-context";
import { createClient } from "@/lib/supabase/client";

interface Mensagem {
  id: string;
  mensagem: string;
  direcao: "enviada" | "recebida";
  created_at: string;
  numero: string;
  status?: string;
}

interface WhatsappChatProps {
  leadId: string;
  leadNome: string;
  numero: string;
}

const formatarHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const formatarDia = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-[11px] text-slate-400 font-medium px-2">{date}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

export function WhatsappChat({ leadId, leadNome, numero }: WhatsappChatProps) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [whatsappConfigurado, setWhatsappConfigurado] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const numerolimpo = numero.replace(/\D/g, "");
  const numeroNorm = numerolimpo.startsWith('55') && numerolimpo.length >= 12 ? numerolimpo : `55${numerolimpo}`;
  const { markRead } = useWhatsappUnread();
  const supabase = createClient();

  const buscarMensagens = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/messages?numero=${numerolimpo}`);
      if (res.ok) {
        const data = await res.json();
        setMensagens(data.mensagens || []);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [numerolimpo]);

  // Verifica se o whatsapp está configurado
  useEffect(() => {
    fetch("/api/whatsapp/status")
      .then(r => r.json())
      .then(d => setWhatsappConfigurado(d.state === "open"))
      .catch(() => setWhatsappConfigurado(false));
  }, []);

  useEffect(() => {
    markRead(numerolimpo);
    buscarMensagens(false);

    // Supabase Realtime — mensagens novas aparecem instantaneamente
    const channel = supabase
      .channel(`wpp-chat-${numeroNorm}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_mensagens',
          filter: `numero=eq.${numeroNorm}`,
        },
        (payload) => {
          const row = payload.new as Mensagem;
          setMensagens(prev => {
            // Evita duplicatas (mensagem enviada já foi adicionada via optimistic)
            if (prev.some(m => m.id === row.id)) return prev;
            // Remove o optimistic temp se existir
            const semTemp = prev.filter(m => !m.id.startsWith('temp-'));
            return [...semTemp, row];
          });
          if (row.direcao === 'recebida') markRead(numerolimpo);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [buscarMensagens, markRead, numerolimpo, numeroNorm]);

  // Auto-scroll quando chegam novas mensagens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  // Auto-resize do textarea
  const handleTextoChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTexto(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  const handleEnviar = async () => {
    const msg = texto.trim();
    if (!msg || enviando) return;

    setEnviando(true);
    setErro(null);

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const temp: Mensagem = {
      id: tempId,
      mensagem: msg,
      direcao: "enviada",
      created_at: new Date().toISOString(),
      numero: numerolimpo,
      status: "enviando",
    };
    setMensagens(prev => [...prev, temp]);
    setTexto("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: numerolimpo, mensagem: msg, leadId }),
    });

    if (!res.ok) {
      const body = await res.json();
      setErro(body.error || "Erro ao enviar mensagem.");
      setMensagens(prev => prev.filter(m => m.id !== tempId));
      setTexto(msg);
    } else {
      // Atualiza com a mensagem real do banco
      await buscarMensagens(true);
    }

    setEnviando(false);
  };

  // Agrupa mensagens com divisor de data
  const renderMensagens = () => {
    const itens: React.ReactNode[] = [];
    let ultimoDia = "";

    mensagens.forEach((m) => {
      const dia = formatarDia(m.created_at);
      if (dia !== ultimoDia) {
        ultimoDia = dia;
        itens.push(<DateDivider key={`div-${m.id}`} date={dia} />);
      }

      const isEnviada = m.direcao === "enviada";
      const isTemp = m.id.startsWith("temp-");

      itens.push(
        <div key={m.id} className={`flex ${isEnviada ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
              isEnviada
                ? "bg-[#d9fdd3] text-slate-800 rounded-br-sm"
                : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
            } ${isTemp ? "opacity-70" : ""}`}
          >
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.mensagem}</p>
            <div className={`flex items-center gap-1 justify-end mt-0.5`}>
              <span className={`text-[10px] ${isEnviada ? "text-emerald-700" : "text-slate-400"}`}>
                {formatarHora(m.created_at)}
              </span>
              {isEnviada && (
                <span className="text-[10px] text-emerald-600">
                  {isTemp ? "⏳" : "✓✓"}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    });

    return itens;
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center bg-[#efeae2]">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "420px" }}>

      {/* Sub-header com número e refresh */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-700">{leadNome}</p>
            <p className="text-[10px] text-slate-400 font-mono">{numero}</p>
          </div>
        </div>
        <button
          onClick={() => buscarMensagens(false)}
          className="text-slate-400 hover:text-slate-600 transition-colors p-1"
          title="Atualizar conversa"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Aviso se WhatsApp não está configurado */}
      {!whatsappConfigurado && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 shrink-0">
          WhatsApp não conectado. Configure na aba WhatsApp para enviar mensagens.
        </div>
      )}

      {/* Área de mensagens */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-1.5"
        style={{ background: "#efeae2" }}
      >
        {mensagens.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-full bg-white/60 flex items-center justify-center mb-3 shadow-sm">
              <MessageCircle className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500 font-medium">Nenhuma mensagem ainda</p>
            <p className="text-xs text-slate-400 mt-1">Mensagens enviadas e recebidas aparecem aqui.</p>
          </div>
        ) : (
          renderMensagens()
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Erro de envio */}
      {erro && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 shrink-0 flex items-center justify-between">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 p-3 bg-[#f0f2f5] border-t border-slate-200 shrink-0">
        <textarea
          ref={textareaRef}
          value={texto}
          onChange={handleTextoChange}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleEnviar();
            }
          }}
          placeholder="Digite uma mensagem... (Enter para enviar)"
          rows={1}
          disabled={!whatsappConfigurado}
          className="flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-slate-700 placeholder:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: 44, maxHeight: 120 }}
        />
        <Button
          onClick={handleEnviar}
          disabled={enviando || !texto.trim() || !whatsappConfigurado}
          size="icon"
          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full w-10 h-10 shrink-0 shadow-sm"
        >
          {enviando
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />
          }
        </Button>
      </div>
    </div>
  );
}
