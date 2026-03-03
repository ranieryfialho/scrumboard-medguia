"use client";

import { useEffect, useState, useMemo } from "react";
import { Lead } from "@/types/lead";
import { generateReportMetrics } from "@/utils/report-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Users, Percent, Target } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MESES = [
  { valor: 1, nome: "Janeiro" }, { valor: 2, nome: "Fevereiro" }, { valor: 3, nome: "Março" },
  { valor: 4, nome: "Abril" },   { valor: 5, nome: "Maio" },      { valor: 6, nome: "Junho" },
  { valor: 7, nome: "Julho" },   { valor: 8, nome: "Agosto" },    { valor: 9, nome: "Setembro" },
  { valor: 10, nome: "Outubro" },{ valor: 11, nome: "Novembro" }, { valor: 12, nome: "Dezembro" }
];

const ANOS = [2024, 2025, 2026, 2027];

export default function RelatoriosPage() {
  const [loading, setLoading] = useState(true);
  const [leadsRaw, setLeadsRaw] = useState<Lead[]>([]);
  
  const [mesSelecionado, setMesSelecionado] = useState<number>(2);
  const [anoSelecionado, setAnoSelecionado] = useState<number>(2026);

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
    return generateReportMetrics(leadsRaw, mesSelecionado, anoSelecionado);
  }, [leadsRaw, mesSelecionado, anoSelecionado]);

  if (loading) {
    return <div className="flex justify-center items-center h-[80vh]">Carregando Relatório de Tráfego...</div>;
  }

  // Lógica segura para descobrir o melhor canal SEM usar .sort() in-place no HTML:
  let melhorCanalNome = '-';
  if (metrics && metrics.porFonte && metrics.porFonte.length > 0) {
    const copiaSegura = [...metrics.porFonte]; // Copia o array congelado pelo React
    copiaSegura.sort((a, b) => Number(b.taxa) - Number(a.taxa));
    melhorCanalNome = copiaSegura[0].nome;
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* CABEÇALHO E FILTROS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resultados de Tráfego Pago</h1>
          <p className="text-muted-foreground mt-2">
            Análise detalhada do desempenho das campanhas, conversões e leads qualificados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select 
            value={mesSelecionado.toString()} 
            onValueChange={(v) => setMesSelecionado(Number(v))}
          >
            <SelectTrigger className="w-[140px]">
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
            onValueChange={(v) => setAnoSelecionado(Number(v))}
          >
            <SelectTrigger className="w-[100px]">
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
      </div>

      {metrics.geral.totalLeads === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
          <Target className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-lg font-medium">Nenhum lead encontrado neste período.</p>
          <p className="text-sm">Tente selecionar um mês ou ano diferente nos filtros acima.</p>
        </Card>
      ) : (
        <>
          {/* CARDS DE VISÃO GERAL */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.totalLeads}</div>
                <p className="text-xs text-muted-foreground">Leads qualificados gerados</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Conversões (Ativos/Fechados)</CardTitle>
                <Target className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.conversoes}</div>
                <p className="text-xs text-muted-foreground">Logins/Ativações realizadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Taxa Geral de Conversão</CardTitle>
                <Percent className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.taxaConversaoGeral}%</div>
                <p className="text-xs text-muted-foreground">Média de todos os canais</p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-primary">Melhor Canal</CardTitle>
                <Activity className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                {/* JSX Limpo e Seguro */}
                <div className="text-xl font-bold text-primary truncate" title={melhorCanalNome}>
                  {melhorCanalNome}
                </div>
                <p className="text-xs text-primary/80">Maior taxa de conversão</p>
              </CardContent>
            </Card>
          </div>

          {/* GRÁFICOS */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="col-span-4">
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
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="col-span-3">
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

          {/* TABELAS DE ANÚNCIOS */}
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
                  {metrics.porAnuncio.map((anuncio, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{anuncio.fonte}</TableCell>
                      <TableCell>{anuncio.nome}</TableCell>
                      <TableCell className="text-right">{anuncio.leads}</TableCell>
                      <TableCell className="text-right">{anuncio.conversoes}</TableCell>
                      <TableCell className="text-right font-bold">
                        {anuncio.taxa}%
                      </TableCell>
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
        </>
      )}
    </div>
  );
}