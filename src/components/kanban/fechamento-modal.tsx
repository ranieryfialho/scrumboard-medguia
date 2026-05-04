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

const PONTOS_NEGATIVOS = [
  "Preço alto / custo-benefício ruim",
  "Suporte lento ou ineficiente",
  "Interface complicada / difícil de usar",
  "Falta de funcionalidades essenciais",
  "Sistema lento ou instável",
  "Falta de integração com outros sistemas",
  "Sem módulo de telemedicina",
  "Sem prontuário eletrônico completo",
  "Sem gestão financeira integrada",
  "Sem agendamento online para pacientes",
  "Sem aplicativo mobile",
  "Contrato longo e difícil de cancelar",
  "Falta de personalização",
  "Treinamento insuficiente na implantação",
  "Relatórios e métricas limitados",
  "Não atendia clínicas com múltiplos profissionais",
  "Outro",
];

const PLATAFORMAS = [
  "Doctoralia (Marketplace e Clínicas)",
  "TuoTempo",
  "Gipo (antiga CRM Clinic)",
  "Feegow Clinic",
  "iClinic (Grupo Afya)",
  "ProDoctor",
  "HiDoctor",
  "Shosp",
  "MedPlus",
  "Clínica Ágil",
  "Amplimed",
  "Clinicorp",
  "Simples Dental",
  "Belle Software",
  "GestãoDS",
  "Memed",
  "Nabla",
  "Heidi Health",
  "Outro",
];

const SELECT_CLASS = "w-full h-10 px-3 rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50";

interface FechamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (dados: FormFechamentoData) => Promise<void>;
  tipo?: "logins" | "clientes";
}

export function FechamentoModal({ isOpen, onClose, onConfirm, tipo = "logins" }: FechamentoModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [plataformaSelecionada, setPlataformaSelecionada] = useState("");
  const [plataformaOutro, setPlataformaOutro] = useState("");
  const [pontoNegativoSelecionado, setPontoNegativoSelecionado] = useState("");
  const [pontoNegativoOutro, setPontoNegativoOutro] = useState("");
  const [form, setForm] = useState<FormFechamentoData>({
    plataformaAnterior: "",
    oQueMaisInteressou: "",
    oQueDeixouADesejar: "",
    porOndeConheceu: "",
    planoEscolhido: "",
    observacoesGerais: ""
  });

  const handlePlataformaChange = (value: string) => {
    setPlataformaSelecionada(value);
    setPlataformaOutro("");
    setForm({ ...form, plataformaAnterior: value === "Outro" ? "" : value });
  };

  const isFormValido =
    form.plataformaAnterior !== "" &&
    form.oQueDeixouADesejar !== "" &&
    form.oQueMaisInteressou !== "" &&
    form.planoEscolhido !== "" &&
    form.porOndeConheceu !== "" &&
    form.observacoesGerais !== "";

  const handleConfirm = async () => {
    if (!isFormValido) return;
    setIsSaving(true);
    try {
      await onConfirm(form);
      setForm({ plataformaAnterior: "", oQueMaisInteressou: "", oQueDeixouADesejar: "", porOndeConheceu: "", planoEscolhido: "", observacoesGerais: "" });
      setPlataformaSelecionada("");
      setPlataformaOutro("");
      setPontoNegativoSelecionado("");
      setPontoNegativoOutro("");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  const tituloModal =
    tipo === "clientes"
      ? "Fechamento de Clientes confirmado. Vamos registrar os detalhes?"
      : "Parabéns! Vamos documentar esse fechamento?";

  const descricaoModal =
    tipo === "clientes"
      ? "Esse card entrou na etapa de fechamento comercial. Preencha os dados para manter o histórico completo."
      : "Preencha as informações da conversão para alimentar os relatórios comerciais.";

  const textoBotaoSalvar =
    tipo === "clientes" ? "Salvar Fechamento de Clientes" : "Salvar Fechamento";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle>{tituloModal}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-2">{descricaoModal}</p>
        <div className="grid gap-4 py-4">

          <div className="space-y-2">
            <Label>Qual plataforma ele usava antes? <span className="text-red-500">*</span></Label>
            <select
              value={plataformaSelecionada}
              onChange={(e) => handlePlataformaChange(e.target.value)}
              disabled={isSaving}
              className={SELECT_CLASS}
            >
              <option value="">Selecione a plataforma</option>
              {PLATAFORMAS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {plataformaSelecionada === "Outro" && (
              <Input
                placeholder="Nome da ferramenta *"
                value={plataformaOutro}
                onChange={(e) => {
                  setPlataformaOutro(e.target.value);
                  setForm({ ...form, plataformaAnterior: e.target.value });
                }}
                disabled={isSaving}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>O que deixou a desejar na outra plataforma? <span className="text-red-500">*</span></Label>
            <select
              value={pontoNegativoSelecionado}
              onChange={(e) => {
                const value = e.target.value;
                setPontoNegativoSelecionado(value);
                setPontoNegativoOutro("");
                setForm({ ...form, oQueDeixouADesejar: value === "Outro" ? "" : value });
              }}
              disabled={isSaving}
              className={SELECT_CLASS}
            >
              <option value="">Selecione o motivo</option>
              {PONTOS_NEGATIVOS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {pontoNegativoSelecionado === "Outro" && (
              <Input
                placeholder="Descreva o que deixou a desejar *"
                value={pontoNegativoOutro}
                onChange={(e) => {
                  setPontoNegativoOutro(e.target.value);
                  setForm({ ...form, oQueDeixouADesejar: e.target.value });
                }}
                disabled={isSaving}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>O que MAIS interessou ele na MedGuia? <span className="text-red-500">*</span></Label>
            <Input
              placeholder="Ex: Dashboard financeiro, agendamento online"
              value={form.oQueMaisInteressou}
              onChange={(e) => setForm({...form, oQueMaisInteressou: e.target.value})}
              disabled={isSaving}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Plano Escolhido <span className="text-red-500">*</span></Label>
              <select
                value={form.planoEscolhido}
                onChange={(e) => setForm({...form, planoEscolhido: e.target.value})}
                disabled={isSaving}
                className={SELECT_CLASS}
              >
                <option value="">Selecione o plano</option>
                <option value="Starter">Starter</option>
                <option value="Evolution IA">Evolution IA</option>
                <option value="Premium IA">Premium IA</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Por onde conheceu? <span className="text-red-500">*</span></Label>
              <select
                value={form.porOndeConheceu}
                onChange={(e) => setForm({...form, porOndeConheceu: e.target.value})}
                disabled={isSaving}
                className={SELECT_CLASS}
              >
                <option value="">Selecione a origem</option>
                <option value="Instagram">Instagram</option>
                <option value="Facebook">Facebook</option>
                <option value="Landing Page">Landing Page</option>
                <option value="Indicação">Indicação</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações Gerais / Combinados da Reunião <span className="text-red-500">*</span></Label>
            <textarea
              className="w-full min-h-[80px] p-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 bg-slate-50 disabled:opacity-50"
              placeholder="Acordos de pagamento, expectativas de migração de dados..."
              value={form.observacoesGerais}
              onChange={(e) => setForm({...form, observacoesGerais: e.target.value})}
              disabled={isSaving}
            />
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancelar</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            onClick={handleConfirm}
            disabled={isSaving || !isFormValido}
          >
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {textoBotaoSalvar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
