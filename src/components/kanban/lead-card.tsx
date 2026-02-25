import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lead } from "@/types/lead";
import { useDraggable } from "@dnd-kit/core";
import { Maximize2, Archive, RotateCcw, CalendarPlus, Clock, Mail, Phone } from "lucide-react";
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

const formatarData = (dataString?: string) => {
  if (!dataString) return '--/--/----';
  const match = dataString.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  const d = new Date(dataString);
  if (isNaN(d.getTime())) return dataString; 
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ''); 
};

const formatarTelefone = (tel?: string) => {
  if (!tel) return '';
  const apenasNumeros = tel.replace(/\D/g, ''); 

  if (apenasNumeros.length === 11) {
    return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 7)}-${apenasNumeros.slice(7)}`;
  } else if (apenasNumeros.length === 10) {
    return `(${apenasNumeros.slice(0, 2)}) ${apenasNumeros.slice(2, 6)}-${apenasNumeros.slice(6)}`;
  } else if (apenasNumeros.length === 13 && apenasNumeros.startsWith('55')) {
    return `+55 (${apenasNumeros.slice(2, 4)}) ${apenasNumeros.slice(4, 9)}-${apenasNumeros.slice(9)}`;
  } else if (apenasNumeros.length === 12 && apenasNumeros.startsWith('55')) {
    return `+55 (${apenasNumeros.slice(2, 4)}) ${apenasNumeros.slice(4, 8)}-${apenasNumeros.slice(8)}`;
  }
  return tel; 
};

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

  let realEmail = '';
  let realPhone = '';

  const extrairContato = (valorOriginal?: string) => {
    if (!valorOriginal) return;
    const limpo = valorOriginal.replace(/^p:?\s*/i, '').trim();
    if (limpo.includes('@')) {
      realEmail = limpo;
    } else if (/\d{8}/.test(limpo)) {
      realPhone = limpo;
    }
  };

  extrairContato(lead.email);
  extrairContato(lead.whatsapp);

  const isNovoLead = lead.situacao === 'Novos Leads';
  
  // Tema base neutro
  let theme = {
    bg: 'bg-white', border: 'border-slate-200', ring: '',
    dot: 'bg-slate-400', ping: 'bg-slate-400', text: 'text-slate-600',
    footerBorder: 'border-slate-100', badgeBg: 'bg-slate-100'
  };

  // Lógica de Cores Diferenciadas
  if (isNovoLead) {
    let horas = 0;
    if (lead.created_time) {
      const created = new Date(lead.created_time);
      if (!isNaN(created.getTime())) horas = (new Date().getTime() - created.getTime()) / (1000 * 60 * 60);
    }

    if (horas >= 48) {
      theme = { bg: 'bg-rose-50/40', border: 'border-rose-300', ring: 'ring-1 ring-rose-200/50', dot: 'bg-rose-500', ping: 'bg-rose-400', text: 'text-rose-700', footerBorder: 'border-rose-100', badgeBg: 'bg-rose-100' };
    } else if (horas >= 24) {
      theme = { bg: 'bg-amber-50/40', border: 'border-amber-300', ring: 'ring-1 ring-amber-200/50', dot: 'bg-amber-500', ping: 'bg-amber-400', text: 'text-amber-700', footerBorder: 'border-amber-100', badgeBg: 'bg-amber-100' };
    } else {
      theme = { bg: 'bg-emerald-50/40', border: 'border-emerald-300', ring: 'ring-1 ring-emerald-200/50', dot: 'bg-emerald-500', ping: 'bg-emerald-400', text: 'text-emerald-700', footerBorder: 'border-emerald-100', badgeBg: 'bg-emerald-100' };
    }
  } else {
    // Cores específicas para cada coluna (Quando já não é mais Novo Lead)
    switch(lead.situacao) {
      case 'Em contato':
        theme.badgeBg = 'bg-blue-100'; theme.text = 'text-blue-700'; theme.border = 'border-blue-200'; theme.bg = 'bg-blue-50/30';
        break;
      case 'Não atende':
        theme.badgeBg = 'bg-orange-100'; theme.text = 'text-orange-700'; theme.border = 'border-orange-200'; theme.bg = 'bg-orange-50/30';
        break;
      case 'Reunião agendada':
        theme.badgeBg = 'bg-purple-100'; theme.text = 'text-purple-700'; theme.border = 'border-purple-200'; theme.bg = 'bg-purple-50/30';
        break;
      case 'Fechado':
        theme.badgeBg = 'bg-emerald-100'; theme.text = 'text-emerald-700'; theme.border = 'border-emerald-200'; theme.bg = 'bg-emerald-50/30';
        break;
      case 'Sem interesse':
      case 'Desqualificado':
      case 'Arquivado':
      default:
        theme.badgeBg = 'bg-slate-100'; theme.text = 'text-slate-600';
        break;
    }
  }

  const renderDetalhesDaPlanilha = () => {
    const chavesOcultas = ['id', 'nome', 'whatsapp', 'cargo', 'tipo', 'situacao', 'email', 'responsavel', 'data_alteracao'];
    const chaves = Object.keys(lead).filter(k => !chavesOcultas.includes(k) && lead[k] !== '');
    if (chaves.length === 0) return <p className="text-sm text-slate-500">Nenhum dado extra encontrado.</p>;
    return chaves.map(chave => (
      <div key={chave} className="flex flex-col border-b border-slate-100 pb-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{chave.replace(/_/g, ' ')}</span>
        <span className="text-sm text-slate-700 break-words">{lead[chave as keyof Lead]}</span>
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
          <Card className={`group relative mb-3 transition-all duration-300 text-left overflow-hidden ${cursorClass} ${theme.bg} ${theme.border} ${theme.ring} ${isNovoLead ? 'shadow-md' : 'shadow-sm'}`}>
            
            <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
              <button
                type="button"
                title={lead.situacao === 'Arquivado' ? "Restaurar Lead" : "Arquivar Lead"}
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation(); 
                  onStatusChange?.(lead.id, lead.situacao === 'Arquivado' ? 'Novos Leads' : 'Arquivado');
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`p-1.5 rounded-md transition-colors ${
                  lead.situacao === 'Arquivado' 
                    ? 'text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50' 
                    : 'text-slate-400 hover:text-rose-500 hover:bg-rose-50'
                }`}
              >
                {lead.situacao === 'Arquivado' ? <RotateCcw className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              </button>
              <div className="p-1.5 text-slate-400 group-hover:text-indigo-500 transition-colors pointer-events-none">
                <Maximize2 className="w-3.5 h-3.5" />
              </div>
            </div>

            <CardHeader className="p-4 pb-2 space-y-1 relative z-10 pr-14">
              {lead.cargo && (
                <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider leading-tight line-clamp-1">
                  {lead.cargo}
                </div>
              )}
              <CardTitle className="text-sm font-bold text-slate-800 leading-snug line-clamp-2">
                {lead.nome}
              </CardTitle>
            </CardHeader>
            
            <CardContent className="p-4 pt-0 space-y-3 relative z-10">
              
              <div className="space-y-1.5">
                {realPhone && (
                  <div className="flex items-center text-xs text-slate-600 truncate pr-4" title="Telefone/WhatsApp">
                    <Phone className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
                    <span className="font-medium text-slate-700">{formatarTelefone(realPhone)}</span>
                  </div>
                )}
                {realEmail && (
                  <div className="flex items-center text-xs text-slate-600 truncate pr-4" title="E-mail">
                    <Mail className="w-3.5 h-3.5 mr-2 text-slate-400 shrink-0" />
                    <span className="truncate">{realEmail}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5 pt-3 border-t border-slate-100/60">
                <div className="flex items-center text-[10px] text-slate-500" title="Quando o lead entrou no sistema">
                  <CalendarPlus className="w-3 h-3 text-slate-400 mr-1.5 shrink-0" />
                  <span className="font-semibold text-slate-700 mr-1">Entrada:</span> 
                  {formatarData(lead.created_time)}
                </div>
                <div className="flex items-center text-[10px] text-slate-500" title="Última vez que o card mudou de coluna">
                  <Clock className="w-3 h-3 text-slate-400 mr-1.5 shrink-0" />
                  <span className="font-semibold text-slate-700 mr-1">Status alterado:</span> 
                  {formatarData(lead.data_alteracao)}
                </div>
              </div>

              {/* TAG DE STATUS: AGORA GRANDE E COLORIDA EM TODAS AS COLUNAS */}
              <div className="flex items-center justify-center mt-3 pt-4 border-t border-slate-100/60 pb-1">
                <div className={`flex items-center justify-center w-full gap-2 px-4 py-2 rounded-lg shadow-sm ${theme.badgeBg}`}>
                  {isNovoLead && (
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${theme.ping} opacity-75`}></span>
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${theme.dot}`}></span>
                    </span>
                  )}
                  <span className={`text-xs font-extrabold uppercase tracking-widest ${theme.text}`}>
                    {lead.situacao}
                  </span>
                </div>
              </div>

            </CardContent>
          </Card>
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">{lead.nome}</DialogTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">{lead.situacao}</Badge>
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
                <span className="text-sm font-medium text-slate-800">{realPhone ? formatarTelefone(realPhone) : '-'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">E-mail</span>
                <span className="text-sm font-medium text-slate-800 break-words">{realEmail || '-'}</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-3">Dados Originais</h4>
            <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-100">
              {renderDetalhesDaPlanilha()}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}