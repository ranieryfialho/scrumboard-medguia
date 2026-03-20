"use client";

import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { LeadsTable } from "@/components/kanban/leads-table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RefreshCcw, Activity, LayoutGrid, Table as TableIcon } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { LeadCard } from "@/components/kanban/lead-card";

import { FilterBar } from "@/components/dashboard/filter-bar";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";
import { Sidebar } from "@/components/layout/sidebar";

import RelatoriosPage from "@/app/relatorios/page";
import RelatoriosComerciaisPage from "@/app/relatorios-comerciais/page";

import { CampanhasTab } from "@/components/campanhas/campanhas-tab";
import { UsuariosTab } from "@/components/usuarios-tab";

import { useLeads } from "@/hooks/use-leads";

export default function Home() {
  const {
    leads, 
    leadsFiltrados, 
    arquivadosList, 
    campanhas, 
    kpis, 
    dadosGrafico, 
    especialidadesUnicas, 
    mesesUnicos,
    loading, 
    isSyncing, 
    ultimaAtualizacao, 
    date, 
    setDate, 
    calendarMonth, 
    setCalendarMonth,
    abaAtiva, 
    setAbaAtiva, 
    viewMode, 
    setViewMode, 
    buscaNome, 
    setBuscaNome,
    filtroEspecialidade, 
    setFiltroEspecialidade, 
    filtroMes, 
    setFiltroMes,
    buscarLeads, 
    buscarCampanhas, 
    excluirCampanha, 
    atualizarSituacaoLead, 
    salvarObservacaoLead, 
    adicionarLeadManual, 
    limparFiltros
  } = useLeads();

  const getTituloPagina = () => {
    const titulos: Record<string, string> = {
      dashboard: 'Dashboard',
      kanban: 'Gestão de Leads',
      arquivados: 'Leads Arquivados',
      relatorios: 'Marketing & Tráfego',
      'relatorios-comerciais': 'Comercial & Vendas',
      campanhas: 'Mala Direta',
      usuarios: 'Gestão de Equipe e Acessos'
    };
    return titulos[abaAtiva] || '';
  };

  const animacaoPadrao = "animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out";

  return (
    <div className="flex h-screen bg-[#e4e5e7] overflow-hidden">
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
              className="bg-white border-slate-300 text-slate-700 min-w-[180px] shadow-sm hover:bg-slate-50 transition-all"
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

        {(abaAtiva === "kanban" || abaAtiva === "arquivados") && (
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

            <TabsContent value="dashboard" className={`flex-1 overflow-y-auto p-8 pt-2 m-0 h-full ${animacaoPadrao}`}>
              <DashboardTab
                kpis={kpis}
                date={date} setDate={setDate}
                calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth}
                dadosGrafico={dadosGrafico}
                setFiltroEspecialidade={setFiltroEspecialidade}
                setAbaAtiva={setAbaAtiva}
              />
            </TabsContent>

            <TabsContent value="kanban" className={`flex-1 flex flex-col overflow-hidden p-8 pt-2 m-0 h-full ${animacaoPadrao}`}>
              <div className="flex justify-end items-center mb-4 shrink-0">
                <div className="flex items-center bg-slate-200/60 p-1 rounded-lg shadow-inner">
                  <button
                    onClick={() => setViewMode("kanban")}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${viewMode === "kanban" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <LayoutGrid className="w-4 h-4" /> Quadro
                  </button>
                  <button
                    onClick={() => setViewMode("tabela")}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${viewMode === "tabela" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    <TableIcon className="w-4 h-4" /> Lista
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
                    onSaveObs={salvarObservacaoLead}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="arquivados" className={`flex-1 overflow-y-auto p-8 pt-2 m-0 h-full ${animacaoPadrao}`}>
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

            <TabsContent value="relatorios" className={`flex-1 overflow-y-auto m-0 h-full ${animacaoPadrao}`}>
              <RelatoriosPage />
            </TabsContent>

            <TabsContent value="relatorios-comerciais" className={`flex-1 overflow-y-auto m-0 h-full ${animacaoPadrao}`}>
              <RelatoriosComerciaisPage />
            </TabsContent>

            <TabsContent value="campanhas" className={`flex-1 overflow-y-auto m-0 h-full bg-slate-50 ${animacaoPadrao}`}>
              <CampanhasTab 
                leads={leads} 
                campanhas={campanhas} 
                onRefresh={buscarCampanhas} 
                onDelete={excluirCampanha} 
              />
            </TabsContent>

            <TabsContent value="usuarios" className={`flex-1 overflow-y-auto m-0 h-full bg-slate-50 ${animacaoPadrao}`}>
              <UsuariosTab />
            </TabsContent>

          </Tabs>
        </div>

      </main>
    </div>
  );
}