"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export interface FormFechamentoData {
  plataformaAnterior: string;
  oQueMaisInteressou: string;
  oQueDeixouADesejar: string;
  porOndeConheceu: string;
  planoEscolhido: string;
  observacoesGerais: string;
}

interface FechamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dados: FormFechamentoData) => Promise<void>;
}

export function FechamentoModal({ isOpen, onClose, onConfirm }: FechamentoModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormFechamentoData>({
    plataformaAnterior: "",
    oQueMaisInteressou: "",
    oQueDeixouADesejar: "",
    porOndeConheceu: "",
    planoEscolhido: "",
    observacoesGerais: ""
  });

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await onConfirm(form);
      setForm({ plataformaAnterior: "", oQueMaisInteressou: "", oQueDeixouADesejar: "", porOndeConheceu: "", planoEscolhido: "", observacoesGerais: "" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle>🎉 Parabéns! Vamos documentar esse fechamento?</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Qual plataforma ele usava antes?</Label>
            <Input placeholder="Ex: Doctoralia, iClinic, Planilha de Excel" value={form.plataformaAnterior} onChange={(e) => setForm({...form, plataformaAnterior: e.target.value})} disabled={isSaving} />
          </div>
          <div className="space-y-2">
            <Label>O que deixou a desejar na outra plataforma?</Label>
            <Input placeholder="Ex: Suporte ruim, preço alto, faltava telemedicina" value={form.oQueDeixouADesejar} onChange={(e) => setForm({...form, oQueDeixouADesejar: e.target.value})} disabled={isSaving} />
          </div>
          <div className="space-y-2">
            <Label>O que MAIS interessou ele na MedGuia?</Label>
            <Input placeholder="Ex: Dashboard financeiro, agendamento online" value={form.oQueMaisInteressou} onChange={(e) => setForm({...form, oQueMaisInteressou: e.target.value})} disabled={isSaving} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Plano Escolhido</Label>
              <Input placeholder="Ex: Pro Anual" value={form.planoEscolhido} onChange={(e) => setForm({...form, planoEscolhido: e.target.value})} disabled={isSaving} />
            </div>
            <div className="space-y-2">
              <Label>Por onde conheceu?</Label>
              <Input placeholder="Ex: Instagram, Indicação" value={form.porOndeConheceu} onChange={(e) => setForm({...form, porOndeConheceu: e.target.value})} disabled={isSaving} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Observações Gerais / Combinados da Reunião</Label>
            <textarea 
              className="w-full min-h-[80px] p-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50"
              placeholder="Acordos de pagamento, expectativas de migração de dados..."
              value={form.observacoesGerais}
              onChange={(e) => setForm({...form, observacoesGerais: e.target.value})}
              disabled={isSaving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirm} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Salvar Fechamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}