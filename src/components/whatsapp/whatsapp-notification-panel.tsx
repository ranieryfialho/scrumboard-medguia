"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, UserPlus } from "lucide-react";
import { useWhatsappUnread } from "@/contexts/whatsapp-unread-context";
import { Lead } from "@/types/lead";

interface Props {
  leads: (Lead & { observacoes?: string; origem?: string })[];
  onSelectLead: (lead: Lead & { observacoes?: string; origem?: string }) => void;
  onOpenInbox: (numero: string) => void;
}

function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

function extrairTelefone(lead: Lead): string {
  for (const campo of [lead.whatsapp, lead.email]) {
    if (!campo) continue;
    const limpo = campo.replace(/^p:?\s*/i, "").trim();
    if (!limpo.includes("@") && /\d{8}/.test(limpo.replace(/\D/g, ""))) {
      return normalizePhone(limpo);
    }
  }
  return "";
}

function formatarTempo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatarTelefone(numero: string): string {
  const n = numero.replace(/\D/g, "");
  if (n.length === 13 && n.startsWith("55"))
    return `+55 (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  return numero;
}

export function WhatsappNotificationPanel({ leads, onSelectLead, onOpenInbox }: Props) {
  const { totalUnread, conversasNaoLidas, markRead, markAllRead } = useWhatsappUnread();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (totalUnread === 0) return null;

  const conversasComLead = conversasNaoLidas.map((c) => {
    const lead = leads.find((l) => extrairTelefone(l) === c.numero);
    return { ...c, lead };
  });

  const handleAbrirInbox = (numero: string) => {
    setOpen(false);
    onOpenInbox(numero);
  };

  return (
    <>
      <div className="relative" ref={panelRef}>
        {/* Botão */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-sm"
        >
          <MessageCircle className="w-4 h-4" />
          <span className="text-xs font-bold hidden sm:block">Mensagens</span>
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-emerald-600 text-[10px] font-extrabold leading-none">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-bold text-slate-800">Não lidas</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { markAllRead(); setOpen(false); }}
                  className="text-[11px] text-slate-400 hover:text-indigo-600 font-medium transition-colors"
                >
                  Marcar todas como lidas
                </button>
                <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
              {conversasComLead.map((c) => (
                <div key={c.numero} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex gap-3 items-start">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${c.lead ? "bg-emerald-100" : "bg-slate-100"}`}>
                      <MessageCircle className={`w-4 h-4 ${c.lead ? "text-emerald-600" : "text-slate-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {c.lead?.nome || formatarTelefone(c.numero)}
                        </p>
                        <span className="text-[10px] text-slate-400 shrink-0">{formatarTempo(c.lastAt)}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{c.lastMessage}</p>

                      {c.lead ? (
                        <button
                          onClick={() => { onSelectLead(c.lead!); setOpen(false); }}
                          className="mt-1.5 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                        >
                          <MessageCircle className="w-3 h-3" /> Abrir conversa
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAbrirInbox(c.numero)}
                          className="mt-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                        >
                          <UserPlus className="w-3 h-3" /> Ver conversa e criar lead
                        </button>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); markRead(c.numero); }}
                      className="text-slate-300 hover:text-slate-500 shrink-0 mt-1 transition-colors"
                      title="Dispensar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </>
  );
}
