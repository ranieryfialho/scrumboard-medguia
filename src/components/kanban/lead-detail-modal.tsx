"use client";

import { useState } from "react";
import { Lead } from "@/types/lead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, UserPlus, Phone, Mail,
  CalendarPlus, Clock, Tag,
} from "lucide-react";

interface LeadDetailModalProps {
  lead: Lead & { observacoes?: string; origem?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange?: (id: string, status: string) => void;
  onSaveObs?: (id: string, obs: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatarData = (dataString?: string) => {
  if (!dataString) return "--/--/----";
  const match = dataString.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  const d = new Date(dataString);
  if (isNaN(d.getTime())) return dataString;
  return d
    .toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
    .replace(",", "");
};

const formatarTelefone = (tel?: string) => {
  if (!tel) return "";
  const n = tel.replace(/\D/g, "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  if (n.length === 13 && n.startsWith("55")) return `+55 (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.length === 12 && n.startsWith("55")) return `+55 (${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`;
  return tel;
};

function resolverContatos(lead: Lead) {
  let realEmail = "";
  let realPhone = "";
  const extrair = (v?: string) => {
    if (!v) return;
    const limpo = v.replace(/^p:?\s*/i, "").trim();
    if (limpo.includes("@")) realEmail = limpo;
    else if (/\d{8}/.test(limpo)) realPhone = limpo;
  };
  extrair(lead.email);
  extrair(lead.whatsapp);
  return { realEmail, realPhone };
}

// ── Badge de situação ─────────────────────────────────────────────────────────
const SITUACAO_COLORS: Record<string, string> = {
  "Novos Leads":         "bg-blue-50   text-blue-700   border-blue-200",
  "Em contato":          "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Recontato":           "bg-orange-50 text-orange-700 border-orange-200",
  "Reunião agendada":    "bg-purple-50 text-purple-700 border-purple-200",
  "Aguardando Ativação": "bg-cyan-50   text-cyan-700   border-cyan-200",
  "Fechado":             "bg-green-50  text-green-700  border-green-200",
  "Sem interesse":       "bg-slate-100 text-slate-600  border-slate-200",
  "Desqualificado":      "bg-red-50    text-red-700    border-red-200",
  "Arquivado":           "bg-slate-100 text-slate-500  border-slate-200",
};

const ORIGEM_COLORS: Record<string, string> = {
  "Manual":             "bg-slate-100  text-slate-600  border-slate-200",
  "Manual - LP":        "bg-violet-50  text-violet-700 border-violet-200",
  "Manual - Indicação": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Manual - Outro":     "bg-slate-100  text-slate-600  border-slate-200",
  "BM Dr. Felipe":      "bg-sky-50     text-sky-700    border-sky-200",
  "BM MedGuia":         "bg-indigo-50  text-indigo-700 border-indigo-200",
};

// ── Seletor de status ─────────────────────────────────────────────────────────
const SITUACOES = [
  "Novos Leads", "Em contato", "Recontato",
  "Reunião agendada", "Aguardando Ativação",
  "Fechado", "Sem interesse", "Desqualificado", "Arquivado",
];

// ── Componente ────────────────────────────────────────────────────────────────
export function LeadDetailModal({
  lead,
  open,
  onOpenChange,
  onStatusChange,
  onSaveObs,
}: LeadDetailModalProps) {
  const [obsTexto, setObsTexto]     = useState(lead.observacoes || "");
  const [salvandoObs, setSalvandoObs] = useState(false);
  const [situacaoLocal, setSituacaoLocal] = useState(lead.situacao);

  const { realEmail, realPhone } = resolverContatos(lead);

  const handleSalvarObs = async () => {
    if (!onSaveObs) return;
    setSalvandoObs(true);
    await onSaveObs(lead.id, obsTexto);
    setSalvandoObs(false);
  };

  const handleSituacao = (nova: string) => {
    setSituacaoLocal(nova);
    onStatusChange?.(lead.id, nova);
  };

  // Dados extras da origem (oculta campos já exibidos)
  const CHAVES_OCULTAS = [
    "id", "nome", "whatsapp", "cargo", "tipo", "situacao",
    "email", "responsavel", "data_alteracao", "observacoes", "origem",
    "created_time",
  ];
  const chavesExtras = Object.keys(lead).filter(
    (k) => !CHAVES_OCULTAS.includes(k) && lead[k as keyof typeof lead] !== ""
  );

  const isManual = (lead.origem || "").startsWith("Manual");
  const origemCls = ORIGEM_COLORS[lead.origem || ""] ?? "bg-slate-100 text-slate-600 border-slate-200";
  const situacaoCls = SITUACAO_COLORS[situacaoLocal] ?? "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar p-0">

        {/* ── Cabeçalho colorido ─────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 px-6 pt-6 pb-5 rounded-t-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white leading-tight">
              {lead.nome}
            </DialogTitle>
          </DialogHeader>
          {lead.cargo && (
            <p className="text-indigo-200 text-xs font-semibold uppercase tracking-widest mt-1">
              {lead.cargo}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase tracking-wider ${situacaoCls}`}>
              {situacaoLocal}
            </span>
            {lead.origem && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border ${origemCls}`}>
                <Tag className="w-3 h-3" />
                {lead.origem}
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* ── Contatos ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg border border-slate-100 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <Phone className="w-3 h-3" /> WhatsApp
              </div>
              {realPhone ? (
                <a
                  href={`https://wa.me/${realPhone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors break-all"
                >
                  {formatarTelefone(realPhone)}
                </a>
              ) : (
                <span className="text-sm text-slate-400">—</span>
              )}
            </div>

            <div className="bg-slate-50 rounded-lg border border-slate-100 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <Mail className="w-3 h-3" /> E-mail
              </div>
              {realEmail ? (
                <a
                  href={`mailto:${realEmail}`}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 hover:underline transition-colors break-all"
                >
                  {realEmail}
                </a>
              ) : (
                <span className="text-sm text-slate-400">—</span>
              )}
            </div>
          </div>

          {/* ── Datas ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2 text-xs text-slate-500">
              <CalendarPlus className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-700 block">Entrada</span>
                {formatarData(lead.created_time)}
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-700 block">Última alteração</span>
                {formatarData(lead.data_alteracao)}
              </div>
            </div>
          </div>

          {/* ── Alterar situação ──────────────────────────────────────────── */}
          {onStatusChange && (
            <div>
              <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3 text-sm">
                Alterar Situação
              </h4>
              <div className="flex flex-wrap gap-2">
                {SITUACOES.map((s) => {
                  const cls = SITUACAO_COLORS[s] ?? "bg-slate-100 text-slate-700 border-slate-200";
                  const ativo = situacaoLocal === s;
                  return (
                    <button
                      key={s}
                      onClick={() => handleSituacao(s)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase tracking-wider transition-all ${cls} ${
                        ativo
                          ? "ring-2 ring-offset-1 ring-indigo-400 scale-105 shadow-sm"
                          : "opacity-60 hover:opacity-100"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Observações ───────────────────────────────────────────────── */}
          <div>
            <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3 text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" /> Observações
            </h4>
            <div className="space-y-3">
              <textarea
                className="w-full min-h-[100px] p-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y bg-slate-50 text-slate-700 placeholder:text-slate-400"
                placeholder="Adicione notas, histórico de ligações ou informações importantes..."
                value={obsTexto}
                onChange={(e) => setObsTexto(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleSalvarObs}
                  disabled={salvandoObs || obsTexto === (lead.observacoes || "")}
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                >
                  {salvandoObs ? "Salvando..." : "Salvar Anotação"}
                </Button>
              </div>
            </div>
          </div>

          {/* ── Dados extras da origem ────────────────────────────────────── */}
          <div>
            <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3 text-sm">
              Dados da Origem
            </h4>
            <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-100">
              {isManual ? (
                <div className="flex flex-col items-center justify-center py-4 text-center space-y-3 border border-indigo-100 border-dashed rounded-lg bg-indigo-50/30">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-500">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 text-sm">Lead Adicionado Manualmente</h5>
                    <p className="text-xs text-slate-500 mt-1 max-w-[240px] mx-auto">
                      Este lead foi cadastrado via painel e não possui dados brutos do Meta Ads.
                    </p>
                  </div>
                </div>
              ) : chavesExtras.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum dado extra encontrado.</p>
              ) : (
                chavesExtras.map((chave) => (
                  <div key={chave} className="flex flex-col border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {chave.replace(/_/g, " ")}
                    </span>
                    <span className="text-sm text-slate-700 break-words">
                      {String(lead[chave as keyof Lead])}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}