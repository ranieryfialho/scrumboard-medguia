"use client";

import { useEffect, useState, useMemo } from "react";
import { Lead } from "@/types/lead";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Trophy, Stethoscope, Handshake, ChevronLeft, ChevronRight } from "lucide-react";
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

// Função auxiliar para extrair a inicial do nome
const getInicial = (nome?: string) => {
  if (!nome) return "U";
  return nome.charAt(0).toUpperCase();
};

export default function RelatoriosComerciaisPage() {
  const [loading, setLoading] = useState(true);
  const [leadsRaw, setLeadsRaw] = useState<Lead[]>([]);
  const [mesSelecionado, setMesSelecionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState<number>(() => new Date().getFullYear());
  
  // Estado para a paginação
  const [currentPage, setCurrentPage] = useState(1);

  // Reseta a paginação para 1 sempre que mudar o mês ou o ano
  useEffect(() => {
    setCurrentPage(1);
  }, [mesSelecionado, anoSelecionado]);

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
    const fechados = leadsRaw.filter(l => {
      if (!['Fechado', 'Aguardando Ativação'].includes(l.situacao)) return false;
      
      const dataF = l.data_fechamento || l.created_time;
      if (!dataF) return false;
      
      let mes, ano;
      const matchBR = dataF.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (matchBR) {
        mes = parseInt(matchBR[2], 10);
        ano = parseInt(matchBR[3], 10);
      } else {
        const dObj = new Date(dataF.includes('-') && !dataF.includes('T') ? `${dataF}T12:00:00` : dataF);
        if(!isNaN(dObj.getTime())) {
          mes = dObj.getMonth() + 1;
          ano = dObj.getFullYear();
        }
      }
      return mes === mesSelecionado && ano === anoSelecionado;
    });

    const agrupar = (campo: string) => {
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
  }, [leadsRaw, mesSelecionado, anoSelecionado]);

  // Cálculos da Paginação
  const totalPages = Math.ceil(dadosComerciais.totalVendas / ITENS_POR_PAGINA);
  const leadsPaginados = useMemo(() => {
    const startIndex = (currentPage - 1) * ITENS_POR_PAGINA;
    return dadosComerciais.fechadosLista.slice(startIndex, startIndex + ITENS_POR_PAGINA);
  }, [dadosComerciais.fechadosLista, currentPage]);

  if (loading) {
    return <div className="flex justify-center items-center h-[80vh]">Processando Inteligência de Vendas...</div>;
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comercial & Vendas</h1>
          <p className="text-muted-foreground mt-2">
            Análise detalhada de fechamentos, perfis de clientes e dados da concorrência.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={mesSelecionado.toString()} onValueChange={(v) => setMesSelecionado(Number(v))}>
            <SelectTrigger className="w-[140px] bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              {MESES.map(mes => <SelectItem key={mes.valor} value={mes.valor.toString()}>{mes.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={anoSelecionado.toString()} onValueChange={(v) => setAnoSelecionado(Number(v))}>
            <SelectTrigger className="w-[100px] bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              {ANOS.map(ano => <SelectItem key={ano} value={ano.toString()}>{ano}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {dadosComerciais.totalVendas === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <Trophy className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-lg font-medium">Nenhum fechamento registrado neste período.</p>
          <p className="text-sm">Arraste os cards para a coluna "Fechado" no Kanban para gerar dados.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-emerald-50/50 border-emerald-100 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-emerald-800 text-sm">Vendas no Mês</CardTitle>
                <Trophy className="w-5 h-5 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-emerald-600">{dadosComerciais.totalVendas}</div>
                <p className="text-xs text-emerald-600/70 font-medium mt-1">Clientes ativados na plataforma</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
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
            <Card className="shadow-sm">
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

          <Card className="shadow-sm border-slate-200 overflow-hidden flex flex-col">
            <CardHeader className="bg-slate-50 border-b border-slate-100 shrink-0">
              <CardTitle>Histórico de Negociações (Atas de Reunião)</CardTitle>
              <CardDescription>O que motivou o fechamento destes {dadosComerciais.totalVendas} leads.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white">
                    <TableRow>
                      <TableHead className="w-[300px] font-semibold text-slate-600 py-4">Cliente / Especialidade</TableHead>
                      <TableHead className="font-semibold text-slate-600">O que MAIS atraiu?</TableHead>
                      <TableHead className="font-semibold text-slate-600">Dor na concorrência</TableHead>
                      <TableHead className="w-[150px] font-semibold text-slate-600">Plano Adquirido</TableHead>
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

                        <TableCell className="py-4">
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

                        <TableCell className="py-4">
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
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-white">
                  <div className="text-sm text-slate-500">
                    Mostrando <span className="font-medium">{(currentPage - 1) * ITENS_POR_PAGINA + 1}</span> a <span className="font-medium">{Math.min(currentPage * ITENS_POR_PAGINA, dadosComerciais.totalVendas)}</span> de <span className="font-medium">{dadosComerciais.totalVendas}</span> fechamentos
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-8 border-slate-200"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="h-8 border-slate-200"
                    >
                      Próxima
                      <ChevronRight className="w-4 h-4 ml-1" />
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