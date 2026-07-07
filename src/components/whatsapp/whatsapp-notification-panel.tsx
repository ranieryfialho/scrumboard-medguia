"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X } from "lucide-react";
import { useWhatsappUnread } from "@/contexts/whatsapp-unread-context";
import { Lead } from "@/types/lead";

interface Props {
  leads: (Lead & { observacoes?: string; origem?: string })[];
  onSelectLead: (lead: Lead & { observacoes?: string; origem?: string }) => void;
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

export function WhatsappNotificationPanel({ leads, onSelectLead }: Props) {
  const { totalUnread, conversasNaoLidas } = useWhatsappUnread();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
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

  const handleAbrir = (lead: (Lead & { observacoes?: string; origem?: string }) | undefined) => {
    if (!lead) return;
    setOpen(false);
    onSelectLead(lead);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Botão do sino */}
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
              <span className="text-sm font-bold text-slate-800">Mensagens não lidas</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {conversasComLead.map((c) => (
              <button
                key={c.numero}
                onClick={() => handleAbrir(c.lead)}
                disabled={!c.lead}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex gap-3 items-start disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {c.lead?.nome || c.numero}
                    </p>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatarTempo(c.lastAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{c.lastMessage}</p>
                  {!c.lead && (
                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{c.numero}</p>
                  )}
                </div>
                {/* Indicador de não lido */}
                <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-2" />
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
