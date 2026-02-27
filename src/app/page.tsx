"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { LeadsTable } from "@/components/kanban/leads-table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RefreshCcw, Activity, LayoutGrid, Table as TableIcon } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { LeadCard } from "@/components/kanban/lead-card";

import { normalizarEspecialidade } from "@/utils/formatters";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";
import { Sidebar } from "@/components/layout/sidebar";

function parseDateSegura(d: string): Date | null {
  if (!d) return null;
  try {
    const matchBR = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (matchBR) {
      const iso = `${matchBR[3]}-${matchBR[2]}-${matchBR[1]}`;
      const dt = new Date(iso);
      return isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string>("--:--");

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [abaAtiva, setAbaAtiva] = useState("dashboard");
  const [viewMode, setViewMode] = useState<"kanban" | "tabela">("kanban");

  const [buscaNome, setBuscaNome] = useState("");
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [filtroMes, setFiltroMes] = useState("");

  const buscarLeads = async (isBackground = false) => {
    if (isBackground) setIsSyncing(true);
    else setLoading(true);

    try {
      const timestamp = new Date().getTime();
      const res = await fetch(`/api/sheets?t=${timestamp}`, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
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

  useEffect(() => {
    buscarLeads();
    const intervalo = setInterval(() => buscarLeads(true), 120000);
    return () => clearInterval(intervalo);
  }, []);

  const atualizarSituacaoLead = async (leadId: string, novaSituacao: string) => {
    const dataAtual = new Date().toLocaleString('pt-BR');
    setLeads(prevLeads => prevLeads.map(lead =>
      lead.id === leadId ? { ...lead, situacao: novaSituacao, data_alteracao: dataAtual } : lead
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

  const salvarObservacaoLead = async (leadId: string, observacoes: string) => {
    setLeads(prevLeads => prevLeads.map(lead =>
      lead.id === leadId ? { ...lead, observacoes } : lead
    ));
    try {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, observacoes })
      });
    } catch (error) {
      console.error("Erro de rede ao salvar observação:", error);
    }
  };

  const adicionarLeadManual = async (novoLeadData: any) => {
    const dataAtual = new Date().toLocaleString('pt-BR');
    const idTemporario = `sheet1_Página1-lead-${Date.now()}`;

    const chavesCompletas = {
      id: idTemporario,
      nome: novoLeadData.nome,
      email: novoLeadData.email,
      cargo: novoLeadData.cargo,
      whatsapp: novoLeadData.whatsapp || '',
      situacao: 'Novos Leads',
      created_time: dataAtual,
      data_alteracao: dataAtual,
      // Usa a origem selecionada no formulário (ex: 'Manual - LP', 'Manual - Indicação')
      origem: novoLeadData.origem || 'Manual',
    };

    setLeads(prev => [chavesCompletas, ...prev]);

    try {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', leadData: chavesCompletas })
      });
    } catch (error) {
      console.error("Erro ao criar lead:", error);
    }
  };

  const especialidadesUnicas = useMemo(() => {
    const specs = leads.map(l => normalizarEspecialidade(l.cargo)).filter(Boolean) as string[];
    return Array.from(new Set(specs)).sort();
  }, [leads]);

  const hoje = useMemo(() => new Date(), []);

  const mesesUnicos = useMemo(() => {
    const datas = leads.map(l => l.created_time).filter(Boolean);
    const meses = datas.map(d => {
      try {
        const dateObj = parseDateSegura(d);
        if (!dateObj) return null;
        if (dateObj > hoje) return null;
        const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return m.charAt(0).toUpperCase() + m.slice(1);
      } catch { return null; }
    }).filter(Boolean) as string[];
    return Array.from(new Set(meses)).sort((a, b) => {
      const da = parseDateSegura('01 ' + a);
      const db = parseDateSegura('01 ' + b);
      if (!da || !db) return 0;
      return db.getTime() - da.getTime();
    });
  }, [leads, hoje]);

  const leadsFiltrados = useMemo(() => {
    return leads.filter(lead => {
      const matchNome = lead.nome?.toLowerCase().includes(buscaNome.toLowerCase());
      const matchEspec = filtroEspecialidade
        ? normalizarEspecialidade(lead.cargo) === filtroEspecialidade
        : true;
      let matchMes = true;
      if (filtroMes) {
        if (lead.created_time) {
          try {
            const dateObj = parseDateSegura(lead.created_time);
            if (dateObj) {
              const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              matchMes = (m.charAt(0).toUpperCase() + m.slice(1)) === filtroMes;
            } else { matchMes = false; }
          } catch { matchMes = false; }
        } else { matchMes = false; }
      }
      return matchNome && matchEspec && matchMes;
    });
  }, [leads, buscaNome, filtroEspecialidade, filtroMes]);

  const kpis = useMemo(() => {
    const ativos = leadsFiltrados.filter(l => l.situacao !== 'Arquivado');
    const total = ativos.length;
    const novos = ativos.filter(l => l.situacao === 'Novos Leads' || l.situacao === 'Sem situação').length;
    const fechados = ativos.filter(l => l.situacao === 'Fechado').length;
    const emAndamento = ativos.filter(l =>
      ['Em contato', 'Recontato', 'Reunião agendada', 'Aguardando Ativação'].includes(l.situacao)
    ).length;
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

  const limparFiltros = () => {
    setBuscaNome("");
    setFiltroEspecialidade("");
    setFiltroMes("");
  };

  const getTituloPagina = () => {
    if (abaAtiva === 'dashboard') return 'Dashboard';
    if (abaAtiva === 'kanban') return 'Gestão de Leads';
    if (abaAtiva === 'arquivados') return 'Leads Arquivados';
    return '';
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden bg-[#e4e5e7]">
      <Sidebar abaAtiva={abaAtiva} setAbaAtiva={setAbaAtiva} />
      <main className="flex-1 flex flex-col h-screen overflow-hidden">

        <header className="bg-transparent px-8 py-5 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-3">
              {getTituloPagina()}
            </h1>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-500" /> Sincronizado via Google Sheets
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Button
              onClick={() => buscarLeads(false)}
              disabled={loading || isSyncing}
              variant="outline"
              className="bg-white border-slate-300 text-slate-700 min-w-[180px] shadow-sm hover:bg-slate-50"
            >
              <RefreshCcw className={`w-4 h-4 mr-2 ${loading || isSyncing ? 'animate-spin' : ''}`} />
              {loading ? 'Carregando...' : isSyncing ? 'Sincronizando...' : 'Sincronizar Dados'}
            </Button>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium pr-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              Última atualização: {ultimaAtualizacao}
            </div>
          </div>
        </header>

        {abaAtiva !== "dashboard" && (
          <FilterBar
            buscaNome={buscaNome} setBuscaNome={setBuscaNome}
            filtroEspecialidade={filtroEspecialidade} setFiltroEspecialidade={setFiltroEspecialidade}
            filtroMes={filtroMes} setFiltroMes={setFiltroMes}
            especialidadesUnicas={especialidadesUnicas} mesesUnicos={mesesUnicos}
            limparFiltros={limparFiltros}
            temFiltroAtivo={buscaNome !== "" || filtroEspecialidade !== "" || filtroMes !== ""}
            onAddLead={adicionarLeadManual}
          />
        )}

        <div className="flex-1 overflow-hidden relative">
          <Tabs value={abaAtiva} className="h-full flex flex-col">

            <TabsContent value="dashboard" className="flex-1 overflow-y-auto p-8 pt-2 m-0 h-full">
              <DashboardTab
                kpis={kpis}
                date={date} setDate={setDate}
                calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
                dadosGrafico={dadosGrafico}
                setFiltroEspecialidade={setFiltroEspecialidade}
                setAbaAtiva={setAbaAtiva}
              />
            </TabsContent>

            <TabsContent value="kanban" className="flex-1 flex flex-col overflow-hidden p-8 pt-2 m-0 h-full">
              {/* Toggle Kanban / Tabela */}
              <div className="flex justify-end items-center mb-4 shrink-0">
                <div className="flex items-center bg-slate-200/60 p-1 rounded-lg shadow-inner">
                  <button
                    onClick={() => setViewMode("kanban")}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${viewMode === "kanban" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    Quadro
                  </button>
                  <button
                    onClick={() => setViewMode("tabela")}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${viewMode === "tabela" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <TableIcon className="w-4 h-4" />
                    Lista
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {loading && leads.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    <RefreshCcw className="w-8 h-8 animate-spin text-indigo-500 mr-2" />
                    <p>Iniciando o sistema...</p>
                  </div>
                ) : viewMode === "kanban" ? (
                  <KanbanBoard
                    leads={leadsFiltrados}
                    onStatusChange={atualizarSituacaoLead}
                    onSaveObs={salvarObservacaoLead}
                  />
                ) : (
                  <LeadsTable
                    leads={leadsFiltrados}
                    onStatusChange={atualizarSituacaoLead}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="arquivados" className="flex-1 overflow-y-auto p-8 pt-2 m-0 h-full">
              {loading && leads.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-slate-500">
                  <RefreshCcw className="w-6 h-6 animate-spin" />
                </div>
              ) : arquivadosList.length === 0 ? (
                <div className="h-48 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400">
                  Nenhum lead arquivado no momento.
                </div>
              ) : (
                <DndContext>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {arquivadosList.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        disableDrag
                        onStatusChange={atualizarSituacaoLead}
                        onSaveObs={salvarObservacaoLead}
                      />
                    ))}
                  </div>
                </DndContext>
              )}
            </TabsContent>

          </Tabs>
        </div>

      </main>
    </div>
  );
}