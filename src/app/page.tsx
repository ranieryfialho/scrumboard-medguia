"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { RefreshCcw, Search, FilterX, Stethoscope, CalendarDays } from "lucide-react";

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados dos Filtros
  const [buscaNome, setBuscaNome] = useState("");
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [filtroMes, setFiltroMes] = useState("");

  useEffect(() => {
    buscarLeads();
  }, []);

  const buscarLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sheets');
      const data = await res.json();
      setLeads(data);
    } catch (error) {
      console.error("Erro ao buscar planilha:", error);
    } finally {
      setLoading(false);
    }
  };

  const especialidadesUnicas = useMemo(() => {
    const specs = leads.map(l => l.cargo).filter(Boolean);
    return Array.from(new Set(specs)).sort();
  }, [leads]);

  const mesesUnicos = useMemo(() => {
    const datas = leads.map(l => l.created_time).filter(Boolean);
    const meses = datas.map(d => {
      try {
        const date = new Date(d);
        if (isNaN(date.getTime())) return null;
        let mesFormatado = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
      } catch {
        return null;
      }
    }).filter(Boolean) as string[];
    
    return Array.from(new Set(meses));
  }, [leads]);

  const leadsFiltrados = useMemo(() => {
    return leads.filter(lead => {
      const matchNome = lead.nome?.toLowerCase().includes(buscaNome.toLowerCase());
      
      const matchEspec = filtroEspecialidade ? lead.cargo === filtroEspecialidade : true;

      let matchMes = true;
      if (filtroMes) {
        if (lead.created_time) {
          try {
            const date = new Date(lead.created_time);
            if (!isNaN(date.getTime())) {
              let mesFormatado = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              mesFormatado = mesFormatado.charAt(0).toUpperCase() + mesFormatado.slice(1);
              matchMes = mesFormatado === filtroMes;
            } else {
              matchMes = false;
            }
          } catch { matchMes = false; }
        } else {
          matchMes = false;
        }
      }

      return matchNome && matchEspec && matchMes;
    });
  }, [leads, buscaNome, filtroEspecialidade, filtroMes]);

  const limparFiltros = () => {
    setBuscaNome("");
    setFiltroEspecialidade("");
    setFiltroMes("");
  };

  const temFiltroAtivo = buscaNome !== "" || filtroEspecialidade !== "" || filtroMes !== "";

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Scrumboard Medguia
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Gerenciamento de Leads em Tempo Real
            </p>
          </div>
          <Button 
            onClick={buscarLeads} 
            disabled={loading}
            variant="outline"
            className="bg-white hover:bg-slate-50 text-slate-700 border-slate-300"
          >
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Sincronizando...' : 'Sincronizar Dados'}
          </Button>
        </div>
      </header>

      <div className="bg-white border-b border-slate-200 px-8 py-3 sticky top-[73px] z-10 shadow-sm">
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
              className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
            />
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Stethoscope className="h-4 w-4 text-slate-400" />
            </div>
            <select
              value={filtroEspecialidade}
              onChange={(e) => setFiltroEspecialidade(e.target.value)}
              className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md leading-5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none transition-colors cursor-pointer"
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
              className="block w-full pl-9 pr-8 py-2 border border-slate-200 rounded-md leading-5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm appearance-none transition-colors cursor-pointer"
            >
              <option value="">Todos os meses</option>
              {mesesUnicos.map(mes => (
                <option key={mes} value={mes}>{mes}</option>
              ))}
            </select>
          </div>

          {temFiltroAtivo && (
            <Button 
              variant="ghost" 
              onClick={limparFiltros}
              className="text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors h-9 px-3"
            >
              <FilterX className="w-4 h-4 mr-2" />
              Limpar Filtros
            </Button>
          )}

          <div className="ml-auto text-sm text-slate-500 font-medium">
            {leadsFiltrados.length} {leadsFiltrados.length === 1 ? 'lead' : 'leads'}
          </div>

        </div>
      </div>

      <div className="flex-1 p-8 overflow-hidden max-w-[1600px] mx-auto w-full">
        {loading && leads.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-slate-500">
              <RefreshCcw className="w-8 h-8 animate-spin text-indigo-500" />
              <p>Carregando leads da planilha...</p>
            </div>
          </div>
        ) : (
          <KanbanBoard leads={leadsFiltrados} />
        )}
      </div>
    </main>
  );
}