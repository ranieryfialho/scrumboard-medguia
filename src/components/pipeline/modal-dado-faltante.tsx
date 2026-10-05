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
  anexoId?: string;
}

interface ModalDadoFaltanteProps {
  codigo: CodigoErroTransicao;
  aberto: boolean;
  /** Card que recebe o anexo de evidência (EVIDENCIA_OBRIGATORIA). */
  oportunidadeId?: string;
  onCancelar: () => void;
  onConfirmar: (dado: DadoPreenchido) => void;
}

const TITULOS: Partial<Record<CodigoErroTransicao, string>> = {
  VALOR_OBRIGATORIO: "Informe o valor",
  MOTIVO_PERDA_OBRIGATORIO: "Selecione o motivo da perda",
  PROXIMA_ACAO_OBRIGATORIA: "Informe a próxima ação",
  JUSTIFICATIVA_OBRIGATORIA: "Informe a justificativa",
};

const ERROS_DE_ENVIO: Record<string, string> = {
  TIPO_NAO_PERMITIDO: "Tipo de arquivo não permitido. Envie PNG, JPEG, WebP ou PDF.",
  ARQUIVO_GRANDE_DEMAIS: "Arquivo grande demais. Imagens até 5 MB e PDF até 10 MB.",
  OPORTUNIDADE_NAO_ENCONTRADA: "Esse card não foi encontrado.",
  NAO_AUTENTICADO: "Sua sessão expirou. Entre novamente.",
};

/** AC-088/AC-089/AC-090: um campo por código — reenvia a transição ao confirmar; cancelar não chama nada. */
export function ModalDadoFaltante({ codigo, aberto, oportunidadeId, onCancelar, onConfirmar }: ModalDadoFaltanteProps) {
  const [valor, setValor] = useState("");
  const [motivoPerdaId, setMotivoPerdaId] = useState("");
  const [proximaAcaoEm, setProximaAcaoEm] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [motivos, setMotivos] = useState<{ id: string; nome: string }[]>([]);
  const [anexo, setAnexo] = useState<{ id: string; nome: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  useEffect(() => {
    if (codigo !== "MOTIVO_PERDA_OBRIGATORIO" || !aberto) return;
    fetch("/api/motivos-perda")
      .then((resposta) => (resposta.ok ? resposta.json() : { itens: [] }))
      .then((corpo) => setMotivos(corpo.itens ?? []))
      .catch(() => setMotivos([]));
  }, [codigo, aberto]);

  // AC-107: envia o arquivo escolhido ou colado; só um envio bem-sucedido libera o Confirmar.
  const enviarArquivo = async (arquivo: File) => {
    if (!oportunidadeId) return;
    setEnviando(true);
    setErroEnvio(null);
    setAnexo(null);
    try {
      const formulario = new FormData();
      formulario.set("oportunidadeId", oportunidadeId);
      formulario.set("arquivo", arquivo);
      const resposta = await fetch("/api/anexos", { method: "POST", body: formulario });
      const corpo = await resposta.json().catch(() => ({}));
      if (resposta.ok && corpo.anexoId) {
        setAnexo({ id: corpo.anexoId, nome: arquivo.name });
      } else {
        setErroEnvio(ERROS_DE_ENVIO[corpo.codigo] ?? "Não foi possível enviar o arquivo. Tente novamente.");
      }
    } catch {
      setErroEnvio("Não foi possível enviar o arquivo. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const aoColar = (evento: React.ClipboardEvent) => {
    if (codigo !== "EVIDENCIA_OBRIGATORIA") return;
    const imagem = Array.from(evento.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
    if (!imagem) return;
    evento.preventDefault();
    void enviarArquivo(imagem);
  };

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
    } else if (codigo === "EVIDENCIA_OBRIGATORIA") {
      if (!anexo) return;
      onConfirmar({ anexoId: anexo.id });
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(open) => !open && onCancelar()}>
      <DialogContent onPaste={aoColar}>
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
          <div className="space-y-1.5">
            <Label htmlFor="modal-anexo">Print ou PDF da evidência</Label>
            <Input
              id="modal-anexo"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              disabled={enviando}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) void enviarArquivo(arquivo);
              }}
            />
            <p className="text-xs text-slate-500">Escolha um arquivo ou cole um print (Ctrl+V). Imagens até 5 MB, PDF até 10 MB.</p>
            {enviando && <p className="text-sm text-slate-500">Enviando...</p>}
            {anexo && <p className="text-sm text-emerald-700">Anexado: {anexo.nome}</p>}
            {erroEnvio && (
              <p role="alert" className="text-sm text-red-600">
                {erroEnvio}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={codigo === "EVIDENCIA_OBRIGATORIA" && (!anexo || enviando)}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
