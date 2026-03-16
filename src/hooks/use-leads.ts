"use client";

import { useState, useEffect, useMemo } from "react";
import { normalizarEspecialidade } from "@/utils/formatters";
import { createClient } from "@/lib/supabase/client";

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

export function useLeads() {
  const supabase = createClient();

  // Estados de Dados
  const [leads, setLeads] = useState<any[]>([]);
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string>("--:--");

  // Estados de Interface
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [abaAtiva, setAbaAtiva] = useState("dashboard");
  const [viewMode, setViewMode] = useState<"kanban" | "tabela">("kanban");

  // Filtros
  const [buscaNome, setBuscaNome] = useState("");
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [filtroMes, setFiltroMes] = useState("");

  // Busca de Leads (Google Sheets)
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
      }
    } catch (error) {
      console.error("Erro ao buscar leads:", error);
    } finally {
      setIsSyncing(false);
      setLoading(false);
    }
  };

  // Busca de Campanhas (Supabase)
  const buscarCampanhas = async () => {
    try {
      const { data, error } = await supabase
        .from('campanhas')
        .select('*')
        .order('criado_em', { ascending: false });

      if (error) throw error;
      setCampanhas(data || []);
    } catch (error) {
      console.error("Erro ao buscar campanhas:", error);
    }
  };

  // Excluir Campanha (Supabase)
  const excluirCampanha = async (id: string) => {
    try {
      const { error } = await supabase.from('campanhas').delete().eq('id', id);
      if (error) throw error;
      setCampanhas(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error("Erro ao excluir campanha:", error);
      alert("Erro ao excluir a campanha.");
    }
  };

  useEffect(() => {
    buscarLeads();
    buscarCampanhas();
    const intervalo = setInterval(() => buscarLeads(true), 120000);
    return () => clearInterval(intervalo);
  }, []);

  // Funções de Mutação
  const atualizarSituacaoLead = async (leadId: string, novaSituacao: string) => {
    const dataAtual = new Date().toLocaleString('pt-BR');
    const isFechado = ['Fechado', 'Aguardando Ativação'].includes(novaSituacao);

    setLeads(prevLeads => prevLeads.map(lead => {
      if (lead.id === leadId) {
        const updatedLead = { ...lead, situacao: novaSituacao, data_alteracao: dataAtual };
        // Injeta a data de fechamento no front-end para agilizar a UI
        if (isFechado) {
          updatedLead.data_fechamento = dataAtual;
        }
        return updatedLead;
      }
      return lead;
    }));

    await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, novaSituacao })
    });
  };

  const salvarObservacaoLead = async (leadId: string, observacoes: string) => {
    setLeads(prevLeads => prevLeads.map(lead =>
      lead.id === leadId ? { ...lead, observacoes } : lead
    ));
    await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId, observacoes })
    });
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
      origem: novoLeadData.origem || 'Manual',
    };
    setLeads(prev => [chavesCompletas, ...prev]);
    await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', leadData: chavesCompletas })
    });
  };

  // Memos e Filtros
  const especialidadesUnicas = useMemo(() => {
    const specs = leads.map(l => normalizarEspecialidade(l.cargo)).filter(Boolean) as string[];
    return Array.from(new Set(specs)).sort();
  }, [leads]);

  const hoje = useMemo(() => new Date(), []);

  const mesesUnicos = useMemo(() => {
    const setMeses = new Set<string>();

    leads.forEach(l => {
      // 1. Verifica Mês de Criação
      if (l.created_time) {
        const dateObj = parseDateSegura(l.created_time);
        if (dateObj && dateObj <= hoje) {
          const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          setMeses.add(m.charAt(0).toUpperCase() + m.slice(1));
        }
      }
      
      // 2. Verifica Mês de Fechamento (Fallback restrito apenas à criação)
      if (['Fechado', 'Aguardando Ativação'].includes(l.situacao)) {
        const dataParaUsar = l.data_fechamento || l.created_time;
        if (dataParaUsar) {
          const dateObj = parseDateSegura(dataParaUsar);
          if (dateObj && dateObj <= hoje) {
            const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            setMeses.add(m.charAt(0).toUpperCase() + m.slice(1));
          }
        }
      }
    });

    return Array.from(setMeses).sort((a, b) => {
      const da = parseDateSegura('01 ' + a);
      const db = parseDateSegura('01 ' + b);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    });
  }, [leads, hoje]);

  const leadsFiltrados = useMemo(() => {
    return leads.filter(lead => {
      const matchNome = lead.nome?.toLowerCase().includes(buscaNome.toLowerCase());
      const matchEspec = filtroEspecialidade ? normalizarEspecialidade(lead.cargo) === filtroEspecialidade : true;
      
      let matchMes = true;
      
      if (filtroMes) {
        let mCriacao = null;
        let mFechamento = null;

        // Pega o mês que o lead entrou
        if (lead.created_time) {
          const dateObj = parseDateSegura(lead.created_time);
          if (dateObj) {
            const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            mCriacao = m.charAt(0).toUpperCase() + m.slice(1);
          }
        }

        // Pega o mês em que ele foi dado como "Fechado" (Fallback restrito apenas à criação)
        if (['Fechado', 'Aguardando Ativação'].includes(lead.situacao)) {
          const dataParaUsar = lead.data_fechamento || lead.created_time;
          if (dataParaUsar) {
            const dateObj = parseDateSegura(dataParaUsar);
            if (dateObj) {
              const m = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              mFechamento = m.charAt(0).toUpperCase() + m.slice(1);
            }
          }
        }

        // O card aparece na tela se foi CRIADO neste mês OU se foi FECHADO neste mês
        matchMes = (mCriacao === filtroMes) || (mFechamento === filtroMes);
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
    return Object.keys(contagem).map(key => ({ name: key, total: contagem[key] })).sort((a, b) => b.total - a.total).slice(0, 7);
  }, [leadsFiltrados]);

  const limparFiltros = () => {
    setBuscaNome("");
    setFiltroEspecialidade("");
    setFiltroMes("");
  };

  return {
    leads, leadsFiltrados, arquivadosList, campanhas, kpis, dadosGrafico, especialidadesUnicas, mesesUnicos,
    loading, isSyncing, ultimaAtualizacao, date, setDate, calendarMonth, setCalendarMonth,
    abaAtiva, setAbaAtiva, viewMode, setViewMode, buscaNome, setBuscaNome,
    filtroEspecialidade, setFiltroEspecialidade, filtroMes, setFiltroMes,
    buscarLeads, buscarCampanhas, excluirCampanha, atualizarSituacaoLead, salvarObservacaoLead, adicionarLeadManual, limparFiltros
  };
}