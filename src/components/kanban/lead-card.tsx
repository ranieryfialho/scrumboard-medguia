import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lead } from "@/types/lead";
import { useDraggable } from "@dnd-kit/core";
import { Maximize2, Archive, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface LeadCardProps {
  lead: Lead;
  isOverlay?: boolean;
  disableDrag?: boolean;
  onStatusChange?: (id: string, status: string) => void;
}

export function LeadCard({ lead, isOverlay, disableDrag, onStatusChange }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
    disabled: disableDrag,
  });

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        className="mb-3 h-[90px] w-full rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 opacity-50"
      />
    );
  }

  const renderDetalhesDaPlanilha = () => {
    const chavesOcultas = ['id', 'nome', 'whatsapp', 'cargo', 'tipo', 'situacao', 'email', 'responsavel'];
    const chaves = Object.keys(lead).filter(k => !chavesOcultas.includes(k) && lead[k] !== '');

    if (chaves.length === 0) return <p className="text-sm text-slate-500">Nenhum dado extra encontrado.</p>;

    return chaves.map(chave => (
      <div key={chave} className="flex flex-col border-b border-slate-100 pb-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {chave.replace(/_/g, ' ')}
        </span>
        <span className="text-sm text-slate-700 break-words">
          {lead[chave as keyof Lead]}
        </span>
      </div>
    ));
  };

  const dragProps = disableDrag ? {} : { ...listeners, ...attributes };
  const cursorClass = disableDrag ? 'cursor-pointer' : 'cursor-grab hover:border-indigo-400';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div
          ref={setNodeRef}
          {...dragProps}
          className={`touch-none ${isOverlay ? 'cursor-grabbing rotate-2 scale-105 shadow-2xl opacity-90' : ''}`}
        >
          <Card className={`group relative mb-3 transition-colors bg-white shadow-sm text-left border-slate-200 overflow-hidden ${cursorClass}`}>
            
            <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
              
              <button
                type="button"
                title={lead.situacao === 'Arquivado' ? "Restaurar Lead" : "Arquivar Lead"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStatusChange?.(lead.id, lead.situacao === 'Arquivado' ? 'Novos Leads' : 'Arquivado');
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                className={`p-1.5 rounded-md transition-colors ${
                  lead.situacao === 'Arquivado' 
                    ? 'text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50' 
                    : 'text-slate-300 hover:text-rose-500 hover:bg-rose-50'
                }`}
              >
                {lead.situacao === 'Arquivado' ? (
                  <RotateCcw className="w-4 h-4" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
              </button>

              <div className="p-1.5 text-slate-300 group-hover:text-indigo-500 transition-colors pointer-events-none">
                <Maximize2 className="w-3.5 h-3.5" />
              </div>

            </div>

            <CardHeader className="p-3 pb-1 space-y-0 relative z-10">
              <CardTitle className="text-sm font-bold text-slate-800 leading-tight line-clamp-1 pr-14">
                {lead.cargo && <span className="text-indigo-600 font-semibold">{lead.cargo} </span>}
                {lead.nome}
              </CardTitle>
            </CardHeader>
            
            <CardContent className="p-3 pt-1 space-y-1 relative z-10">
              {lead.email && (
                <p className="text-xs text-slate-600 truncate pr-14" title={lead.email}>
                  ✉️ {lead.email}
                </p>
              )}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 bg-white/80 backdrop-blur-sm rounded-b-lg">
                <span className="text-[11px] font-medium text-slate-600">
                  p: <span className="text-slate-800">{lead.whatsapp || 'S/N'}</span>
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  {lead.situacao}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">
            {lead.nome}
          </DialogTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
              {lead.situacao}
            </Badge>
            {lead.cargo && <Badge variant="secondary" className="bg-slate-100">{lead.cargo}</Badge>}
            {lead.tipo && <Badge variant="outline">{lead.tipo}</Badge>}
          </div>
        </DialogHeader>
        
        <div className="mt-4 space-y-6">
          <div>
            <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3">Informações de Contato</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Telefone</span>
                <span className="text-sm font-medium text-slate-800">{lead.whatsapp || '-'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">E-mail</span>
                <span className="text-sm font-medium text-slate-800 break-words">{lead.email || '-'}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3">Dados Originais (Meta Ads)</h4>
            <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-100">
              {renderDetalhesDaPlanilha()}
            </div>
          </div>
        </div>
        
      </DialogContent>
    </Dialog>
  );
}