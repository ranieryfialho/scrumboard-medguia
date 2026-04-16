"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Lead } from "@/types/lead";
import { generateReportMetrics } from "@/utils/report-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Users, Percent, Target, Download, History, UserX, CalendarRange, ListTree, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const MESES = [
  { valor: 1, nome: "Janeiro" }, { valor: 2, nome: "Fevereiro" }, { valor: 3, nome: "Março" },
  { valor: 4, nome: "Abril" },   { valor: 5, nome: "Maio" },      { valor: 6, nome: "Junho" },
  { valor: 7, nome: "Julho" },   { valor: 8, nome: "Agosto" },    { valor: 9, nome: "Setembro" },
  { valor: 10, nome: "Outubro" },{ valor: 11, nome: "Novembro" }, { valor: 12, nome: "Dezembro" }
];

const ANOS = [2024, 2025, 2026, 2027];

function formatarDataLegivel(dataString?: string): string {
  if (!dataString) return "—";

  const matchBR = dataString.match(/^(\d{2}\/\d{2}\/\d{4})/);
  if (matchBR) {
    const horario = dataString.match(/(\d{2}:\d{2})/);
    return horario ? `${matchBR[1]} ${horario[1]}` : matchBR[1];
  }

  const d = new Date(dataString);
  if (!isNaN(d.getTime())) {
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(",", "");
  }

  return dataString;
}

function resolverNomeAnuncio(lead: Lead): string {
  const anuncio = (lead.anuncio || '').trim();
  const anuncioValido = anuncio !== '' && anuncio.toLowerCase() !== 'desconhecido';
  if (anuncioValido) return anuncio;

  const origem = (lead.origem || '').trim();
  if (origem.toLowerCase().startsWith('manual')) {
    const partes = origem.split('-');
    if (partes.length >= 2) {
      const subtipo = partes.slice(1).join('-').trim();
      const mapaSubtipos: Record<string, string> = {
        'lp': 'Landing Page',
        'indicação': 'Indicação',
        'indicacao': 'Indicação',
        'outro': 'Outro',
      };
      return mapaSubtipos[subtipo.toLowerCase()] ?? subtipo;
    }
    return 'Manual';
  }

  return 'Sem Anúncio Mapeado';
}

