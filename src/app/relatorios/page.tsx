"use client";

import { useEffect, useState, useMemo } from "react";
import { Lead } from "@/types/lead";
import { generateReportMetrics } from "@/utils/report-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Users, Percent, Target, Download, History } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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

  const [mesSelecionado, setMesSelecionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState<number>(() => new Date().getFullYear());

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

  let melhorCanalNome = '-';
  if (metrics && metrics.porFonte && metrics.porFonte.length > 0) {
    const copiaSegura = [...metrics.porFonte];
    copiaSegura.sort((a, b) => Number(b.taxa) - Number(a.taxa));
    melhorCanalNome = copiaSegura[0].nome;
  }

  const handleExportGamma = () => {
    const nomeMes = MESES.find(m => m.valor === mesSelecionado)?.nome ?? String(mesSelecionado);

    let md = `# Resultados de Tráfego Pago — ${nomeMes} ${anoSelecionado}\n\n`;
    md += `> Relatório gerado automaticamente pelo MedGuia Scrumboard\n\n`;

    md += `## Visão Geral\n\n`;
    md += `| Métrica | Valor |\n`;
    md += `|---|---|\n`;
    md += `| Total de Leads | ${metrics.geral.totalLeads} |\n`;
    md += `| Conversões (Ativos/Fechados) | ${metrics.geral.conversoes} |\n`;
    md += `| Recuperação de Base (Leads de meses anteriores) | ${metrics.geral.conversoesAnteriores} |\n`;
    md += `| Taxa Geral de Conversão | ${metrics.geral.taxaConversaoGeral}% |\n`;
    md += `| Melhor Canal | ${melhorCanalNome} |\n\n`;

    md += `## Comparativo: Volume vs Conversão por Fonte\n\n`;
    md += `| Fonte | Leads Gerados | Conversões | Taxa de Conversão |\n`;
    md += `|---|---|---|---|\n`;
    metrics.porFonte.forEach(f => {
      md += `| ${f.nome} | ${f.leads} | ${f.conversoes} | ${f.taxa}% |\n`;
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
    
    // Gerando as strings da lista de leads para injetar na tabela E no prompt
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
    
    // --- ADIÇÃO DO PROMPT PARA IA DE SLIDES ---
    md += `\n---\n\n`;
    md += `## 🤖 Prompt para IA de Apresentação\n`;
    md += `Copie todo o bloco abaixo (incluindo as aspas) e cole no Gamma.app, Tome.app ou ChatGPT:\n\n`;
    
    md += `> "Atue como um Analista de Marketing de Performance Sênior. Quero que você crie o roteiro e o conteúdo de uma apresentação executiva de resultados em formato de slides referente a ${nomeMes} de ${anoSelecionado}.\n>\n`;
    md += `> DADOS GERAIS DO MÊS:\n`;
    md += `> - Total de Leads: ${metrics.geral.totalLeads}\n`;
    md += `> - Conversões (Ativos/Fechados): ${metrics.geral.conversoes}\n`;
    md += `> - Recuperação de Base (Leads fechados de safras anteriores): ${metrics.geral.conversoesAnteriores}\n`;
    md += `> - Taxa Geral de Conversão: ${metrics.geral.taxaConversaoGeral}%\n`;
    md += `> - Melhor Canal: ${melhorCanalNome}\n>\n`;
    
    md += `> LISTA NOMINAL DOS LEADS DESTE MÊS:\n`;
    md += leadsParaPrompt;
    md += `>\n`;
    
    md += `> A apresentação deve ser altamente persuasiva, focada em dados e ter a seguinte estrutura (6 slides):\n>\n`;
    md += `> **Slide 1: Capa** (Título forte sobre os resultados de ${nomeMes} de ${anoSelecionado}).\n`;
    md += `> **Slide 2: Destaques do Mês** (Faça um resumo comemorando o total gerado, as conversões e enfatize fortemente a 'Recuperação de Base', explicando o valor comercial de trabalhar o recontato de leads antigos).\n`;
    md += `> **Slide 3: O Canal Campeão** (Foque no canal '${melhorCanalNome}' e explique por que ele foi o vencedor).\n`;
    md += `> **Slide 4: Raio-X dos Anúncios** (Destaque o comportamento de entrada por dias da semana e os melhores horários, se dedutíveis).\n`;
    md += `> **Slide 5: Casos de Sucesso Reais** (Analise a LISTA NOMINAL fornecida acima, escolha 2 ou 3 leads que estejam com status 'Fechado' ou 'Aguardando Ativação' e cite o nome deles e a origem como exemplos reais de sucesso do nosso funil neste mês. Se não houver fechados, cite novos leads promissores).\n`;
    md += `> **Slide 6: Insights e Próximos Passos** (Gere 3 recomendações lógicas e estratégicas sobre onde devemos alocar o esforço comercial no próximo mês baseado exclusivamente nestes dados).\n>\n`;
    md += `> Regras de tom de voz: Seja direto, corporativo, visualmente limpo e comemore as vitórias."\n`;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-medguia-${nomeMes.toLowerCase()}-${anoSelecionado}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
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
            <SelectTrigger className="w-[140px] bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
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
            <SelectTrigger className="w-[100px] bg-white border-slate-200 shadow-sm text-slate-800 focus:ring-2 focus:ring-indigo-500">
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

          {metrics.geral.totalLeads > 0 && (
            <Button
              onClick={handleExportGamma}
              variant="outline"
              className="flex items-center gap-2 border-slate-300 bg-white hover:bg-slate-50 text-slate-800 shadow-sm"
            >
              <Download className="w-4 h-4" />
              Exportar Dados
            </Button>
          )}
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.totalLeads}</div>
                <p className="text-xs text-muted-foreground">Leads qualificados no mês</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Conversões (Ativos)</CardTitle>
                <Target className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.conversoes}</div>
                <p className="text-xs text-muted-foreground">Logins/Ativações realizadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-emerald-600">Recuperação de Base</CardTitle>
                <History className="w-4 h-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600">{metrics.geral.conversoesAnteriores}</div>
                <p className="text-xs text-muted-foreground">Leads de meses anteriores</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
                <Percent className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics.geral.taxaConversaoGeral}%</div>
                <p className="text-xs text-muted-foreground">Média geral do período</p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
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