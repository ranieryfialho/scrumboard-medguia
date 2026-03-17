"use client";

import { useEffect, useState, useMemo } from "react";
import { Lead } from "@/types/lead";
import { generateReportMetrics } from "@/utils/report-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Users, Percent, Target, Download, History, UserX } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const MESES = [
  { valor: 1, nome: "Janeiro" }, { valor: 2, nome: "Fevereiro" }, { valor: 3, nome: "Março" },
  { valor: 4, nome: "Abril" },   { valor: 5, nome: "Maio" },      { valor: 6, nome: "Junho" },
  { valor: 7, nome: "Julho" },   { valor: 8, nome: "Agosto" },    { valor: 9, nome: "Setembro" },
  { valor: 10, nome: "Outubro" },{ valor: 11, nome: "Novembro" }, { valor: 12, nome: "Dezembro" }
];

const ANOS = [2024, 2025, 2026, 2027];

// Formata qualquer string de data para DD/MM/AAAA HH:MM
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

// Resolve nome legível do anúncio (mesma lógica do report-metrics)
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

    // Seção de desqualificados com anúncio incluído
    if (metrics.listaDesqualificados.length > 0) {
      md += `## Leads Desqualificados no Período\n\n`;
      md += `| Nome do Lead | Especialidade | Origem | Anúncio | Data de Entrada |\n`;
      md += `|---|---|---|---|---|\n`;
      metrics.listaDesqualificados.forEach(lead => {
        const anuncio = resolverNomeAnuncio(lead);
        md += `| ${lead.nome || 'Desconhecido'} | ${lead.cargo || '-'} | ${lead.origem || '-'} | ${anuncio} | ${formatarDataLegivel(lead.created_time)} |\n`;
      });
      md += `\n`;
    }

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

    md += `> "Atue como um Analista de Marketing de Performance Sênior. Quero que você crie o roteiro e o conteúdo de uma apresentação executiva de resultados em formato de slides referente a ${nomeMes} de ${anoSelecionado}.\n>\n`;
    md += `> DADOS GERAIS DO MÊS:\n`;
    md += `> - Total de Leads: ${metrics.geral.totalLeads}\n`;
    md += `> - Conversões (Ativos/Fechados): ${metrics.geral.conversoes}\n`;
    md += `> - Recuperação de Base (Leads fechados de safras anteriores): ${metrics.geral.conversoesAnteriores}\n`;
    md += `> - Taxa Geral de Conversão: ${metrics.geral.taxaConversaoGeral}%\n`;
    md += `> - Leads Desqualificados: ${metrics.geral.desqualificados} (${metrics.geral.taxaDesqualificacao}% do total)\n`;

    if (metrics.geral.desqPorOrigem.length > 0) {
      md += `> - Desqualificados por origem: ${metrics.geral.desqPorOrigem.map(d => `${d.origem} (${d.total})`).join(', ')}\n`;
    }

    md += `> - Melhor Canal: ${melhorCanalNome}\n>\n`;
    md += `> LISTA NOMINAL DOS LEADS DESTE MÊS:\n`;
    md += leadsParaPrompt;
    md += `>\n`;

    md += `> A apresentação deve ser altamente persuasiva, focada em dados e ter a seguinte estrutura (7 slides):\n>\n`;
    md += `> **Slide 1: Capa** (Título forte sobre os resultados de ${nomeMes} de ${anoSelecionado}).\n`;
    md += `> **Slide 2: Destaques do Mês** (Faça um resumo comemorando o total gerado, as conversões e enfatize fortemente a 'Recuperação de Base', explicando o valor comercial de trabalhar o recontato de leads antigos).\n`;
    md += `> **Slide 3: O Canal Campeão** (Foque no canal '${melhorCanalNome}' e explique por que ele foi o vencedor).\n`;
    md += `> **Slide 4: Raio-X dos Anúncios** (Destaque o comportamento de entrada por dias da semana e os melhores horários, se dedutíveis).\n`;
    md += `> **Slide 5: Análise de Qualidade dos Leads** (Analise os ${metrics.geral.desqualificados} leads desqualificados (${metrics.geral.taxaDesqualificacao}% do total). Identifique quais anúncios ou origens geraram mais desqualificados e explique o que isso pode indicar sobre a segmentação. Se a taxa for alta (>15%), alerte sobre necessidade de revisão de criativos/público. Se for baixa (<5%), comemore como sinal de boa qualidade).\n`;
    md += `> **Slide 6: Casos de Sucesso Reais** (Analise a LISTA NOMINAL fornecida acima, escolha 2 ou 3 leads com status 'Fechado' ou 'Aguardando Ativação' e cite o nome e origem como exemplos de sucesso. Se não houver fechados, cite novos leads promissores).\n`;
    md += `> **Slide 7: Insights e Próximos Passos** (Gere 3 recomendações estratégicas sobre onde devemos alocar o esforço comercial no próximo mês, levando em conta tanto as conversões quanto os desqualificados e seus respectivos anúncios de origem).\n>\n`;
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
          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

            <Card className={metrics.geral.desqualificados > 0 ? "border-red-200 bg-red-50/40" : ""}>
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
                    {metrics.geral.desqPorOrigem.slice(0, 3).map(d => (
                      <div key={d.origem} className="flex justify-between text-[11px] text-slate-500">
                        <span className="truncate max-w-[120px]">{d.origem}</span>
                        <span className="font-semibold text-red-600">{d.total}</span>
                      </div>
                    ))}
                  </div>
                )}
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
                    <Bar dataKey="desqualificados" name="Desqualificados" fill="#f87171" radius={[4, 4, 0, 0]} />
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

          {/* Tabela nominal de desqualificados com coluna Anúncio */}
          {metrics.listaDesqualificados.length > 0 && (
            <Card className="border-red-100 overflow-hidden">
              <CardHeader className="border-b border-red-100 bg-red-50/50 pb-4">
                <div className="flex items-center gap-2">
                  <UserX className="w-5 h-5 text-red-500 shrink-0" />
                  <CardTitle className="text-base text-red-800">
                    Leads Desqualificados no Período ({metrics.listaDesqualificados.length})
                  </CardTitle>
                </div>
                <p className="text-xs text-red-500/80 mt-1 leading-relaxed">
                  Leads que não avançaram no funil. Revise a segmentação das campanhas e anúncios com maior incidência.
                </p>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-50/40 border-b border-red-100 text-left">
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[16%]">Nome</th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[20%]">Especialidade / Resposta</th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[13%]">Origem</th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[22%]">Anúncio</th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[15%]">Data de Entrada</th>
                        <th className="px-5 py-3 font-semibold text-slate-600 w-[14%]">Observações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-50">
                      {metrics.listaDesqualificados.map((lead, idx) => {
                        const anuncio = resolverNomeAnuncio(lead);
                        return (
                          <tr key={idx} className="hover:bg-red-50/20 transition-colors">
                            {/* Nome */}
                            <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">
                              {lead.nome || '—'}
                            </td>

                            {/* Especialidade */}
                            <td className="px-5 py-3 max-w-0">
                              <span
                                className="block truncate text-slate-500 text-xs"
                                title={lead.cargo || ''}
                              >
                                {lead.cargo || '—'}
                              </span>
                            </td>

                            {/* Origem */}
                            <td className="px-5 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                {lead.origem || '—'}
                              </span>
                            </td>

                            {/* Anúncio */}
                            <td className="px-5 py-3 max-w-0">
                              <span
                                className="block truncate text-xs font-medium text-indigo-600"
                                title={anuncio}
                              >
                                {anuncio}
                              </span>
                            </td>

                            {/* Data */}
                            <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                              {formatarDataLegivel(lead.created_time)}
                            </td>

                            {/* Observações */}
                            <td className="px-5 py-3 max-w-0">
                              <span
                                className="block truncate text-slate-400 text-xs"
                                title={lead.observacoes || ''}
                              >
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