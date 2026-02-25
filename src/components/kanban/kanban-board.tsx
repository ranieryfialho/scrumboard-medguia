import { useState, useEffect } from "react";
import { Lead } from "@/types/lead";
import { LeadCard } from "./lead-card";
import { KanbanColumn } from "./kanban-column";
import { 
  DndContext, 
  DragEndEvent, 
  DragStartEvent,
  useSensor, 
  useSensors, 
  PointerSensor,
  DragOverlay
} from "@dnd-kit/core";

interface KanbanBoardProps {
  leads: Lead[];
  onStatusChange?: (id: string, novaSituacao: string) => void;
}

const COLUNAS_FIXAS = [
  "Novos Leads", 
  "Em contato", 
  "Recontato", 
  "Reunião agendada", 
  "Fechado",
  "Sem interesse",
  "Desqualificado"
];

export function KanbanBoard({ leads, onStatusChange }: KanbanBoardProps) {
  const [localLeads, setLocalLeads] = useState<Lead[]>(leads);
  const [leadAtivo, setLeadAtivo] = useState<Lead | null>(null);

  useEffect(() => {
    setLocalLeads(leads);
  }, [leads]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const lead = localLeads.find(l => l.id === active.id);
    if (lead) setLeadAtivo(lead);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setLeadAtivo(null);
    const { active, over } = event;

    if (!over) return;

    const leadId = active.id as string;
    const novaSituacao = over.id as string;

    const leadAtual = localLeads.find(l => l.id === leadId);
    if (!leadAtual || leadAtual.situacao === novaSituacao) return;

    setLocalLeads((prevLeads) => 
      prevLeads.map((lead) => 
        lead.id === leadId ? { ...lead, situacao: novaSituacao } : lead
      )
    );

    if (onStatusChange) {
      onStatusChange(leadId, novaSituacao);
    } else {
      try {
        const resposta = await fetch('/api/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: leadId, novaSituacao })
        });
        if (!resposta.ok) console.error("Erro na API ao tentar salvar o card.");
      } catch (error) {
        console.error("Erro de rede ao salvar o card:", error);
      }
    }
  };

  const handleDragCancel = () => setLeadAtivo(null);

  const scrollToColumn = (tituloDaColuna: string) => {
    const headers = document.querySelectorAll('h3');
    const alvo = Array.from(headers).find(h3 => h3.textContent === tituloDaColuna);
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const leadsAtivos = localLeads.filter(l => l.situacao !== 'Arquivado');

  const leadsPorColuna = leadsAtivos.reduce((acc, lead) => {
    const situacao = COLUNAS_FIXAS.includes(lead.situacao || "") ? lead.situacao : COLUNAS_FIXAS[0]; 
    if (!acc[situacao]) acc[situacao] = [];
    acc[situacao].push(lead);
    return acc;
  }, {} as Record<string, Lead[]>);

  return (
    <div className="relative w-full h-full flex flex-col">
      
      {/* LEGENDA DO TERMÔMETRO DE SLA */}
      <div className="flex flex-wrap items-center gap-6 mb-4 px-4 shrink-0 bg-white/60 py-2.5 rounded-lg border border-slate-200/60 w-max shadow-sm">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-2">
          Termômetro de Novos Leads:
        </span>
        
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-xs font-semibold text-slate-600">Até 24h (Quente)</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </span>
          <span className="text-xs font-semibold text-slate-600">24h a 48h (Atenção)</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
          </span>
          <span className="text-xs font-semibold text-slate-600">Mais de 48h (Crítico)</span>
        </div>
      </div>

      {/* ÁREA DE DRAG AND DROP DAS COLUNAS */}
      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 w-full overflow-x-auto gap-6 pb-4 relative z-0 custom-scrollbar">
          {COLUNAS_FIXAS.map((coluna) => {
            const leadsDaColuna = leadsPorColuna[coluna] || [];
            return (
              <KanbanColumn key={coluna} titulo={coluna} quantidade={leadsDaColuna.length}>
                {leadsDaColuna.map((lead) => (
                  <LeadCard 
                    key={lead.id} 
                    lead={lead} 
                    onStatusChange={(id, status) => {
                      setLocalLeads(prev => prev.map(l => l.id === id ? { ...l, situacao: status } : l));
                      if (onStatusChange) onStatusChange(id, status);
                    }}
                  />
                ))}
                {leadsDaColuna.length === 0 && (
                  <div className="h-24 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-sm">
                    Nenhum lead
                  </div>
                )}
              </KanbanColumn>
            );
          })}
        </div>

        <DragOverlay>
          {leadAtivo ? <LeadCard lead={leadAtivo} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      <div className="fixed bottom-4 right-4 z-50 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-lg p-2 hidden md:flex flex-col gap-1 transition-all duration-300 opacity-40 hover:opacity-100">
        <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider text-center">Mapa</div>
        <div className="flex gap-1 h-16">
          {COLUNAS_FIXAS.map((coluna) => {
            const leadsDaColuna = leadsPorColuna[coluna] || [];
            return (
              <div 
                key={`mini-${coluna}`} 
                onClick={() => scrollToColumn(coluna)}
                className="w-4 bg-slate-100/80 rounded block p-[1px] overflow-hidden border border-slate-200/50 relative cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                title={`Rolar para: ${coluna}`}
              >
                <div className="flex flex-col gap-[1px]">
                  {leadsDaColuna.map((lead) => (
                    <div key={`mini-card-${lead.id}`} className={`w-full h-[3px] rounded-sm ${coluna === 'Fechado' ? 'bg-emerald-400' : 'bg-indigo-400/80'}`} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}