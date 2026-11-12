'use client';

// T-206 (fase4-analises, US-134): relatório "Marketing e Origem dos Leads" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/24._relatorios_marketing_e_tr_fego/`. Os dados vêm de
// `GET /api/relatorios/marketing` (leads criados no período, por origem). Investimento, CPL, CAC e
// ROAS (fase5-investimento-midia) só aparecem quando a gestão cadastrou investimento no período.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { dataBr, diaEMes, inteiro, moeda, nomeDoArquivoCsv, periodoAnteriorDe, periodoDe, periodoPronto, porcentagem, type PeriodoEscolhido, type Preset } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { FiltroPeriodo } from './filtro-periodo';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { GraficoLinhas } from './grafico-linhas';

type Agrupamento = 'dia' | 'semana' | 'mes';

export interface Dados {
  resumo: { leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null };
  custo?: { investimento: number; cpl: number | null; cac: number | null; roas: number | null } | null;
  agrupar: Agrupamento;
  serie: { inicio: string; leads: number; reunioes: number }[];
  porOrigem: { origem: string; leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null; valorGanho: number; investimento?: number | null; cpl?: number | null; cac?: number | null; roas?: number | null }[];
  origens: string[];
  especialidadesDisponiveis?: string[];
  especialidades?: { especialidade: string; leads: number; contratos: number; participacao: number; ticketMedio: number | null }[];
  porAnuncio?: { origem: string; anuncio: string; leads: number; contratos: number; conversaoFinal: number | null }[];
  desqualificados?: number;
  melhorCanal?: { origem: string; conversaoFinal: number | null } | null;
  porDiaDaSemana?: number[];
  recuperacaoDeBase?: number;
  leadsDoPeriodo?: { id: string; oportunidadeId: string | null; nome: string; etapa: string | null; etapaId: number | null; especialidade: string | null; origem: string; anuncio: string | null; criadoEm: string; observacoes: string | null }[];
  insights?: {
    diaDeMaisLeads: { dia: string; leads: number; agendadas: number } | null;
    melhorHora: number | null;
    velocidadeMediaMinutos: number | null;
    noShow: { taxa: number | null; noShows: number; agendadas: number };
  };
}

type Ordem = 'roas' | 'leads' | 'contratos';
type CampoDaLista = 'nome' | 'etapa' | 'origem' | 'anuncio' | 'criadoEm';
const LEADS_POR_PAGINA = 10;
const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const PRESETS: Preset[] = ['hoje', '7dias', '30dias', 'mes', 'trimestre'];
const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = { dia: 'Diário', semana: 'Semanal', mes: 'Mensal' };
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: 'roas', rotulo: 'Maior ROAS' },
  { id: 'leads', rotulo: 'Mais leads' },
  { id: 'contratos', rotulo: 'Mais contratos' },
];

const traco = (valor: number | null | undefined, formatar: (n: number) => string) => (valor === null || valor === undefined ? '—' : formatar(valor));
const vezes = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}x`;
const NOMES_DOS_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function rotuloDoIntervalo(inicio: string, agrupar: Agrupamento): string {
  if (agrupar === 'mes') return `${inicio.slice(5, 7)}/${inicio.slice(0, 4)}`;
  return agrupar === 'semana' ? `Sem ${diaEMes(inicio)}` : diaEMes(inicio);
}

/** "2026-11-04" → "04 nov". */
const diaPorExtenso = (iso: string) => `${iso.slice(8, 10)} ${NOMES_DOS_MESES[Number(iso.slice(5, 7)) - 1]}`;

/** Variação percentual de `atual` sobre `anterior`; `null` sem base de comparação. */
function variacao(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function Variacao({ valor, menorEMelhor = false, sufixo = 'vs período anterior' }: { valor: number | null; menorEMelhor?: boolean; sufixo?: string }) {
  if (valor === null) return <span className="font-body-sm text-body-sm text-text-muted">sem comparação</span>;
  const bom = menorEMelhor ? valor < 0 : valor > 0;
  return (
    <span className={`font-body-sm text-body-sm font-semibold inline-flex items-center gap-0.5 ${Math.abs(valor) < 0.05 ? 'text-text-muted' : bom ? 'text-success-text' : 'text-danger-text'}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{valor >= 0 ? 'arrow_upward' : 'arrow_downward'}</span>
      {valor > 0 ? '+' : ''}
      {valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% <span className="font-normal text-text-muted">{sufixo}</span>
    </span>
  );
}

