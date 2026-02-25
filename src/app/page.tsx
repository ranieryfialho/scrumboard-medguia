"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCcw, Archive } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { LeadCard } from "@/components/kanban/lead-card";

import { normalizarEspecialidade } from "@/utils/formatters";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string>("--:--");
  
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [abaAtiva, setAbaAtiva] = useState("dashboard");

  const [buscaNome, setBuscaNome] = useState("");
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [filtroMes, setFiltroMes] = useState("");

  // =================
  // MOTOR DE BUSCA
  // =================
  const buscarLeads = async (isBackground = false) => {
    if (isBackground) setIsSyncing(true);
    else setLoading(true);

    try {
      const timestamp = new Date().getTime();
      const res = await fetch(`/api/sheets?t=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache'
        }
      });
      
      const data = await res.json();
      
      if (Array.isArray(data)) {
        setLeads(data);
        setUltimaAtualizacao(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } else if (!isBackground) {
        setLeads([]);
      }
    } catch (error) {
      console.error("Erro ao buscar planilha:", error);
      if (!isBackground) setLeads([]);
    } finally {
      if (isBackground) setIsSyncing(false);
      else setLoading(false);
    }
  };

  // =====================
  // LOOP DE AUTO-UPDATE
  // =====================
  useEffect(() => {
    buscarLeads();

    const intervalo = setInterval(() => {
      buscarLeads(true); 
    }, 120000); 

    return () => clearInterval(intervalo);
  }, []);

  const atualizarSituacaoLead = async (leadId: string, novaSituacao: string) => {
    const dataAtual = new Date().toLocaleString('pt-BR');

    setLeads(prevLeads => prevLeads.map(lead => 
      lead.id === leadId 
        ? { ...lead, situacao: novaSituacao, data_alteracao: dataAtual } 
        : lead
    ));

    try {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, novaSituacao })
      });
    } catch (error) {
      console.error("Erro de rede ao salvar:", error);
    }
  };

  const especialidadesUnicas = useMemo(() => {
    const specs = leads.map(l => normalizarEspecialidade(l.cargo)).filter(Boolean) as string[];
    return Array.from(new Set(specs)).sort();
  }, [leads]);
  
  const mesesUnicos = useMemo(() => {
    const datas = leads.map(l => l.created_time).filter(Boolean);
    const meses = datas.map(d => {
      try {
        const dateObj = new Date(d);
        if (isNaN(dateObj.getTime())) return null;
        let m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return m.charAt(0).toUpperCase() + m.slice(1);
      } catch { return null; }
    }).filter(Boolean) as string[];
    return Array.from(new Set(meses));
  }, [leads]);

  const leadsFiltrados = useMemo(() => {
    return leads.filter(lead => {
      const matchNome = lead.nome?.toLowerCase().includes(buscaNome.toLowerCase());
      const matchEspec = filtroEspecialidade ? normalizarEspecialidade(lead.cargo) === filtroEspecialidade : true;
      let matchMes = true;
      if (filtroMes) {
        if (lead.created_time) {
          try {
            const dateObj = new Date(lead.created_time);
            if (!isNaN(dateObj.getTime())) {
              let m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              matchMes = (m.charAt(0).toUpperCase() + m.slice(1)) === filtroMes;
            } else matchMes = false;
          } catch { matchMes = false; }
        } else matchMes = false;
      }
      return matchNome && matchEspec && matchMes;
    });
  }, [leads, buscaNome, filtroEspecialidade, filtroMes]);

  const kpis = useMemo(() => {
    const ativos = leadsFiltrados.filter(l => l.situacao !== 'Arquivado');
    const total = ativos.length;
    const novos = ativos.filter(l => l.situacao === 'Novos Leads' || l.situacao === 'Sem situação').length;
    const fechados = ativos.filter(l => l.situacao === 'Fechado').length;
    const emAndamento = ativos.filter(l => ['Em contato', 'Recontato', 'Reunião agendada', 'Aguardando Ativação'].includes(l.situacao)).length;
    const taxaConversao = total > 0 ? ((fechados / total) * 100).toFixed(1) : "0.0";
    return { total, novos, fechados, emAndamento, taxaConversao };
  }, [leadsFiltrados]);

  const arquivadosList = leadsFiltrados.filter(l => l.situacao === 'Arquivado');

  const dadosGrafico = useMemo(() => {
    const contagem: Record<string, number> = {};
    leadsFiltrados.forEach(lead => {
      if (lead.situacao === 'Arquivado') return;
      const normalizado = normalizarEspecialidade(lead.cargo);
      if (normalizado) contagem[normalizado] = (contagem[normalizado] || 0) + 1;
    });
    return Object.keys(contagem)
      .map(key => ({ name: key, total: contagem[key] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 7);
  }, [leadsFiltrados]);

  const limparFiltros = () => { setBuscaNome(""); setFiltroEspecialidade(""); setFiltroMes(""); };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Scrumboard Medguia</h1>
            <p className="text-sm text-slate-500 mt-1">
              Gerenciamento de Leads em Tempo Real 
            </p>
          </div>
          
          <div className="flex flex-col items-end gap-1.5">
            <Button 
              onClick={() => buscarLeads(false)} 
              disabled={loading || isSyncing} 
              variant="outline" 
              className="bg-white text-slate-700 min-w-[180px]"
            >
              <RefreshCcw className={`w-4 h-4 mr-2 ${loading || isSyncing ? 'animate-spin' : ''}`} />
              {loading ? 'Carregando...' : isSyncing ? 'Sincronizando...' : 'Sincronizar Dados'}
            </Button>
            
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium pr-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              Última atualização: {ultimaAtualizacao}
            </div>
          </div>
          
        </div>
      </header>

      {abaAtiva !== "dashboard" && (
        <FilterBar 
          buscaNome={buscaNome} setBuscaNome={setBuscaNome}
          filtroEspecialidade={filtroEspecialidade} setFiltroEspecialidade={setFiltroEspecialidade}
          filtroMes={filtroMes} setFiltroMes={setFiltroMes}
          especialidadesUnicas={especialidadesUnicas} mesesUnicos={mesesUnicos}
          limparFiltros={limparFiltros} temFiltroAtivo={buscaNome !== "" || filtroEspecialidade !== "" || filtroMes !== ""}
        />
      )}

      <div className="flex-1 overflow-hidden w-full flex flex-col">
        <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="flex-1 flex flex-col h-full">
          <div className="px-8 pt-6 pb-2">
            <div className="max-w-[1600px] mx-auto">
              <TabsList className="grid w-[600px] grid-cols-3">
                <TabsTrigger value="dashboard">Visão Geral</TabsTrigger>
                <TabsTrigger value="kanban">Quadro Kanban</TabsTrigger>
                <TabsTrigger value="arquivados">Arquivados</TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="dashboard" className="flex-1 overflow-y-auto p-8 pt-4 m-0">
            <DashboardTab 
              kpis={kpis} 
              date={date} setDate={setDate} 
              calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth} 
              dadosGrafico={dadosGrafico}
              setFiltroEspecialidade={setFiltroEspecialidade} 
              setAbaAtiva={setAbaAtiva} 
            />
          </TabsContent>

          <TabsContent value="kanban" className="flex-1 overflow-hidden p-8 pt-4 m-0 h-full">
            <div className="max-w-[1600px] mx-auto h-full w-full">
              {loading && leads.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500">
                  <RefreshCcw className="w-8 h-8 animate-spin text-indigo-500 mr-2" /> 
                  <p>Iniciando o sistema...</p>
                </div>
              ) : (
                <KanbanBoard leads={leadsFiltrados} onStatusChange={atualizarSituacaoLead} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="arquivados" className="flex-1 overflow-y-auto p-8 pt-4 m-0 h-full">
            <div className="max-w-[1600px] mx-auto h-full w-full">
              <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                <Archive className="w-5 h-5 text-slate-500" /> Leads Arquivados
              </h2>
              {loading && leads.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-slate-500"><RefreshCcw className="w-6 h-6 animate-spin" /></div>
              ) : arquivadosList.length === 0 ? (
                <div className="h-48 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-400">Nenhum lead arquivado no momento.</div>
              ) : (
                <DndContext>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {arquivadosList.map(lead => (
                      <LeadCard key={lead.id} lead={lead} disableDrag onStatusChange={atualizarSituacaoLead} />
                    ))}
                  </div>
                </DndContext>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}