"use client";

import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { LeadsTable } from "@/components/kanban/leads-table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RefreshCcw, Activity, LayoutGrid, Table as TableIcon, Menu } from "lucide-react";
import { DndContext } from "@dnd-kit/core";
import { LeadCard } from "@/components/kanban/lead-card";

import { FilterBar } from "@/components/dashboard/filter-bar";
import { DashboardTab } from "@/components/dashboard/dashboard-tab";
import { Sidebar } from "@/components/layout/sidebar";

import { AgendamentoModal } from "@/components/kanban/agendamento-modal";
import { FechamentoModal, FormFechamentoData } from "@/components/kanban/fechamento-modal";
import { LeadDetailModal } from "@/components/kanban/lead-detail-modal";
import { useState } from "react";

import RelatoriosPage from "@/app/relatorios/page";
import RelatoriosComerciaisPage from "@/app/relatorios-comerciais/page";

import { CampanhasTab } from "@/components/campanhas/campanhas-tab";
import { UsuariosTab } from "@/components/usuarios-tab";
import { WhatsappConfigTab } from "@/components/whatsapp/whatsapp-config-tab";

import { useLeads } from "@/hooks/use-leads";
import { WhatsappUnreadProvider } from "@/contexts/whatsapp-unread-context";
import { WhatsappNotificationPanel } from "@/components/whatsapp/whatsapp-notification-panel";
import { WhatsappInboxChat } from "@/components/whatsapp/whatsapp-inbox-chat";

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
    filtroSituacao,
    setFiltroSituacao,
    buscarLeads,
    buscarCampanhas,
    excluirCampanha,
    atualizarSituacaoLead,
    atualizarLeadLocal,
    salvarObservacaoLead,
    adicionarLeadManual,
    limparFiltros
  } = useLeads();

  const [leadPendente, setLeadPendente] = useState<{ id: string, situacao: string } | null>(null);
  const [modalAgendamentoOpen, setModalAgendamentoOpen] = useState(false);
  const [modalFechamentoOpen, setModalFechamentoOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [leadNotificacao, setLeadNotificacao] = useState<(typeof leads[0]) | null>(null);
  const [inboxNumero, setInboxNumero] = useState<string | null>(null);

  const handleNotificacaoClick = (lead: typeof leads[0]) => {
    setAbaAtiva("kanban");
    setLeadNotificacao(lead);
    setTimeout(() => {
      document.getElementById(`lead-card-${lead.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  };

  const handleCriarLeadWhatsapp = async (whatsapp: string, nome: string) => {
    const novoLead = await adicionarLeadManual({
      nome,
      email: '',
      cargo: '',
      whatsapp,
      origem: 'Manual - WhatsApp',
    });
    if (novoLead) {
      handleNotificacaoClick(novoLead as typeof leads[0]);
    }
  };

  const processarMudancaStatus = async (leadId: string, novaSituacao: string) => {
    const leadAtual = leads.find(l => l.id === leadId);
    if (!leadAtual || leadAtual.situacao === novaSituacao) return;

    if (novaSituacao === "Reunião agendada") {
      setLeadPendente({ id: leadId, situacao: novaSituacao });
      setModalAgendamentoOpen(true);
      return; 
    }

    if (novaSituacao === "Fechamento de Clientes") {
      setLeadPendente({ id: leadId, situacao: novaSituacao });
      setModalFechamentoOpen(true);
      return; 
    }

    await atualizarSituacaoLead(leadId, novaSituacao);
  };

  const handleConfirmarAgendamento = async (dataReuniao: string, horaReuniao: string) => {
    if (!leadPendente) return;
    const leadObj = leads.find(l => l.id === leadPendente.id);
    
    const novoEvento = {
      id: Math.random().toString(36).substring(2, 15),
      date: dataReuniao,
      title: `Reunião: ${leadObj?.nome || 'Lead'}`,
      time: horaReuniao,
      type: 'reuniao'
    };

    await fetch('/api/agenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', evento: novoEvento })
    });
    
    await atualizarSituacaoLead(leadPendente.id, leadPendente.situacao);
    setModalAgendamentoOpen(false);
    setLeadPendente(null);
  };

  const handleConfirmarFechamento = async (formFechamento: FormFechamentoData) => {
    if (!leadPendente) return;
    const leadObj = leads.find(l => l.id === leadPendente.id);

    const relatorioFechamento = `
🏆 **LEAD FECHADO**
- **Plataforma Anterior:** ${formFechamento.plataformaAnterior || 'N/A'}
- **O que mais interessou:** ${formFechamento.oQueMaisInteressou || 'N/A'}
- **Faltava na concorrente:** ${formFechamento.oQueDeixouADesejar || 'N/A'}
- **Canal de Aquisição:** ${formFechamento.porOndeConheceu || 'N/A'}
- **Plano Escolhido:** ${formFechamento.planoEscolhido || 'N/A'}
- **Notas:** ${formFechamento.observacoesGerais || 'N/A'}

--- Notas Anteriores ---
${leadObj?.observacoes || ''}
    `.trim();

    const dadosFechamento = {
      plataforma_anterior: formFechamento.plataformaAnterior,
      o_que_mais_interessou: formFechamento.oQueMaisInteressou,
      o_que_deixou_a_desejar: formFechamento.oQueDeixouADesejar,
      por_onde_conheceu: formFechamento.porOndeConheceu,
      plano_escolhido: formFechamento.planoEscolhido,
    };

    try {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: leadPendente.id,
          novaSituacao: leadPendente.situacao,
          observacoes: relatorioFechamento,
          dadosFechamento: dadosFechamento
        })
      });

      const dataAtual = new Date().toLocaleString('pt-BR');
      atualizarLeadLocal(leadPendente.id, {
        situacao: leadPendente.situacao,
        observacoes: relatorioFechamento,
        data_alteracao: dataAtual,
        data_fechamento: dataAtual,
      });

      setModalFechamentoOpen(false);
      setLeadPendente(null);

      buscarLeads(true);
    } catch (error) {
      console.error("Erro ao salvar fechamento:", error);
    }
  };

  const getTituloPagina = () => {
    const titulos: Record<string, string> = {
      dashboard: 'Dashboard',
      kanban: 'Gestão de Leads',
      arquivados: 'Leads Arquivados',
      relatorios: 'Marketing & Tráfego',
      'relatorios-comerciais': 'Comercial & Vendas',
      campanhas: 'Mala Direta',
      whatsapp: 'WhatsApp',
      usuarios: 'Gestão de Equipe e Acessos'
    };
    return titulos[abaAtiva] || '';
  };

  const animacaoPadrao = "animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out";

  return (
    <WhatsappUnreadProvider>
    <div className="flex h-screen bg-[#e4e5e7] overflow-hidden">
      <Sidebar
        abaAtiva={abaAtiva}
        setAbaAtiva={(aba) => { setAbaAtiva(aba); setMobileSidebarOpen(false); }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-transparent px-4 md:px-8 py-4 md:py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-200 transition-colors md:hidden"
            >
              <Menu className="w-5 h-5 text-slate-700" />
            </button>
            <div>
              <h1 className="text-lg md:text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-3">
                {getTituloPagina()}
              </h1>
              <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" /> Sincronizado via Google Sheets
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-2">
              <WhatsappNotificationPanel leads={leads} onSelectLead={handleNotificacaoClick} onOpenInbox={setInboxNumero} />
              <Button
                onClick={() => buscarLeads(false)}
                disabled={loading || isSyncing}
                variant="outline"
                className="bg-white border-slate-300 text-slate-700 md:min-w-[180px] shadow-sm hover:bg-slate-50 transition-all"
              >
              <RefreshCcw className={`w-4 h-4 md:mr-2 ${loading || isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">
                {loading ? 'Carregando...' : isSyncing ? 'Sincronizando...' : 'Sincronizar Dados'}
              </span>
            </Button>
            </div>
            <div className="hidden md:flex items-center gap-1.5 text-[10px] text-slate-500 font-medium pr-1">
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
            filtroSituacao={filtroSituacao} setFiltroSituacao={setFiltroSituacao}
            especialidadesUnicas={especialidadesUnicas} mesesUnicos={mesesUnicos}
            limparFiltros={limparFiltros}
            temFiltroAtivo={buscaNome !== "" || filtroEspecialidade !== "" || filtroMes !== "" || filtroSituacao.length > 0}
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
                setFiltroSituacao={setFiltroSituacao}
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
                    onStatusChange={processarMudancaStatus}
                    onSaveObs={salvarObservacaoLead}
                  />
                ) : (
                  <LeadsTable
                    leads={leadsFiltrados}
                    onStatusChange={processarMudancaStatus}
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
                        onStatusChange={processarMudancaStatus}
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

            <TabsContent value="whatsapp" className={`flex-1 overflow-y-auto m-0 h-full bg-slate-50 ${animacaoPadrao}`}>
              <WhatsappConfigTab />
            </TabsContent>

            <TabsContent value="usuarios" className={`flex-1 overflow-y-auto m-0 h-full bg-slate-50 ${animacaoPadrao}`}>
              <UsuariosTab />
            </TabsContent>

          </Tabs>
        </div>

      </main>

      <AgendamentoModal 
        isOpen={modalAgendamentoOpen} 
        onClose={() => { setModalAgendamentoOpen(false); setLeadPendente(null); }}
        onConfirm={handleConfirmarAgendamento}
      />

      <FechamentoModal
        isOpen={modalFechamentoOpen}
        onClose={() => { setModalFechamentoOpen(false); setLeadPendente(null); }}
        onConfirm={handleConfirmarFechamento}
        tipo={leadPendente?.situacao === "Fechamento de Clientes" ? "clientes" : "logins"}
      />

      {leadNotificacao && (
        <LeadDetailModal
          lead={leadNotificacao}
          open={true}
          onOpenChange={(open) => { if (!open) setLeadNotificacao(null); }}
          onStatusChange={processarMudancaStatus}
          onSaveObs={salvarObservacaoLead}
          initialTab="conversa"
        />
      )}

      {inboxNumero && (
        <WhatsappInboxChat
          numero={inboxNumero}
          open={true}
          onOpenChange={(o) => { if (!o) setInboxNumero(null); }}
          onCreateLead={handleCriarLeadWhatsapp}
        />
      )}
    </div>
    </WhatsappUnreadProvider>
  );
}