function baixarCsv(nome: string, linhas: (string | number)[][]) {
  const texto = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Cartao({ titulo, valor, rodape, icone, destaque }: { titulo: string; valor: string; rodape: React.ReactNode; icone: string; destaque?: string }) {
  return (
    <article aria-label={titulo} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{titulo}</span>
        <span aria-hidden="true" className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${destaque ?? 'bg-info-surface text-primary'}`}>
          <span className="material-symbols-outlined text-[20px]">{icone}</span>
        </span>
      </div>
      <p className="font-metric-stat text-metric-stat text-text-primary">{valor}</p>
      <div className="flex flex-col gap-0.5 font-body-sm text-body-sm text-text-secondary">{rodape}</div>
    </article>
  );
}

export function RelatorioMarketing() {
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>(periodoPronto('30dias'));
  const [origem, setOrigem] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [agrupar, setAgrupar] = useState<Agrupamento | ''>('');
  const [ordem, setOrdem] = useState<Ordem>('roas');
  const [dados, setDados] = useState<Dados | null>(null);
  const [anterior, setAnterior] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [paginaDeLeads, setPaginaDeLeads] = useState(1);
  const [ordemDaLista, setOrdemDaLista] = useState<{ campo: CampoDaLista; asc: boolean }>({ campo: 'criadoEm', asc: false });

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDe(periodo);
    const q = new URLSearchParams({ de, ate });
    if (origem) q.set('origem', origem);
    if (especialidade) q.set('especialidade', especialidade);
    if (agrupar) q.set('agrupar', agrupar);
    // O período anterior só serve para a comparação (se falhar, os números ficam sem variação); é pedido ANTES do período
    // escolhido para a última chamada ao servidor ser sempre a do período que está na tela.
    void (async () => {
      try {
        const ant = periodoAnteriorDe(periodo);
        const qAnt = new URLSearchParams({ de: ant.de, ate: ant.ate });
        if (origem) qAnt.set('origem', origem);
        if (especialidade) qAnt.set('especialidade', especialidade);
        const r = await fetch(`/api/relatorios/marketing?${qAnt}`);
        setAnterior(r?.ok ? ((await r.json()) as Dados) : null);
      } catch {
        setAnterior(null);
      }
    })();
    try {
      const r = await fetch(`/api/relatorios/marketing?${q}`);
      if (!r.ok) throw new Error(`marketing respondeu ${r.status}`);
      setDados((await r.json()) as Dados);
      setErro(false);
      setAtualizadoEm(new Date());
    } catch {
      setErro(true);
    }
  }, [periodo, origem, especialidade, agrupar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totais = dados?.porOrigem.reduce(
    (t, l) => ({ leads: t.leads + l.leads, conectados: t.conectados + l.conectados, realizadas: t.realizadas + l.reunioesRealizadas, contratos: t.contratos + l.contratos, valor: t.valor + l.valorGanho }),
    { leads: 0, conectados: 0, realizadas: 0, contratos: 0, valor: 0 }
  );

  const canais = useMemo(() => {
    const linhas = [...(dados?.porOrigem ?? [])];
    if (ordem === 'leads') return linhas.sort((a, b) => b.leads - a.leads);
    if (ordem === 'contratos') return linhas.sort((a, b) => b.contratos - a.contratos || b.leads - a.leads);
    return linhas.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1) || b.contratos - a.contratos || b.leads - a.leads);
  }, [dados, ordem]);

  const anuncios = useMemo(
    () => (dados?.porAnuncio ?? []).filter((a) => a.anuncio !== 'Sem anúncio').sort((a, b) => b.contratos - a.contratos || b.leads - a.leads).slice(0, 5),
    [dados]
  );

  const leadsOrdenados = useMemo(() => {
    const lista = [...(dados?.leadsDoPeriodo ?? [])];
    const chave = (l: NonNullable<Dados['leadsDoPeriodo']>[number]): string => (ordemDaLista.campo === 'etapa' ? (l.etapa ?? '') : ordemDaLista.campo === 'anuncio' ? (l.anuncio ?? '') : String(l[ordemDaLista.campo]));
    lista.sort((a, b) => chave(a).localeCompare(chave(b), 'pt-BR', { numeric: true }) * (ordemDaLista.asc ? 1 : -1));
    return lista;
  }, [dados, ordemDaLista]);

  function ordenarLista(campo: CampoDaLista) {
    setOrdemDaLista((atual) => ({ campo, asc: atual.campo === campo ? !atual.asc : campo !== 'criadoEm' }));
    setPaginaDeLeads(1);
  }

  function exportarLeads() {
    baixarCsv(nomeDoArquivoCsv('leads-do-periodo', periodo), [
      ['Período', `${dataBr(de)} a ${dataBr(ate)}`],
      ['Nome', 'Status', 'Especialidade', 'Origem', 'Anúncio', 'Data de entrada', 'Observações'],
      ...leadsOrdenados.map((l) => [l.nome, l.etapa ?? '', l.especialidade ?? '', l.origem, l.anuncio ?? '', new Date(l.criadoEm).toLocaleString('pt-BR'), l.observacoes ?? '']),
    ]);
  }

  function exportar() {
    if (!dados || !totais) return;
    baixarCsv(nomeDoArquivoCsv('relatorio-marketing', periodo), [
      ['Período', `${dataBr(de)} a ${dataBr(ate)}`],
      ['Canal', 'Investimento (R$)', 'Leads', 'CPL (R$)', 'Reuniões realizadas', 'Fechados', 'Conversão final (%)', 'CAC (R$)', 'ROAS', 'Valor ganho (R$)'],
      ...canais.map((l) => [
        l.origem,
        l.investimento ?? '',
        l.leads,
        l.cpl?.toFixed(2).replace('.', ',') ?? '',
        l.reunioesRealizadas,
        l.contratos,
        l.conversaoFinal === null ? '' : (l.conversaoFinal * 100).toFixed(1).replace('.', ','),
        l.cac?.toFixed(2).replace('.', ',') ?? '',
        l.roas?.toFixed(2).replace('.', ',') ?? '',
        l.valorGanho.toFixed(2).replace('.', ','),
      ]),
      ['Totais', dados.custo?.investimento ?? '', totais.leads, dados.custo?.cpl?.toFixed(2).replace('.', ',') ?? '', totais.realizadas, totais.contratos, '', dados.custo?.cac?.toFixed(2).replace('.', ',') ?? '', dados.custo?.roas?.toFixed(2).replace('.', ',') ?? '', totais.valor.toFixed(2).replace('.', ',')],
    ]);
  }

  const { de, ate } = periodoDe(periodo);
  const maiorVolume = Math.max(1, ...canais.map((c) => c.leads));
  const maiorDia = Math.max(1, ...(dados?.porDiaDaSemana ?? [0]));
  const ticket = dados && dados.resumo.contratos > 0 && totais ? totais.valor / dados.resumo.contratos : null;
  const conectadosPct = dados && dados.resumo.leads > 0 ? dados.resumo.conectados / dados.resumo.leads : null;

  return (
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[30rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Relatórios de Marketing, Tráfego e Atribuição</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">
            De onde vêm os leads, quanto custa cada canal e quantos viram conexão, reunião e contrato: do lead ao contrato fechado.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <span className="font-body-sm text-body-sm text-text-muted">{atualizadoEm ? `Atualizado às ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          <button type="button" onClick={() => void carregar()} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">sync</span>
            Atualizar
          </button>
          <Link href="/configuracoes/investimento" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm inline-flex items-center gap-2 font-label-md text-label-md text-text-primary">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">paid</span>
            Cadastrar investimento
          </Link>
          <button type="button" onClick={exportar} disabled={!dados} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2 disabled:opacity-50">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
            Exportar Relatório (CSV)
          </button>
        </div>
      </div>

      <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-space-sm flex-wrap shrink-0">
        <FiltroPeriodo valor={periodo} presets={PRESETS} onMudar={setPeriodo} />
        <span className="font-body-sm text-body-sm text-text-muted flex items-center gap-1">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">calendar_today</span>
          {de.split('-').reverse().join('/')} a {ate.split('-').reverse().join('/')}
        </span>
        <select aria-label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
          <option value="">Todos os canais de aquisição</option>
          {(dados?.origens ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select aria-label="Especialidade" value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
          <option value="">Todas as especialidades</option>
          {(dados?.especialidadesDisponiveis ?? []).map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
          <option value="Sem especialidade informada">Sem especialidade informada</option>
        </select>
      </section>

      {erro && <EstadoErro mensagem="Não foi possível carregar o relatório. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}
      {dados && (
        <div className="relative flex flex-col gap-space-md flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md shrink-0">
            <Cartao
              titulo="Investimento total em tráfego"
              valor={dados.custo ? moeda(dados.custo.investimento) : '—'}
              icone="paid"
              rodape={
                dados.custo ? (
                  <Variacao valor={variacao(dados.custo.investimento, anterior?.custo?.investimento)} menorEMelhor sufixo="vs anterior" />
                ) : (
                  <Link href="/configuracoes/investimento" className="text-primary font-semibold hover:underline">
                    Cadastrar o investimento do período
                  </Link>
                )
              }
            />
            <Cartao
              titulo="Leads captados"
              valor={inteiro(dados.resumo.leads)}
              icone="person_add"
              destaque="bg-success-surface text-success-text"
              rodape={
                <>
                  <Variacao valor={variacao(dados.resumo.leads, anterior?.resumo.leads)} sufixo="vs anterior" />
                  <span>
                    CPL: {traco(dados.custo?.cpl, moeda)} · {inteiro(dados.resumo.conectados)} conectados ({porcentagem(conectadosPct)})
                  </span>
                </>
              }
            />
            <Cartao
              titulo="CAC médio geral"
              valor={traco(dados.custo?.cac, moeda)}
              icone="price_check"
              destaque="bg-warning-surface text-warning-text"
              rodape={
                <>
                  <Variacao valor={variacao(dados.custo?.cac, anterior?.custo?.cac)} menorEMelhor sufixo="vs anterior" />
                  <span>Investimento ÷ contratos fechados</span>
                </>
              }
            />
            <Cartao
              titulo="ROAS e receita nova"
              valor={traco(dados.custo?.roas, vezes)}
              icone="trending_up"
              destaque="bg-success-surface text-success-text"
              rodape={
                <>
                  <span>
                    {inteiro(dados.resumo.contratos)} {dados.resumo.contratos === 1 ? 'contrato fechado' : 'contratos fechados'} · Receita: {moeda(totais?.valor ?? 0)}
                  </span>
                  <span>Ticket médio: {traco(ticket, moeda)}</span>
                </>
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md shrink-0">
            <Cartao
              titulo="Taxa de conversão"
              valor={porcentagem(dados.resumo.conversaoFinal)}
              icone="percent"
              rodape={<span>{inteiro(dados.resumo.contratos)} contratos de {inteiro(dados.resumo.leads)} leads</span>}
            />
            <Cartao
              titulo="Desqualificados"
              valor={inteiro(dados.desqualificados ?? 0)}
              icone="person_off"
              destaque="bg-danger-surface text-danger-text"
              rodape={<span>{dados.resumo.leads > 0 ? porcentagem((dados.desqualificados ?? 0) / dados.resumo.leads) : '—'} do total de leads (cards em Perdido)</span>}
            />
            <Cartao
              titulo="Melhor canal"
              valor={dados.melhorCanal?.origem ?? '—'}
              icone="query_stats"
              destaque="bg-success-surface text-success-text"
              rodape={<span>{dados.melhorCanal ? `Maior taxa de conversão: ${porcentagem(dados.melhorCanal.conversaoFinal)}` : 'Sem leads no período'}</span>}
            />
            <Cartao
              titulo="Recuperação de base"
              valor={inteiro(dados.recuperacaoDeBase ?? 0)}
              icone="history"
              destaque="bg-warning-surface text-warning-text"
              rodape={<span>Leads de períodos anteriores que mudaram de etapa neste período</span>}
            />
          </div>

          <section aria-label="Aquisição de Leads e Conversão por Período" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm shrink-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Aquisição de Leads e Conversão por Período</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Leads captados e reuniões agendadas no topo do funil.</p>
              </div>
              <div role="group" aria-label="Agrupamento" className="flex items-center gap-1 rounded-lg bg-surface-subtle p-1">
                {(['dia', 'semana', 'mes'] as Agrupamento[]).map((a) => (
                  <button key={a} type="button" aria-pressed={dados.agrupar === a} onClick={() => setAgrupar(a)} className={`h-7 px-3 rounded font-label-md text-label-md ${dados.agrupar === a ? 'bg-surface-card text-primary font-semibold' : 'text-text-secondary'}`}>
                    {ROTULO_DO_AGRUPAMENTO[a]}
                  </button>
                ))}
              </div>
            </div>
            <GraficoLinhas
              titulo="Leads captados e reuniões agendadas por período"
              rotulos={dados.serie.map((s) => rotuloDoIntervalo(s.inicio, dados.agrupar))}
              series={[
                { nome: 'Leads captados', corTraco: 'stroke-primary', corLegenda: 'bg-primary', valores: dados.serie.map((s) => s.leads) },
                { nome: 'Reuniões agendadas', corTraco: 'stroke-success-text', corLegenda: 'bg-success-text', valores: dados.serie.map((s) => s.reunioes) },
              ]}
            />
            {dados.insights && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-sm">
                <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                  <span className="font-label-sm text-label-sm text-text-muted uppercase">Dia com mais leads</span>
                  <span className="font-label-lg text-label-lg text-text-primary">
                    {dados.insights.diaDeMaisLeads ? `${diaPorExtenso(dados.insights.diaDeMaisLeads.dia)} (${inteiro(dados.insights.diaDeMaisLeads.leads)} leads)` : '—'}
                  </span>
                  {dados.insights.diaDeMaisLeads && <span className="font-body-sm text-body-sm text-text-muted">{inteiro(dados.insights.diaDeMaisLeads.agendadas)} viraram reunião agendada</span>}
                </div>
                <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                  <span className="font-label-sm text-label-sm text-text-muted uppercase">Melhor horário de captação</span>
                  <span className="font-label-lg text-label-lg text-text-primary">{dados.insights.melhorHora === null ? '—' : `${dados.insights.melhorHora}h às ${(dados.insights.melhorHora + 1) % 24}h`}</span>
                  <span className="font-body-sm text-body-sm text-text-muted">hora com mais leads chegando</span>
                </div>
                <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                  <span className="font-label-sm text-label-sm text-text-muted uppercase">Velocidade média do 1º contato</span>
                  <span className="font-label-lg text-label-lg text-success-text">
                    {dados.insights.velocidadeMediaMinutos === null ? 'Sem contatos' : `${dados.insights.velocidadeMediaMinutos.toLocaleString('pt-BR')} minutos`}
                  </span>
                  <span className="font-body-sm text-body-sm text-text-muted">até a 1ª mensagem enviada (WhatsApp)</span>
                </div>
                <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                  <span className="font-label-sm text-label-sm text-text-muted uppercase">Taxa de no-show nas demonstrações</span>
                  <span className="font-label-lg text-label-lg text-text-primary">{porcentagem(dados.insights.noShow.taxa)}</span>
                  <span className="font-body-sm text-body-sm text-text-muted">
                    {inteiro(dados.insights.noShow.noShows)} de {inteiro(dados.insights.noShow.agendadas)} reuniões agendadas
                  </span>
                </div>
              </div>
            )}
          </section>

          <section aria-label="Desempenho por Origem" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Performance por Canal de Aquisição e Eficiência de Mídia</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Comparativo por origem do lead, com o retorno real sobre o gasto em mídia.</p>
              </div>
              <label className="flex items-center gap-2 font-label-md text-label-md text-text-secondary">
                Ordenado por
                <select aria-label="Ordenar canais" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="h-9 px-2 rounded-lg bg-surface-subtle">
                  {ORDENS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {canais.length === 0 ? (
              <EstadoVazio titulo="Nenhum lead neste período" proximoPasso="escolha outro período ou cadastre leads" icone="person_search" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Canal / origem</th>
                      <th className="px-space-md py-3">Investimento</th>
                      <th className="px-space-md py-3">Leads</th>
                      <th className="px-space-md py-3">CPL</th>
                      <th className="px-space-md py-3">Conectados</th>
                      <th className="px-space-md py-3">Reuniões realizadas</th>
                      <th className="px-space-md py-3">Fechados</th>
                      <th className="px-space-md py-3">Conv. final</th>
                      <th className="px-space-md py-3">CAC</th>
                      <th className="px-space-md py-3">ROAS</th>
                      <th className="px-space-md py-3">Valor ganho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canais.map((l) => (
                      <tr key={l.origem} className="border-t border-surface-container">
                        <td className="px-space-md py-3 font-label-lg text-label-lg text-text-primary">{l.origem}</td>
                        <td className="px-space-md py-3">{traco(l.investimento, moeda)}</td>
                        <td className="px-space-md py-3">{inteiro(l.leads)}</td>
                        <td className="px-space-md py-3">{traco(l.cpl, moeda)}</td>
                        <td className="px-space-md py-3">{inteiro(l.conectados)}</td>
                        <td className="px-space-md py-3">{inteiro(l.reunioesRealizadas)}</td>
                        <td className="px-space-md py-3">
                          <span className="px-2 py-0.5 rounded-full bg-info-surface text-primary font-label-md text-label-md">{inteiro(l.contratos)}</span>
                        </td>
                        <td className="px-space-md py-3">{porcentagem(l.conversaoFinal)}</td>
                        <td className="px-space-md py-3">{traco(l.cac, moeda)}</td>
                        <td className="px-space-md py-3 text-success-text font-semibold">{traco(l.roas, vezes)}</td>
                        <td className="px-space-md py-3">{moeda(l.valorGanho)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {totais && (
                    <tfoot>
                      <tr className="border-t border-surface-container bg-surface-subtle font-label-lg text-label-lg">
                        <td className="px-space-md py-3">Totais consolidados</td>
                        <td className="px-space-md py-3">{dados.custo ? moeda(dados.custo.investimento) : '—'}</td>
                        <td className="px-space-md py-3">{inteiro(totais.leads)}</td>
                        <td className="px-space-md py-3">{traco(dados.custo?.cpl, moeda)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.conectados)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.realizadas)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.contratos)}</td>
                        <td className="px-space-md py-3">{porcentagem(totais.leads > 0 ? totais.contratos / totais.leads : null)}</td>
                        <td className="px-space-md py-3">{traco(dados.custo?.cac, moeda)}</td>
                        <td className="px-space-md py-3">{traco(dados.custo?.roas, vezes)}</td>
                        <td className="px-space-md py-3">{moeda(totais.valor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md shrink-0">
            <section aria-label="Comparativo por Fonte" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Comparativo: Volume vs Conversão por Fonte</h2>
              {canais.length === 0 ? (
                <p className="font-body-md text-body-md text-text-secondary">Nenhum lead neste período.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {canais.map((c) => (
                    <li key={c.origem} className="flex flex-col gap-1">
                      <span className="font-label-md text-label-md text-text-primary">{c.origem}</span>
                      <div className="flex items-center gap-2" title={`${c.leads} leads`}>
                        <div className="h-3 rounded bg-text-primary" style={{ width: `${(c.leads / maiorVolume) * 100}%`, minWidth: c.leads > 0 ? 4 : 0 }} />
                        <span className="font-body-sm text-body-sm text-text-secondary">{inteiro(c.leads)} leads</span>
                      </div>
                      <div className="flex items-center gap-2" title={`${c.contratos} conversões`}>
                        <div className="h-3 rounded bg-primary" style={{ width: `${(c.contratos / maiorVolume) * 100}%`, minWidth: c.contratos > 0 ? 4 : 0 }} />
                        <span className="font-body-sm text-body-sm text-text-secondary">
                          {inteiro(c.contratos)} {c.contratos === 1 ? 'conversão' : 'conversões'} ({porcentagem(c.conversaoFinal)})
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex items-center gap-4 font-body-sm text-body-sm text-text-secondary">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-text-primary" /> Leads gerados</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-primary" /> Conversões</span>
              </div>
            </section>

            <section aria-label="Distribuição por Dia da Semana" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Distribuição por Dia da Semana</h2>
              <p className="font-body-sm text-body-sm text-text-muted">Em que dia da semana os leads do período chegaram.</p>
              <div className="relative flex-1 min-h-44">
                <div className="absolute inset-0 flex items-end gap-2">
                {DIAS_DA_SEMANA.map((nome, i) => {
                  const valor = dados.porDiaDaSemana?.[i] ?? 0;
                  return (
                    <div key={nome} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${nome}: ${valor} leads`}>
                      <span className="font-body-sm text-body-sm text-text-secondary">{inteiro(valor)}</span>
                      <div className="w-full rounded-t bg-slate-500" style={{ height: `${(valor / maiorDia) * 100}%`, minHeight: valor > 0 ? 4 : 0 }} />
                      <span className="font-body-sm text-[11px] text-text-muted">{nome.slice(0, 3)}</span>
                    </div>
                  );
                })}
                </div>
              </div>
            </section>
          </div>

          <section aria-label="Desempenho Detalhado por Anúncio" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
            <h2 className="p-space-md font-headline-sm text-headline-sm text-text-primary">Desempenho Detalhado por Anúncio</h2>
            {(dados.porAnuncio ?? []).length === 0 ? (
              <p className="px-space-md pb-space-md font-body-md text-body-md text-text-secondary">Nenhum lead neste período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Fonte (campanha)</th>
                      <th className="px-space-md py-3">Nome do anúncio</th>
                      <th className="px-space-md py-3 text-right">Leads gerados</th>
                      <th className="px-space-md py-3 text-right">Conversões</th>
                      <th className="px-space-md py-3 text-right">Taxa de conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dados.porAnuncio ?? []).map((a) => (
                      <tr key={`${a.origem}-${a.anuncio}`} className="border-t border-surface-container">
                        <td className="px-space-md py-3">{a.origem}</td>
                        <td className="px-space-md py-3 text-text-primary">{a.anuncio}</td>
                        <td className="px-space-md py-3 text-right">{inteiro(a.leads)}</td>
                        <td className="px-space-md py-3 text-right">{inteiro(a.contratos)}</td>
                        <td className="px-space-md py-3 text-right font-semibold">{porcentagem(a.conversaoFinal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Detalhamento de Leads no Período" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Detalhamento de Leads no Período ({inteiro(dados.resumo.leads)})</h2>
                <p className="font-body-sm text-body-sm text-text-muted">
                  Lista nominal dos leads gerados neste período, com status e origem.
                  {(dados.leadsDoPeriodo ?? []).length < dados.resumo.leads && ` Mostrando os ${inteiro((dados.leadsDoPeriodo ?? []).length)} mais recentes.`}
                </p>
              </div>
              <button type="button" onClick={exportarLeads} disabled={leadsOrdenados.length === 0} className="h-9 px-3 rounded-lg bg-surface-subtle inline-flex items-center gap-2 font-label-md text-label-md text-text-primary disabled:opacity-50">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
                Exportar leads (CSV)
              </button>
            </div>
            {leadsOrdenados.length === 0 ? (
              <p className="px-space-md pb-space-md font-body-md text-body-md text-text-secondary">Nenhum lead neste período.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-subtle">
                      <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                        {([['nome', 'Nome'], ['etapa', 'Status']] as [CampoDaLista, string][]).map(([c, r]) => (
                          <th key={c} className="px-space-md py-3">
                            <button type="button" onClick={() => ordenarLista(c)} className="uppercase tracking-wider">{r} {ordemDaLista.campo === c ? (ordemDaLista.asc ? '▲' : '▼') : '↕'}</button>
                          </th>
                        ))}
                        <th className="px-space-md py-3">Especialidade</th>
                        {([['origem', 'Origem'], ['anuncio', 'Anúncio'], ['criadoEm', 'Data de entrada']] as [CampoDaLista, string][]).map(([c, r]) => (
                          <th key={c} className="px-space-md py-3">
                            <button type="button" onClick={() => ordenarLista(c)} className="uppercase tracking-wider">{r} {ordemDaLista.campo === c ? (ordemDaLista.asc ? '▲' : '▼') : '↕'}</button>
                          </th>
                        ))}
                        <th className="px-space-md py-3">Observações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leadsOrdenados.slice((paginaDeLeads - 1) * LEADS_POR_PAGINA, paginaDeLeads * LEADS_POR_PAGINA).map((l) => (
                        <tr key={l.id} className="border-t border-surface-container">
                          <td className="px-space-md py-3 font-label-lg text-label-lg text-text-primary">
                            {l.oportunidadeId ? (
                              <Link href={`/pipeline/${l.oportunidadeId}`} className="hover:text-primary">
                                {l.nome}
                              </Link>
                            ) : (
                              l.nome
                            )}
                          </td>
                          <td className="px-space-md py-3">
                            <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm uppercase ${l.etapaId === 14 ? 'bg-danger-surface text-danger-text' : l.etapaId === 15 ? 'bg-success-surface text-success-text' : 'bg-warning-surface text-warning-text'}`}>{l.etapa ?? 'Sem card'}</span>
                          </td>
                          <td className="px-space-md py-3 text-text-secondary">{l.especialidade ?? '—'}</td>
                          <td className="px-space-md py-3">
                            <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm">{l.origem}</span>
                          </td>
                          <td className="px-space-md py-3 text-primary max-w-[14rem] truncate" title={l.anuncio ?? ''}>{l.anuncio ?? '—'}</td>
                          <td className="px-space-md py-3 text-text-secondary whitespace-nowrap">{new Date(l.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td className="px-space-md py-3 text-text-muted max-w-[12rem] truncate" title={l.observacoes ?? ''}>{l.observacoes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacao pagina={paginaDeLeads} porPagina={LEADS_POR_PAGINA} total={leadsOrdenados.length} onMudarPagina={setPaginaDeLeads} rotuloItem="leads" />
              </>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md shrink-0">
            <section aria-label="Segmentação por Especialidade" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Segmentação por Especialidade Médica</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Participação de cada especialidade nos leads do período e o ticket do que fechou.</p>
              </div>
              {(dados.especialidades ?? []).length === 0 ? (
                <p className="font-body-md text-body-md text-text-secondary">Nenhum lead neste período.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {(dados.especialidades ?? []).slice(0, 6).map((e) => (
                    <li key={e.especialidade} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2 font-label-md text-label-md text-text-primary">
                        <span className="truncate">{e.especialidade}</span>
                        <span className="shrink-0 font-normal text-text-secondary">
                          {inteiro(e.leads)} leads · {inteiro(e.contratos)} {e.contratos === 1 ? 'fechado' : 'fechados'} · ticket {traco(e.ticketMedio, moeda)} · {porcentagem(e.participacao)}
                        </span>
                      </div>
                      <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${e.participacao * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-label="Top Campanhas e Anúncios" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Top Campanhas e Anúncios com Maior Retorno</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Criativos com mais contratos no período.</p>
              </div>
              {anuncios.length === 0 ? (
                <p className="font-body-md text-body-md text-text-secondary">Nenhum lead com anúncio identificado neste período.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {anuncios.map((a) => (
                    <li key={`${a.origem}-${a.anuncio}`} className="rounded-xl bg-surface-subtle p-3 flex items-start justify-between gap-3">
                      <div className="flex flex-col min-w-0">
                        <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider">{a.origem}</span>
                        <span className="font-label-md text-label-md text-text-primary truncate">{a.anuncio}</span>
                        <span className="font-body-sm text-body-sm text-text-muted">
                          {inteiro(a.leads)} leads · conversão {porcentagem(a.conversaoFinal)}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm shrink-0">
                        {inteiro(a.contratos)} {a.contratos === 1 ? 'contrato' : 'contratos'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
