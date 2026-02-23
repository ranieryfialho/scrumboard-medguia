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
}

const COLUNAS_FIXAS = [
  "Novos Leads", 
  "Em contato", 
  "Não atende", 
  "Reunião agendada", 
  "Fechado",
  "Sem interesse",
  "Desqualificado"
];

export function KanbanBoard({ leads }: KanbanBoardProps) {
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

  const handleDragEnd = (event: DragEndEvent) => {
    setLeadAtivo(null);
    const { active, over } = event;

    if (!over) return;

    const leadId = active.id;
    const novaSituacao = over.id as string;

    setLocalLeads((prevLeads) => 
      prevLeads.map((lead) => 
        lead.id === leadId ? { ...lead, situacao: novaSituacao } : lead
      )
    );
  };

  const handleDragCancel = () => setLeadAtivo(null);

  const scrollToColumn = (tituloDaColuna: string) => {
    const headers = document.querySelectorAll('h3');
    const alvo = Array.from(headers).find(h3 => h3.textContent === tituloDaColuna);
    if (alvo) {
      alvo.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  const leadsPorColuna = localLeads.reduce((acc, lead) => {
    const situacao = COLUNAS_FIXAS.includes(lead.situacao || "") 
      ? lead.situacao 
      : COLUNAS_FIXAS[0]; 

    if (!acc[situacao]) acc[situacao] = [];
    acc[situacao].push(lead);
    return acc;
  }, {} as Record<string, Lead[]>);

  return (
    <div className="relative w-full h-full">
      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex h-[calc(100vh-12rem)] w-full overflow-x-auto gap-6 pb-4 relative z-10 custom-scrollbar">
          {COLUNAS_FIXAS.map((coluna) => {
            const leadsDaColuna = leadsPorColuna[coluna] || [];
            
            return (
              <KanbanColumn key={coluna} titulo={coluna} quantidade={leadsDaColuna.length}>
                {leadsDaColuna.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
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

      {/* MINIMAPA COMPACTO */}
      <div className="fixed bottom-4 right-4 z-50 bg-white/80 backdrop-blur-md border border-slate-200 shadow-lg rounded-lg p-2 hidden md:flex flex-col gap-1 transition-all duration-300 opacity-40 hover:opacity-100">
        <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider text-center">
          Mapa
        </div>
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
                    <div 
                      key={`mini-card-${lead.id}`} 
                      className={`w-full h-[3px] rounded-sm ${coluna === 'Fechado' ? 'bg-emerald-400' : 'bg-indigo-400/80'}`} 
                    />
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