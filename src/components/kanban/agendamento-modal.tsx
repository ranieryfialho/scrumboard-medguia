"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface AgendamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: string, hora: string) => Promise<void>;
}

export function AgendamentoModal({ isOpen, onClose, onConfirm }: AgendamentoModalProps) {
  const [dataReuniao, setDataReuniao] = useState("");
  const [horaReuniao, setHoraReuniao] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      await onConfirm(dataReuniao, horaReuniao);
      setDataReuniao("");
      setHoraReuniao("");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Agendar Reunião de Apresentação</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input 
                type="date" 
                value={dataReuniao} 
                onChange={(e) => setDataReuniao(e.target.value)} 
                disabled={isSaving} 
              />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input 
                type="time" 
                value={horaReuniao} 
                onChange={(e) => setHoraReuniao(e.target.value)} 
                disabled={isSaving} 
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>Cancelar</Button>
          <Button className="bg-indigo-600 text-white" onClick={handleConfirm} disabled={!dataReuniao || !horaReuniao || isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Confirmar e Mover Card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}