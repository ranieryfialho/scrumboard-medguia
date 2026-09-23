"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Lead } from "@/types/lead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Trophy, Stethoscope, Handshake, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const MESES = [
  { valor: 1, nome: "Janeiro" }, { valor: 2, nome: "Fevereiro" }, { valor: 3, nome: "Março" },
  { valor: 4, nome: "Abril" },   { valor: 5, nome: "Maio" },      { valor: 6, nome: "Junho" },
  { valor: 7, nome: "Julho" },   { valor: 8, nome: "Agosto" },    { valor: 9, nome: "Setembro" },
  { valor: 10, nome: "Outubro" },{ valor: 11, nome: "Novembro" }, { valor: 12, nome: "Dezembro" }
];

const ANOS = [2024, 2025, 2026, 2027];
const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#8b5cf6', '#64748b'];
const ITENS_POR_PAGINA = 10;

const getInicial = (nome?: string) => {
  if (!nome) return "U";
  return nome.charAt(0).toUpperCase();
};

function SortIcon({ column, sortColumn, sortDirection }: { column: string; sortColumn: string | null; sortDirection: 'asc' | 'desc' }) {
  if (sortColumn !== column) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
  return sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
}

export default function RelatoriosComerciaisPage() {
  const [loading, setLoading] = useState(true);
  const [leadsRaw, setLeadsRaw] = useState<Lead[]>([]);
  
  const [mesSelecionado, setMesSelecionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState<number>(() => new Date().getFullYear());
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");

  const tipoFiltro = (dataInicio || dataFim) ? "periodo" : "mes";

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filtroKpi, setFiltroKpi] = useState<'todos' | 'concorrente' | 'plano'>('todos');
  const tabelaRef = useRef<HTMLDivElement>(null);

  const [currentPage, setCurrentPage] = useState(1);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  function selecionarFiltroKpi(filtro: typeof filtroKpi) {
    setFiltroKpi(filtro);
    setCurrentPage(1);
    setTimeout(() => tabelaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  useEffect(() => {
    setCurrentPage(1);
  }, [mesSelecionado, anoSelecionado, dataInicio, dataFim]);

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

  const dadosComerciais = useMemo(() => {
    function getMonthYear(dataStr?: string | null) {
      if (!dataStr) return null;
      const str = dataStr.trim();
      const matchBR = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (matchBR) return { month: parseInt(matchBR[2], 10), year: parseInt(matchBR[3], 10) };
      let safeStr = str;
      if (str.includes('-') && !str.includes('T')) safeStr = `${str}T12:00:00`;
      const dataObj = new Date(safeStr);
      if (!isNaN(dataObj.getTime())) return { month: dataObj.getMonth() + 1, year: dataObj.getFullYear() };
      return null;
    }

    function getComparableDate(dataStr?: string | null) {
      if (!dataStr) return null;
      const str = dataStr.trim();
      const matchBR = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (matchBR) {
        const d = matchBR[1].padStart(2, '0');
        const m = matchBR[2].padStart(2, '0');
        const y = matchBR[3];
        return `${y}-${m}-${d}`;
      }
      let safeStr = str;
      if (str.includes('-') && !str.includes('T')) safeStr = `${str}T12:00:00`;
      const dataObj = new Date(safeStr);
      if (!isNaN(dataObj.getTime())) {
        const d = String(dataObj.getDate()).padStart(2, '0');
        const m = String(dataObj.getMonth() + 1).padStart(2, '0');
        const y = dataObj.getFullYear();
        return `${y}-${m}-${d}`;
      }
      return null;
    }

    const fechados = leadsRaw.filter(l => {
      if (!['Logins Ativados', 'Fechamento de Clientes', 'Aguardando Ativação'].includes(l.situacao)) return false;
      
      const dataF = l.data_fechamento || l.created_time;
      if (!dataF) return false;
      
      if (tipoFiltro === "mes") {
        const dateObj = getMonthYear(dataF);
        return dateObj !== null && dateObj.month === mesSelecionado && dateObj.year === anoSelecionado;
      } else {
        const dateStr = getComparableDate(dataF);
        return dateStr !== null && (!dataInicio || dateStr >= dataInicio) && (!dataFim || dateStr <= dataFim);
      }
    });

    const agrupar = (campo: keyof Lead) => {
      const counts: Record<string, number> = {};
      fechados.forEach(l => {
        const val = l[campo] ? String(l[campo]).trim() : 'Não Informado';
        counts[val] = (counts[val] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };

    return {
      fechadosLista: fechados,
      totalVendas: fechados.length,
      plataformasAnteriores: agrupar('plataforma_anterior'),
      planosEscolhidos: agrupar('plano_escolhido'),
      canaisAquisição: agrupar('por_onde_conheceu')
    };
  }, [leadsRaw, tipoFiltro, mesSelecionado, anoSelecionado, dataInicio, dataFim]);

  const filteredLeads = useMemo(() => {
    switch (filtroKpi) {
      case 'concorrente':
        return dadosComerciais.fechadosLista.filter(
          (l) => l.plataforma_anterior === dadosComerciais.plataformasAnteriores[0]?.name
        );
      case 'plano':
        return dadosComerciais.fechadosLista.filter(
          (l) => l.plano_escolhido === dadosComerciais.planosEscolhidos[0]?.name
        );
      default:
        return dadosComerciais.fechadosLista;
    }
  }, [filtroKpi, dadosComerciais]);

  const sortedLeads = useMemo(() => {
    if (!sortColumn) return filteredLeads;
    return [...filteredLeads].sort((a, b) => {
      let valA = '';
      let valB = '';
      if (sortColumn === 'nome')                    { valA = (a.nome || '').toLowerCase();                    valB = (b.nome || '').toLowerCase(); }
      else if (sortColumn === 'o_que_mais_interessou') { valA = (a.o_que_mais_interessou || '').toLowerCase();  valB = (b.o_que_mais_interessou || '').toLowerCase(); }
      else if (sortColumn === 'o_que_deixou_a_desejar') { valA = (a.o_que_deixou_a_desejar || '').toLowerCase(); valB = (b.o_que_deixou_a_desejar || '').toLowerCase(); }
      else if (sortColumn === 'plano_escolhido')    { valA = (a.plano_escolhido || '').toLowerCase();         valB = (b.plano_escolhido || '').toLowerCase(); }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredLeads, sortColumn, sortDirection]);

  // Cálculos da Paginação
  const totalPages = Math.ceil(sortedLeads.length / ITENS_POR_PAGINA);
  const leadsPaginados = useMemo(() => {
    const startIndex = (currentPage - 1) * ITENS_POR_PAGINA;
    return sortedLeads.slice(startIndex, startIndex + ITENS_POR_PAGINA);
  }, [sortedLeads, currentPage]);

  if (loading) {
    return <div className="flex justify-center items-center h-[80vh]">Processando Inteligência de Vendas...</div>;
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Comercial & Vendas</h1>
          <p className="text-muted-foreground mt-2">
            Análise detalhada de fechamentos, perfis de clientes e dados da concorrência.
          </p>
        </div>

        {/* --- BLOCO DE FILTROS ALINHADO --- */}
        <div className="flex flex-col gap-3 w-full xl:w-[320px] shrink-0">
          
          {/* Linha 1: Mês e Ano */}
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
          </div>

          {/* Linha 2: Range de Datas (De / Até) */}
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

      {dadosComerciais.totalVendas === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <Trophy className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-lg font-medium">Nenhum fechamento registrado neste período.</p>
          <p className="text-sm">Arraste os cards para as colunas &quot;Logins Ativados&quot; ou &quot;Fechamento de Clientes&quot; no Kanban para gerar dados.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card
              onClick={() => selecionarFiltroKpi('todos')}
              className={`cursor-pointer transition-all hover:shadow-md bg-emerald-50/50 border-emerald-100 shadow-sm ${filtroKpi === 'todos' ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-emerald-800 text-sm">Vendas no Período</CardTitle>
                <Trophy className="w-5 h-5 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-emerald-600">{dadosComerciais.totalVendas}</div>
                <p className="text-xs text-emerald-600/70 font-medium mt-1">Clientes ativados na plataforma</p>
              </CardContent>
            </Card>
            <Card
              onClick={() => selecionarFiltroKpi('concorrente')}
              className={`cursor-pointer transition-all hover:shadow-md shadow-sm ${filtroKpi === 'concorrente' ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-slate-600 text-sm">Top Concorrente Vencido</CardTitle>
                <Handshake className="w-5 h-5 text-indigo-400" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-slate-800 truncate">
                  {dadosComerciais.plataformasAnteriores[0]?.name || 'N/A'}
                </div>
                <p className="text-xs text-slate-500 mt-1">De onde eles mais vieram</p>
              </CardContent>
            </Card>
            <Card
              onClick={() => selecionarFiltroKpi('plano')}
              className={`cursor-pointer transition-all hover:shadow-md shadow-sm ${filtroKpi === 'plano' ? 'ring-2 ring-sky-400' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-slate-600 text-sm">Plano Mais Vendido</CardTitle>
                <Stethoscope className="w-5 h-5 text-sky-400" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold text-slate-800 truncate">
                  {dadosComerciais.planosEscolhidos[0]?.name || 'N/A'}
                </div>
                <p className="text-xs text-slate-500 mt-1">Preferência dos clientes</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <CardTitle className="text-base text-slate-800">Market Share Roubado (Plataforma Anterior)</CardTitle>
                <CardDescription>De quais sistemas os médicos estão migrando para nós.</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dadosComerciais.plataformasAnteriores} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={2} dataKey="value">
                      {dadosComerciais.plataformasAnteriores.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value} clientes`, "Migrações"]} />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200">
              <CardHeader>
                <CardTitle className="text-base text-slate-800">Distribuição de Planos</CardTitle>
                <CardDescription>Quais pacotes foram mais escolhidos na assinatura.</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosComerciais.planosEscolhidos} layout="vertical" margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={120} tick={{fill: '#475569', fontSize: 12}} />
                    <Tooltip cursor={{fill: '#f8fafc'}} />
                    <Bar dataKey="value" name="Vendas" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card ref={tabelaRef} className="shadow-sm border-slate-200 overflow-hidden flex flex-col">
            <CardHeader className="bg-slate-50 border-b border-slate-100 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>
                    {filtroKpi === 'todos' && `Histórico de Negociações (${sortedLeads.length})`}
                    {filtroKpi === 'concorrente' && `Vindos de: ${dadosComerciais.plataformasAnteriores[0]?.name} (${sortedLeads.length})`}
                    {filtroKpi === 'plano' && `Plano: ${dadosComerciais.planosEscolhidos[0]?.name} (${sortedLeads.length})`}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {filtroKpi === 'todos' && `O que motivou o fechamento destes ${sortedLeads.length} leads.`}
                    {filtroKpi === 'concorrente' && `Clientes que migraram do concorrente mais vencido no período.`}
                    {filtroKpi === 'plano' && `Clientes que escolheram o plano mais vendido no período.`}
                  </CardDescription>
                </div>
                {filtroKpi !== 'todos' && (
                  <button
                    onClick={() => selecionarFiltroKpi('todos')}
                    className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-1 transition-colors shrink-0"
                  >
                    Ver todos
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white">
                    <TableRow>
                      <TableHead className="w-[300px] font-semibold text-slate-600 py-4">
                        <button onClick={() => handleSort('nome')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                          Cliente / Especialidade <SortIcon column="nome" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                      </TableHead>
                      <TableHead className="hidden md:table-cell font-semibold text-slate-600">
                        <button onClick={() => handleSort('o_que_mais_interessou')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                          O que MAIS atraiu? <SortIcon column="o_que_mais_interessou" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                      </TableHead>
                      <TableHead className="hidden lg:table-cell font-semibold text-slate-600">
                        <button onClick={() => handleSort('o_que_deixou_a_desejar')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                          Dor na concorrência <SortIcon column="o_que_deixou_a_desejar" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                      </TableHead>
                      <TableHead className="w-[150px] font-semibold text-slate-600">
                        <button onClick={() => handleSort('plano_escolhido')} className="flex items-center gap-1 hover:text-slate-900 transition-colors">
                          Plano Adquirido <SortIcon column="plano_escolhido" sortColumn={sortColumn} sortDirection={sortDirection} />
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100">
                    {leadsPaginados.map((lead, idx) => (
                      <TableRow key={idx} className="hover:bg-indigo-50/40 transition-colors group">
                        
                        <TableCell className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm shrink-0 border border-slate-200 group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                              {getInicial(lead.nome)}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-slate-800 truncate" title={lead.nome}>{lead.nome}</span>
                              <span className="text-[11px] font-medium text-slate-500 truncate mt-0.5" title={lead.cargo}>
                                {lead.cargo || 'Especialidade N/A'}
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden md:table-cell py-4">
                          {lead.o_que_mais_interessou ? (
                            <p className="text-sm text-slate-700 line-clamp-2 leading-relaxed" title={lead.o_que_mais_interessou}>
                              {lead.o_que_mais_interessou}
                            </p>
                          ) : (
                            <span className="inline-flex items-center text-[11px] font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200 border-dashed">
                              Não preenchido
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="hidden lg:table-cell py-4">
                          {lead.o_que_deixou_a_desejar ? (
                            <p className="text-sm text-slate-700 line-clamp-2 leading-relaxed" title={lead.o_que_deixou_a_desejar}>
                              {lead.o_que_deixou_a_desejar}
                            </p>
                          ) : (
                            <span className="inline-flex items-center text-[11px] font-medium text-slate-400 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200 border-dashed">
                              Não preenchido
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="py-4 px-4">
                          {lead.plano_escolhido && lead.plano_escolhido !== 'Não Informado' ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200">
                              {lead.plano_escolhido}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">
                              Não Informado
                            </span>
                          )}
                        </TableCell>

                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Controles de Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 md:px-6 py-4 border-t border-slate-100 bg-white gap-2">
                  <div className="text-xs md:text-sm text-slate-500">
                    <span className="hidden sm:inline">Mostrando </span>
                    <span className="font-medium">{(currentPage - 1) * ITENS_POR_PAGINA + 1}</span>–<span className="font-medium">{Math.min(currentPage * ITENS_POR_PAGINA, sortedLeads.length)}</span>
                    <span className="hidden sm:inline"> de </span><span className="sm:hidden"> / </span>
                    <span className="font-medium">{sortedLeads.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-8 border-slate-200"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline ml-1">Anterior</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="h-8 border-slate-200"
                    >
                      <span className="hidden sm:inline mr-1">Próxima</span>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}