function SortIcon({ column, sortColumn, sortDirection }: { column: string; sortColumn: string | null; sortDirection: 'asc' | 'desc' }) {
  if (sortColumn !== column) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
  return sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

export default function RelatoriosPage() {
  const [loading, setLoading] = useState(true);
  const [leadsRaw, setLeadsRaw] = useState<Lead[]>([]);

  // Estados de Filtro
  const [mesSelecionado, setMesSelecionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState<number>(() => new Date().getFullYear());
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");

  // A lógica define o tipo de filtro automaticamente
  const tipoFiltro = (dataInicio || dataFim) ? "periodo" : "mes";

  // Estados de Ordenação e Filtro KPI da tabela de leads
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filtroKpi, setFiltroKpi] = useState<'todos' | 'conversoes' | 'recuperacao' | 'desqualificados' | 'melhorCanal'>('todos');
  const tabelaRef = useRef<HTMLDivElement>(null);

  function selecionarFiltroKpi(filtro: typeof filtroKpi) {
    setFiltroKpi(filtro);
    setTimeout(() => tabelaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  useEffect(() => {
    async function fetchLeads() {
      try {
        setLoading(true);
        const res = await fetch("/api/sheets");
        if (!res.ok) throw new Error("Erro ao buscar leads");
        const leads: Lead[] = await res.json();
        setLeadsRaw(leads);
      } catch (error) {
        console.error("Erro ao carregar relatórios:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchLeads();
  }, []);

  const metrics = useMemo(() => {
    return generateReportMetrics(
      leadsRaw, 
      tipoFiltro, 
      mesSelecionado, 
      anoSelecionado, 
      dataInicio, 
      dataFim
    );
  }, [leadsRaw, tipoFiltro, mesSelecionado, anoSelecionado, dataInicio, dataFim]);

  const melhorCanalNome = useMemo(() => {
    if (metrics.porFonte.length > 0) {
      return [...metrics.porFonte].sort((a, b) => Number(b.taxa) - Number(a.taxa))[0].nome;
    }
    return '-';
  }, [metrics.porFonte]);

  const filteredLeads = useMemo(() => {
    switch (filtroKpi) {
      case 'conversoes':   return metrics.listaConversoes;
      case 'recuperacao':  return metrics.listaRecuperacao;
      case 'desqualificados': return metrics.listaDesqualificados;
      case 'melhorCanal':  return metrics.listaLeads.filter((l: any) => l.origem === melhorCanalNome);
      default:             return metrics.listaLeads;
    }
  }, [filtroKpi, metrics, melhorCanalNome]);

  const sortedLeads = useMemo(() => {
    if (!sortColumn) return filteredLeads;

    return [...filteredLeads].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      if (sortColumn === 'nome') {
        valA = (a.nome || '').toLowerCase();
        valB = (b.nome || '').toLowerCase();
      } else if (sortColumn === 'situacao') {
        const ordem = ['Fechado', 'Aguardando Ativação', 'Reunião agendada', 'Em contato', 'Recontato', 'Novos Leads', 'Desqualificado'];
        valA = ordem.indexOf(a.situacao || '') === -1 ? 99 : ordem.indexOf(a.situacao || '');
        valB = ordem.indexOf(b.situacao || '') === -1 ? 99 : ordem.indexOf(b.situacao || '');
      } else if (sortColumn === 'cargo') {
        valA = (a.cargo || '').toLowerCase();
        valB = (b.cargo || '').toLowerCase();
      } else if (sortColumn === 'origem') {
        valA = (a.origem || '').toLowerCase();
        valB = (b.origem || '').toLowerCase();
      } else if (sortColumn === 'anuncio') {
        valA = resolverNomeAnuncio(a).toLowerCase();
        valB = resolverNomeAnuncio(b).toLowerCase();
      } else if (sortColumn === 'created_time') {
        const parseDate = (d?: string) => {
          if (!d) return 0;
          const matchBR = d.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/);
          if (matchBR) {
            return new Date(`${matchBR[3]}-${matchBR[2]}-${matchBR[1]}T${matchBR[4] || '00:00'}`).getTime();
          }
          return new Date(d).getTime() || 0;
        };
        valA = parseDate(a.created_time);
        valB = parseDate(b.created_time);
      } else if (sortColumn === 'observacoes') {
        valA = (a.observacoes || '').toLowerCase();
        valB = (b.observacoes || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredLeads, sortColumn, sortDirection]);


  if (loading) {
    return <div className="flex justify-center items-center h-[80vh]">Carregando Relatório de Tráfego...</div>;
  }

  const getNomePeriodo = () => {
    if (tipoFiltro === 'mes') {
      const nomeMes = MESES.find(m => m.valor === mesSelecionado)?.nome ?? String(mesSelecionado);
      return `${nomeMes} de ${anoSelecionado}`;
    }
    
    const inicioStr = dataInicio ? new Date(dataInicio + "T12:00:00").toLocaleDateString('pt-BR') : 'Início';
    const fimStr = dataFim ? new Date(dataFim + "T12:00:00").toLocaleDateString('pt-BR') : 'Hoje';
    return `Período: ${inicioStr} até ${fimStr}`;
  };

  const handleExportGamma = () => {
    const nomePeriodo = getNomePeriodo();

    let md = `# Resultados de Tráfego Pago — ${nomePeriodo}\n\n`;
    md += `> Relatório gerado automaticamente pelo MedGuia Scrumboard\n\n`;

    md += `## Visão Geral\n\n`;
    md += `| Métrica | Valor |\n`;
    md += `|---|---|\n`;
    md += `| Total de Leads | ${metrics.geral.totalLeads} |\n`;
    md += `| Conversões (Ativos/Fechados) | ${metrics.geral.conversoes} |\n`;
    md += `| Recuperação de Base (Leads anteriores) | ${metrics.geral.conversoesAnteriores} |\n`;
    md += `| Taxa Geral de Conversão | ${metrics.geral.taxaConversaoGeral}% |\n`;
    md += `| **Leads Desqualificados** | **${metrics.geral.desqualificados}** |\n`;
    md += `| Taxa de Desqualificação | ${metrics.geral.taxaDesqualificacao}% |\n`;
    md += `| Melhor Canal | ${melhorCanalNome} |\n\n`;

    if (metrics.geral.desqPorOrigem.length > 0) {
      md += `## Desqualificados por Origem\n\n`;
      md += `| Origem | Quantidade |\n`;
      md += `|---|---|\n`;
      metrics.geral.desqPorOrigem.forEach(d => {
        md += `| ${d.origem} | ${d.total} |\n`;
      });
      md += `\n`;
    }

    md += `## Comparativo: Volume vs Conversão por Fonte\n\n`;
    md += `| Fonte | Leads Gerados | Conversões | Desqualificados | Taxa de Conversão |\n`;
    md += `|---|---|---|---|---|\n`;
    metrics.porFonte.forEach(f => {
      md += `| ${f.nome} | ${f.leads} | ${f.conversoes} | ${f.desqualificados} | ${f.taxa}% |\n`;
    });
    md += `\n`;

    md += `## Distribuição por Dia da Semana\n\n`;
    md += `| Dia da Semana | Leads |\n`;
    md += `|---|---|\n`;
    metrics.porDia.forEach(d => {
      md += `| ${d.nome} | ${d.leads} |\n`;
    });
    md += `\n`;

    md += `## Desempenho Detalhado por Anúncio\n\n`;
    md += `| Fonte (Campanha) | Nome do Anúncio | Leads Gerados | Conversões | Taxa de Conversão |\n`;
    md += `|---|---|---|---|---|\n`;
    metrics.porAnuncio.forEach(a => {
      md += `| ${a.fonte} | ${a.nome} | ${a.leads} | ${a.conversoes} | ${a.taxa}% |\n`;
    });
    md += `\n`;

    md += `## Detalhamento Nominal de Leads do Período\n\n`;
    md += `| Nome do Lead | Situação no Funil | Data de Entrada | Origem / Fonte |\n`;
    md += `|---|---|---|---|\n`;

    let leadsParaPrompt = "";
    metrics.listaLeads.forEach(lead => {
      const nome = lead.nome || 'Desconhecido';
      const situacao = lead.situacao || '-';
      const dataCriacao = lead.created_time || '-';
      const origem = lead.origem || '-';
      md += `| ${nome} | ${situacao} | ${dataCriacao} | ${origem} |\n`;
      leadsParaPrompt += `> - Nome: ${nome} | Status: ${situacao} | Entrada: ${dataCriacao} | Origem: ${origem}\n`;
    });
    md += `\n`;

    md += `\n---\n\n`;
    md += `## 🤖 Prompt para IA de Apresentação\n`;
    md += `Copie todo o bloco abaixo (incluindo as aspas) e cole no Gamma.app, Tome.app ou ChatGPT:\n\n`;

    md += `> "Atue como um Analista de Marketing de Performance Sênior. Quero que você crie o roteiro e o conteúdo de uma apresentação executiva de resultados em formato de slides referente a ${nomePeriodo}.\n>\n`;
    md += `> DADOS GERAIS DO PERÍODO:\n`;
    md += `> - Total de Leads: ${metrics.geral.totalLeads}\n`;
    md += `> - Conversões (Ativos/Fechados): ${metrics.geral.conversoes}\n`;
    md += `> - Recuperação de Base (Leads fechados de safras anteriores): ${metrics.geral.conversoesAnteriores}\n`;
    md += `> - Taxa Geral de Conversão: ${metrics.geral.taxaConversaoGeral}%\n`;
    md += `> - Leads Desqualificados: ${metrics.geral.desqualificados} (${metrics.geral.taxaDesqualificacao}% do total)\n`;

    if (metrics.geral.desqPorOrigem.length > 0) {
      md += `> - Desqualificados por origem: ${metrics.geral.desqPorOrigem.map(d => `${d.origem} (${d.total})`).join(', ')}\n`;
    }

    md += `> - Melhor Canal: ${melhorCanalNome}\n>\n`;
    md += `> LISTA NOMINAL DOS LEADS DESTE PERÍODO:\n`;
    md += leadsParaPrompt;
    md += `>\n`;

    md += `> A apresentação deve ser altamente persuasiva, focada em dados e ter a seguinte estrutura (7 slides):\n>\n`;
    md += `> **Slide 1: Capa** (Título forte sobre os resultados de ${nomePeriodo}).\n`;
    md += `> **Slide 2: Destaques do Período** (Faça um resumo comemorando o total gerado, as conversões e enfatize fortemente a 'Recuperação de Base', explicando o valor comercial de trabalhar o recontato de leads antigos).\n`;
    md += `> **Slide 3: O Canal Campeão** (Foque no canal '${melhorCanalNome}' e explique por que ele foi o vencedor).\n`;
    md += `> **Slide 4: Raio-X dos Anúncios** (Destaque o comportamento de entrada por dias da semana e os melhores horários, se dedutíveis).\n`;
    md += `> **Slide 5: Análise de Qualidade dos Leads** (Analise os ${metrics.geral.desqualificados} leads desqualificados (${metrics.geral.taxaDesqualificacao}% do total). Identifique quais anúncios ou origens geraram mais desqualificados e explique o que isso pode indicar sobre a segmentação. Se a taxa for alta (>15%), alerte sobre necessidade de revisão de criativos/público. Se for baixa (<5%), comemore como sinal de boa qualidade).\n`;
    md += `> **Slide 6: Casos de Sucesso Reais** (Analise a LISTA NOMINAL fornecida acima, escolha 2 ou 3 leads com status 'Fechado' ou 'Aguardando Ativação' e cite o nome e origem como exemplos de sucesso. Se não houver fechados, cite novos leads promissores).\n`;
    md += `> **Slide 7: Insights e Próximos Passos** (Gere 3 recomendações estratégicas sobre onde devemos alocar o esforço comercial no próximo ciclo, levando em conta tanto as conversões quanto os desqualificados e seus respectivos anúncios de origem).\n>\n`;
    md += `> Regras de tom de voz: Seja direto, corporativo, visualmente limpo e comemore as vitórias."\n`;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    const docName = tipoFiltro === 'mes' 
      ? `${MESES.find(m => m.valor === mesSelecionado)?.nome.toLowerCase()}-${anoSelecionado}`
      : `${dataInicio}-ate-${dataFim}`;

    link.download = `relatorio-medguia-${docName}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resultados de Tráfego Pago</h1>
          <p className="text-muted-foreground mt-2">
            Análise detalhada do desempenho das campanhas, conversões e leads qualificados.
          </p>
        </div>

        {/* --- BLOCO DE FILTROS ALINHADO --- */}
        <div className="flex flex-col gap-3 w-full xl:w-[480px] shrink-0">
          
          <div className="flex gap-2 w-full">
            <Select
              value={mesSelecionado.toString()}
              onValueChange={(v) => {
                setDataInicio("");
                setDataFim("");
                setMesSelecionado(Number(v));
              }}
            >
              <SelectTrigger className="flex-1 h-10 bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                {MESES.map(mes => (
                  <SelectItem key={mes.valor} value={mes.valor.toString()}>
                    {mes.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={anoSelecionado.toString()}
              onValueChange={(v) => {
                setDataInicio("");
                setDataFim("");
                setAnoSelecionado(Number(v));
              }}
            >
              <SelectTrigger className="w-[100px] shrink-0 h-10 bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent>
                {ANOS.map(ano => (
                  <SelectItem key={ano} value={ano.toString()}>
                    {ano}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {metrics?.geral?.totalLeads > 0 && (
              <Button
                onClick={handleExportGamma}
                variant="outline"
                className="hidden sm:flex shrink-0 h-10 items-center gap-2 border-slate-300 bg-white hover:bg-slate-50 text-slate-800 shadow-sm"
              >
                <Download className="w-4 h-4" />
                Exportar Dados
              </Button>
            )}
          </div>

          {metrics?.geral?.totalLeads > 0 && (
            <Button
              onClick={handleExportGamma}
              variant="outline"
              className="sm:hidden w-full h-10 flex items-center justify-center gap-2 border-slate-300 bg-white hover:bg-slate-50 text-slate-800 shadow-sm"
            >
              <Download className="w-4 h-4" />
              Exportar Dados
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2 w-full">
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">De</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-full h-10 px-3 text-sm text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
              />
            </div>
            
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between pr-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Até</label>
                {(dataInicio || dataFim) && (
                  <button 
                    onClick={() => { setDataInicio(""); setDataFim(""); }}
                    className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-wider transition-colors"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-full h-10 px-3 text-sm text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
              />
            </div>
          </div>

        </div>
      </div>

      {(!metrics || metrics.geral.totalLeads === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <Target className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-lg font-medium">Nenhum lead encontrado neste período.</p>
          <p className="text-sm">Tente selecionar datas diferentes nos filtros acima.</p>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card
              onClick={() => selecionarFiltroKpi('todos')}
              className={`cursor-pointer transition-all hover:shadow-md ${filtroKpi === 'todos' ? 'ring-2 ring-slate-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.totalLeads}</div>
                <p className="text-xs text-muted-foreground">Leads gerados no período</p>
              </CardContent>
            </Card>

            <Card
              onClick={() => selecionarFiltroKpi('conversoes')}
              className={`cursor-pointer transition-all hover:shadow-md ${filtroKpi === 'conversoes' ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Conversões (Ativos)</CardTitle>
                <Target className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.conversoes}</div>
                <p className="text-xs text-muted-foreground">Logins/Ativações realizadas</p>
              </CardContent>
            </Card>

            <Card
              onClick={() => selecionarFiltroKpi('recuperacao')}
              className={`cursor-pointer transition-all hover:shadow-md ${filtroKpi === 'recuperacao' ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-emerald-600">Recuperação de Base</CardTitle>
                <History className="w-4 h-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600">{metrics.geral.conversoesAnteriores}</div>
                <p className="text-xs text-muted-foreground">Leads de períodos anteriores</p>
              </CardContent>
            </Card>

            <Card className="cursor-default">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
                <Percent className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.taxaConversaoGeral}%</div>
                <p className="text-xs text-muted-foreground">Média geral do período selecionado</p>
              </CardContent>
            </Card>

            <Card
              onClick={() => selecionarFiltroKpi('desqualificados')}
              className={`cursor-pointer transition-all hover:shadow-md ${metrics.geral.desqualificados > 0 ? "border-red-200 bg-red-50/40" : ""} ${filtroKpi === 'desqualificados' ? 'ring-2 ring-red-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className={`text-sm font-medium ${metrics.geral.desqualificados > 0 ? "text-red-700" : ""}`}>
                  Desqualificados
                </CardTitle>
                <UserX className={`w-4 h-4 ${metrics.geral.desqualificados > 0 ? "text-red-500" : "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${metrics.geral.desqualificados > 0 ? "text-red-700" : ""}`}>
                  {metrics.geral.desqualificados}
                </div>
                <p className="text-xs text-muted-foreground">
                  {metrics.geral.taxaDesqualificacao}% do total de leads
                </p>
                {metrics.geral.desqPorOrigem.length > 1 && (
                  <div className="mt-2 space-y-0.5">
                    {metrics.geral.desqPorOrigem.slice(0, 3).map((d: any) => (
                      <div key={d.origem} className="flex justify-between text-[11px] text-slate-500">
                        <span className="truncate max-w-[120px]">{d.origem}</span>
                        <span className="font-semibold text-red-600">{d.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card
              onClick={() => selecionarFiltroKpi('melhorCanal')}
              className={`cursor-pointer transition-all hover:shadow-md bg-primary/5 border-primary/20 ${filtroKpi === 'melhorCanal' ? 'ring-2 ring-primary' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-primary">Melhor Canal</CardTitle>
                <Activity className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-primary truncate" title={melhorCanalNome}>
                  {melhorCanalNome}
                </div>
                <p className="text-xs text-primary/80">Maior taxa de conversão</p>
              </CardContent>
            </Card>
          </div>

          {/* Gráficos e Tabelas */}
          <div className="grid gap-4 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Comparativo: Volume vs Conversão por Fonte</CardTitle>
              </CardHeader>
              <CardContent className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.porFonte} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="nome" />
                    <YAxis />
                    <Tooltip cursor={{fill: 'transparent'}} />
                    <Legend />
                    <Bar dataKey="leads" name="Leads Gerados" fill="#0f172a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="conversoes" name="Conversões" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="desqualificados" name="Desqualificados" fill="#f87171" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Distribuição por Dia da Semana</CardTitle>
              </CardHeader>
              <CardContent className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.porDia} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="nome" tick={{fontSize: 12}} />
                    <YAxis />
                    <Tooltip cursor={{fill: 'transparent'}} />
                    <Bar dataKey="leads" name="Leads" fill="#64748b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Desempenho Detalhado por Anúncio</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fonte (Campanha)</TableHead>
                    <TableHead>Nome do Anúncio</TableHead>
                    <TableHead className="text-right">Leads Gerados</TableHead>
                    <TableHead className="text-right">Conversões</TableHead>
                    <TableHead className="text-right">Taxa de Conversão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.porAnuncio.map((anuncio: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{anuncio.fonte}</TableCell>
                      <TableCell>{anuncio.nome}</TableCell>
                      <TableCell className="text-right">{anuncio.leads}</TableCell>
                      <TableCell className="text-right">{anuncio.conversoes}</TableCell>
                      <TableCell className="text-right font-bold">{anuncio.taxa}%</TableCell>
                    </TableRow>
                  ))}
                  {metrics.porAnuncio.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                        Nenhum dado de anúncio encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* NOVA TABELA: Detalhamento de TODOS os Leads do Período */}
          {metrics.listaLeads.length > 0 && (
            <Card ref={tabelaRef} className="border-slate-200 overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ListTree className="w-5 h-5 text-indigo-500 shrink-0" />
                    <CardTitle className="text-base text-slate-800">
                      {filtroKpi === 'todos' && `Detalhamento de Leads no Período (${sortedLeads.length})`}
                      {filtroKpi === 'conversoes' && `Conversões (Ativos) (${sortedLeads.length})`}
                      {filtroKpi === 'recuperacao' && `Recuperação de Base (${sortedLeads.length})`}
                      {filtroKpi === 'desqualificados' && `Leads Desqualificados (${sortedLeads.length})`}
                      {filtroKpi === 'melhorCanal' && `Melhor Canal: ${melhorCanalNome} (${sortedLeads.length})`}
                    </CardTitle>
                  </div>
                  {filtroKpi !== 'todos' && (
                    <button
                      onClick={() => selecionarFiltroKpi('todos')}
                      className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-1 transition-colors"
                    >
                      Ver todos
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {filtroKpi === 'todos' && 'Lista nominal de todos os leads gerados ou convertidos neste período, com seus respectivos status e origens.'}
                  {filtroKpi === 'conversoes' && 'Leads com status Fechado ou Aguardando Ativação cujo fechamento ocorreu no período.'}
                  {filtroKpi === 'recuperacao' && 'Leads convertidos neste período que foram gerados em períodos anteriores.'}
                  {filtroKpi === 'desqualificados' && 'Leads marcados como Desqualificado no período selecionado.'}
                  {filtroKpi === 'melhorCanal' && `Leads originados pelo canal com maior taxa de conversão: ${melhorCanalNome}.`}
                </p>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                  <table className="w-full text-sm relative">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                      <tr className="border-b border-slate-200 text-left">
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[15%]">
                          <button onClick={() => handleSort('nome')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Nome <SortIcon column="nome" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[12%]">
                          <button onClick={() => handleSort('situacao')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Status <SortIcon column="situacao" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="hidden md:table-cell px-5 py-3 font-semibold text-slate-600 w-[15%]">
                          <button onClick={() => handleSort('cargo')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Especialidade / Resposta <SortIcon column="cargo" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[13%]">
                          <button onClick={() => handleSort('origem')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Origem <SortIcon column="origem" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="hidden lg:table-cell px-5 py-3 font-semibold text-slate-600 w-[20%]">
                          <button onClick={() => handleSort('anuncio')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Anúncio <SortIcon column="anuncio" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[12%]">
                          <button onClick={() => handleSort('created_time')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Data de Entrada <SortIcon column="created_time" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                        <th className="hidden lg:table-cell px-5 py-3 font-semibold text-slate-600 w-[13%]">
                          <button onClick={() => handleSort('observacoes')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                            Observações <SortIcon column="observacoes" sortColumn={sortColumn} sortDirection={sortDirection} />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedLeads.map((lead: any, idx: number) => {
                        const anuncio = resolverNomeAnuncio(lead);
                        
                        // Lógica de Cores da Badge de Status
                        let statusBg = "bg-slate-100 text-slate-700 border-slate-200";
                        if (lead.situacao === "Fechado") statusBg = "bg-emerald-100 text-emerald-700 border-emerald-200";
                        else if (lead.situacao === "Aguardando Ativação") statusBg = "bg-cyan-100 text-cyan-700 border-cyan-200";
                        else if (lead.situacao === "Reunião agendada") statusBg = "bg-purple-100 text-purple-700 border-purple-200";
                        else if (lead.situacao === "Em contato") statusBg = "bg-amber-100 text-amber-700 border-amber-200";
                        else if (lead.situacao === "Recontato") statusBg = "bg-orange-100 text-orange-700 border-orange-200";
                        else if (lead.situacao === "Novos Leads") statusBg = "bg-blue-100 text-blue-700 border-blue-200";
                        else if (lead.situacao === "Desqualificado") statusBg = "bg-red-100 text-red-700 border-red-200";

                        return (
                          <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">
                              {lead.nome || '—'}
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${statusBg}`}>
                                {lead.situacao || '—'}
                              </span>
                            </td>
                            <td className="hidden md:table-cell px-5 py-3 max-w-0">
                              <span className="block truncate text-slate-500 text-xs" title={lead.cargo || ''}>
                                {lead.cargo || '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                {lead.origem || '—'}
                              </span>
                            </td>
                            <td className="hidden lg:table-cell px-5 py-3 max-w-0">
                              <span className="block truncate text-xs font-medium text-indigo-600" title={anuncio}>
                                {anuncio}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                              {formatarDataLegivel(lead.created_time)}
                            </td>
                            <td className="hidden lg:table-cell px-5 py-3 max-w-0">
                              <span className="block truncate text-slate-400 text-xs" title={lead.observacoes || ''}>
                                {lead.observacoes || '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}