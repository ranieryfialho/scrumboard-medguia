"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Loader2, MessageCircle, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useWhatsappUnread } from "@/contexts/whatsapp-unread-context";

interface Mensagem {
  id: string;
  mensagem: string;
  direcao: "enviada" | "recebida";
  created_at: string;
  numero: string;
}

interface Props {
  numero: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateLead: (whatsapp: string, nome: string) => Promise<void>;
}

const formatarHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const formatarDia = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function formatarTelefone(numero: string): string {
  const n = numero.replace(/\D/g, "");
  if (n.length === 13 && n.startsWith("55"))
    return `+55 (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  return numero;
}

export function WhatsappInboxChat({ numero, open, onOpenChange, onCreateLead }: Props) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Criar lead
  const [criandoLead, setCriandoLead] = useState(false);
  const [nomeInput, setNomeInput] = useState("");
  const [showNomeInput, setShowNomeInput] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Usa o número exatamente como está no banco (sem normalização adicional)
  const numeroDB = numero.replace(/\D/g, "");
  const { markRead } = useWhatsappUnread();
  const supabase = createClient();

  const buscarMensagens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/messages?numero=${numeroDB}`);
      const data = await res.json();
      if (res.ok) {
        setMensagens(data.mensagens || []);
      } else {
        setErro(data.error || `Erro ${res.status} ao buscar mensagens.`);
      }
    } catch (e) {
      setErro("Erro de conexão ao buscar mensagens.");
    } finally {
      setLoading(false);
    }
  }, [numeroDB]);

  useEffect(() => {
    if (!open) return;
    setMensagens([]);
    setErro(null);
    buscarMensagens();
    markRead(numeroDB);

    const channel = supabase
      .channel(`wpp-inbox-${numeroDB}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_mensagens",
        filter: `numero=eq.${numeroDB}`,
      }, (payload) => {
        const row = payload.new as Mensagem;
        setMensagens(prev => prev.some(m => m.id === row.id) ? prev : [...prev, row]);
        if (row.direcao === "recebida") markRead(numeroDB);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [open, numeroDB, buscarMensagens, markRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const handleEnviar = async () => {
    const msg = texto.trim();
    if (!msg || enviando) return;
    setEnviando(true);
    setErro(null);

    const tempId = `temp-${Date.now()}`;
    setMensagens(prev => [...prev, {
      id: tempId, mensagem: msg, direcao: "enviada",
      created_at: new Date().toISOString(), numero: numeroDB,
    }]);
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: numeroDB, mensagem: msg }),
    });

    if (!res.ok) {
      const body = await res.json();
      setErro(body.error || "Erro ao enviar.");
      setMensagens(prev => prev.filter(m => m.id !== tempId));
      setTexto(msg);
    } else {
      await buscarMensagens();
    }
    setEnviando(false);
  };

  const handleCriarLead = async () => {
    if (!nomeInput.trim()) return;
    setCriandoLead(true);
    try {
      await onCreateLead(numeroDB, nomeInput.trim());
      onOpenChange(false);
    } finally {
      setCriandoLead(false);
    }
  };

  // Renderiza mensagens com divisor de data
  const renderMensagens = () => {
    const itens: React.ReactNode[] = [];
    let ultimoDia = "";
    mensagens.forEach((m) => {
      const dia = formatarDia(m.created_at);
      if (dia !== ultimoDia) {
        ultimoDia = dia;
        itens.push(
          <div key={`div-${m.id}`} className="flex items-center gap-2 py-1">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] text-slate-400 font-medium px-2">{dia}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        );
      }
      const isEnviada = m.direcao === "enviada";
      const isTemp = m.id.startsWith("temp-");
      itens.push(
        <div key={m.id} className={`flex ${isEnviada ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
            isEnviada ? "bg-[#d9fdd3] text-slate-800 rounded-br-sm" : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
          } ${isTemp ? "opacity-70" : ""}`}>
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.mensagem}</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <span className={`text-[10px] ${isEnviada ? "text-emerald-700" : "text-slate-400"}`}>
                {formatarHora(m.created_at)}
              </span>
              {isEnviada && <span className="text-[10px] text-emerald-600">{isTemp ? "⏳" : "✓✓"}</span>}
            </div>
          </div>
        </div>
      );
    });
    return itens;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-slate-100 shrink-0">
          <DialogTitle className="flex items-center gap-2 pr-6">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{formatarTelefone(numeroDB)}</p>
              <p className="text-[10px] text-amber-600 font-medium">Número sem lead no kanban</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Banner criar lead */}
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 shrink-0">
          {showNomeInput ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={nomeInput}
                onChange={e => setNomeInput(e.target.value)}
                placeholder="Nome do lead..."
                className="h-8 text-sm"
                onKeyDown={e => e.key === "Enter" && handleCriarLead()}
              />
              <Button
                size="sm"
                onClick={handleCriarLead}
                disabled={!nomeInput.trim() || criandoLead}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 h-8"
              >
                {criandoLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Criar"}
              </Button>
              <button onClick={() => setShowNomeInput(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-xs text-indigo-700">Quer adicionar este contato ao kanban?</p>
              <button
                onClick={() => setShowNomeInput(true)}
                className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" /> Criar lead
              </button>
            </div>
          )}
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5" style={{ background: "#efeae2" }}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
            </div>
          ) : mensagens.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MessageCircle className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-400">Nenhuma mensagem ainda.</p>
            </div>
          ) : renderMensagens()}
          <div ref={messagesEndRef} />
        </div>

        {erro && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 shrink-0 flex justify-between">
            <span>{erro}</span>
            <button onClick={() => setErro(null)}>✕</button>
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-2 p-3 bg-[#f0f2f5] border-t border-slate-200 shrink-0">
          <textarea
            ref={textareaRef}
            value={texto}
            onChange={e => {
              setTexto(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
            placeholder="Digite uma mensagem..."
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-slate-700 placeholder:text-slate-400"
            style={{ minHeight: 44, maxHeight: 120 }}
          />
          <Button
            onClick={handleEnviar}
            disabled={enviando || !texto.trim()}
            size="icon"
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full w-10 h-10 shrink-0"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
