"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CodigoErroTransicao } from "@/domain/pipeline/tipos";

export interface DadoPreenchido {
  valor?: number;
  motivoPerdaId?: string;
  proximaAcaoEm?: string;
  justificativa?: string;
}

interface ModalDadoFaltanteProps {
  codigo: CodigoErroTransicao;
  aberto: boolean;
  onCancelar: () => void;
  onConfirmar: (dado: DadoPreenchido) => void;
}

const TITULOS: Partial<Record<CodigoErroTransicao, string>> = {
  VALOR_OBRIGATORIO: "Informe o valor",
  MOTIVO_PERDA_OBRIGATORIO: "Selecione o motivo da perda",
  PROXIMA_ACAO_OBRIGATORIA: "Informe a próxima ação",
  JUSTIFICATIVA_OBRIGATORIA: "Informe a justificativa",
};

/** AC-088/AC-089/AC-090: um campo por código — reenvia a transição ao confirmar; cancelar não chama nada. */
export function ModalDadoFaltante({ codigo, aberto, onCancelar, onConfirmar }: ModalDadoFaltanteProps) {
  const [valor, setValor] = useState("");
  const [motivoPerdaId, setMotivoPerdaId] = useState("");
  const [proximaAcaoEm, setProximaAcaoEm] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [motivos, setMotivos] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    if (codigo !== "MOTIVO_PERDA_OBRIGATORIO" || !aberto) return;
    fetch("/api/motivos-perda")
      .then((resposta) => (resposta.ok ? resposta.json() : { itens: [] }))
      .then((corpo) => setMotivos(corpo.itens ?? []))
      .catch(() => setMotivos([]));
  }, [codigo, aberto]);

  const confirmar = () => {
    if (codigo === "VALOR_OBRIGATORIO") {
      const numero = Number(valor);
      if (!(numero > 0)) return;
      onConfirmar({ valor: numero });
    } else if (codigo === "MOTIVO_PERDA_OBRIGATORIO") {
      if (!motivoPerdaId) return;
      onConfirmar({ motivoPerdaId });
    } else if (codigo === "PROXIMA_ACAO_OBRIGATORIA") {
      if (!proximaAcaoEm) return;
      onConfirmar({ proximaAcaoEm: new Date(proximaAcaoEm).toISOString() });
    } else if (codigo === "JUSTIFICATIVA_OBRIGATORIA") {
      if (!justificativa.trim()) return;
      onConfirmar({ justificativa: justificativa.trim() });
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITULOS[codigo] ?? "Informe o dado pedido"}</DialogTitle>
          <DialogDescription>Esse dado é obrigatório para mover o card pra essa etapa.</DialogDescription>
        </DialogHeader>

        {codigo === "VALOR_OBRIGATORIO" && (
          <div className="space-y-1.5">
            <Label htmlFor="modal-valor">Valor</Label>
            <Input id="modal-valor" type="number" min="0.01" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
        )}

        {codigo === "MOTIVO_PERDA_OBRIGATORIO" && (
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Select value={motivoPerdaId} onValueChange={setMotivoPerdaId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione um motivo" />
              </SelectTrigger>
              <SelectContent>
                {motivos.map((motivo) => (
                  <SelectItem key={motivo.id} value={motivo.id}>
                    {motivo.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {codigo === "PROXIMA_ACAO_OBRIGATORIA" && (
          <div className="space-y-1.5">
            <Label htmlFor="modal-proxima-acao">Próxima ação (data futura)</Label>
            <Input
              id="modal-proxima-acao"
              type="datetime-local"
              value={proximaAcaoEm}
              onChange={(e) => setProximaAcaoEm(e.target.value)}
            />
          </div>
        )}

        {codigo === "JUSTIFICATIVA_OBRIGATORIA" && (
          <div className="space-y-1.5">
            <Label htmlFor="modal-justificativa">Justificativa</Label>
            <textarea
              id="modal-justificativa"
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              rows={3}
              className="border-input flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        )}

        {codigo === "EVIDENCIA_OBRIGATORIA" && (
          <p className="text-sm text-slate-500">
            Essa etapa exige envio de anexo, ainda não suportado nesta tela.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={codigo === "EVIDENCIA_OBRIGATORIA"}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
