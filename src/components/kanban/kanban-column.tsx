import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";

interface KanbanColumnProps {
  titulo: string;
  quantidade: number;
  children: React.ReactNode;
}

export function KanbanColumn({ titulo, quantidade, children }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: titulo,
  });

  return (
    <div 
      ref={setNodeRef}
      className={`flex flex-col min-w-[320px] max-w-[320px] rounded-xl p-3 border transition-colors ${
        isOver ? "bg-slate-200/60 border-indigo-300" : "bg-slate-100/50 border-slate-200/60"
      }`}
    >
      <div className="flex items-center justify-between mb-4 px-1">
        <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">
          {titulo}
        </h3>
        <Badge variant="secondary" className="bg-slate-200 text-slate-600 hover:bg-slate-200">
          {quantidade}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
        {children}
      </div>
    </div>
  );
}