import { Search, Stethoscope, CalendarDays, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FilterBarProps {
  buscaNome: string;
  setBuscaNome: (v: string) => void;
  filtroEspecialidade: string;
  setFiltroEspecialidade: (v: string) => void;
  filtroMes: string;
  setFiltroMes: (v: string) => void;
  especialidadesUnicas: string[];
  mesesUnicos: string[];
  limparFiltros: () => void;
  temFiltroAtivo: boolean;
}

export function FilterBar({
  buscaNome, setBuscaNome,
  filtroEspecialidade, setFiltroEspecialidade,
  filtroMes, setFiltroMes,
  especialidadesUnicas, mesesUnicos,
  limparFiltros, temFiltroAtivo
}: FilterBarProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-8 py-3 sticky top-[73px] z-10 shadow-sm animate-in slide-in-from-top-2">
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Buscar pelo nome..."
            value={buscaNome}
            onChange={(e) => setBuscaNome(e.target.value)}
            className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Stethoscope className="h-4 w-4 text-slate-400" />
          </div>
          <select
            value={filtroEspecialidade}
            onChange={(e) => setFiltroEspecialidade(e.target.value)}
            className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="">Todas as especialidades</option>
            {especialidadesUnicas.map(espec => (
              <option key={espec} value={espec}>{espec}</option>
            ))}
          </select>
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <CalendarDays className="h-4 w-4 text-slate-400" />
          </div>
          <select
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
            className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="">Todos os meses</option>
            {mesesUnicos.map(mes => (
              <option key={mes} value={mes}>{mes}</option>
            ))}
          </select>
        </div>

        {temFiltroAtivo && (
          <Button variant="ghost" onClick={limparFiltros} className="text-slate-500 hover:text-rose-600 h-9 px-3">
            <FilterX className="w-4 h-4 mr-2" />
            Limpar Filtros
          </Button>
        )}
      </div>
    </div>
  );
}