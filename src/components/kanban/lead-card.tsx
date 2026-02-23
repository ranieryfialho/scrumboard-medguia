import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lead } from "@/types/lead";
import { useDraggable } from "@dnd-kit/core";
import { Maximize2 } from "lucide-react"; // <-- Importamos o ícone aqui
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
}

export function LeadCard({ lead, isOverlay }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        className="mb-3 h-[90px] rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 opacity-50"
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

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className={`touch-none ${isOverlay ? 'cursor-grabbing rotate-2 scale-105 shadow-2xl opacity-90' : ''}`}
        >
          {/* Adicionamos 'group' e 'relative' aqui para controlar o ícone no hover */}
          <Card className="group relative mb-3 cursor-pointer hover:border-indigo-400 transition-colors bg-white shadow-sm text-left border-slate-200">
            
            {/* O ÍCONE NO CANTO SUPERIOR DIREITO */}
            <div className="absolute top-3 right-3 text-slate-300 group-hover:text-indigo-500 transition-colors">
              <Maximize2 className="w-3.5 h-3.5" />
            </div>

            <CardHeader className="p-3 pb-1 space-y-0">
              {/* Adicionamos pr-6 (padding-right) para o texto não encostar no ícone */}
              <CardTitle className="text-sm font-bold text-slate-800 leading-tight line-clamp-1 pr-6">
                {lead.cargo && <span className="text-indigo-600 font-semibold">{lead.cargo} </span>}
                {lead.nome}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-1 space-y-1">
              {lead.email && (
                <p className="text-xs text-slate-600 truncate pr-6" title={lead.email}>
                  ✉️ {lead.email}
                </p>
              )}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
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
        
        <div className="mt-6 space-y-6">
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