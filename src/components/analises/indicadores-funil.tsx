'use client';

// T-205 (fase4-analises, US-133): tela "Indicadores de Governança Comercial & Funil de
// Vendas" — fonte visual `docs/ui/stitch_medcrm_interface_design/23._indicadores_funil_comercial_e_governan_a/`.
// Os 7 indicadores vêm de `GET /api/relatorios/kpis`; o funil por etapa e o desempenho
// por responsável vêm de `GET /api/relatorios/funil` (mesma coorte). Metas, comparação
// com o período anterior, metas (`GET /api/metas`) e alertas (`GET /api/relatorios/alertas`) vêm de dados reais;
// o que o sistema não mede (índice de eficiência, latências, ticket por etapa...) não aparece (Q-058). Altura fixa: o cabeçalho
// fica parado e o conteúdo rola dentro da tela.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { iniciais, inteiro, moeda, periodoAnterior, porcentagem, type Preset, type Responsavel, periodoDoPreset } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { FiltroPeriodo } from './filtro-periodo';

export interface Indicador {
  valor: number | null;
  numerador: number;
  denominador: number;
}
export interface Kpis {
  conexao: Indicador;
  cumprimentoCadencia: Indicador;
  agendamento: Indicador;
  noShow: Indicador;
  proposta: Indicador;
  ativacaoTrial: Indicador;
  conversao: Indicador;
}
export interface Funil {
  entrada: number;
  conectados: number;
  agendadas: number;
  realizadas: number;
  propostas: number;
  ganhos: number;
}
export interface Desempenho {
  responsavelId: string | null;
  nome: string | null;
  papel: string | null;
  atendidos: number;
  cadenciaIniciada: number;
  cadenciaEsgotada: number;
  agendadas: number;
  noShows: number;
  propostas: number;
  contratos: number;
  winRate: number | null;
  receitaGanha: number;
}

const PRESETS: Preset[] = ['30dias', 'mes', 'trimestre'];

export const CARTOES: { chave: keyof Kpis; pilar: string; titulo: string; icone: string; inverso?: boolean }[] = [
  { chave: 'conexao', pilar: 'Pilar 01 · Contato', titulo: 'Taxa de Conexão', icone: 'call' },
  { chave: 'cumprimentoCadencia', pilar: 'Pilar 02 · Cadência', titulo: 'Régua de 18 Toques', icone: 'checklist' },
  { chave: 'agendamento', pilar: 'Pilar 03 · Demos', titulo: 'Agendamento', icone: 'event_available' },
  { chave: 'noShow', pilar: 'Pilar 04 · Faltas', titulo: 'Taxa de No-Show', icone: 'person_off', inverso: true },
  { chave: 'proposta', pilar: 'Pilar 05 · Propostas', titulo: 'Envio de Proposta', icone: 'description' },
  { chave: 'ativacaoTrial', pilar: 'Pilar 06 · Trial', titulo: 'Ativação em Trial', icone: 'rocket_launch' },
  { chave: 'conversao', pilar: 'Pilar 07 · Win rate', titulo: 'Conversão Final', icone: 'emoji_events' },
];

export const ETAPAS_DO_FUNIL: { chave: keyof Funil; nome: string }[] = [
  { chave: 'entrada', nome: 'Entrada de Leads' },
  { chave: 'conectados', nome: 'Conexão Efetiva' },
  { chave: 'agendadas', nome: 'Demo Agendada' },
  { chave: 'realizadas', nome: 'Demo Realizada' },
  { chave: 'propostas', nome: 'Proposta Enviada' },
  { chave: 'ganhos', nome: 'Contrato Assinado' },
];

export const razao = (parte: number, total: number): number | null => (total > 0 ? parte / total : null);

export interface Alertas {
  propostasParadas: { total: number; valor: number };
  noShowsPendentes: { total: number; valor: number };
}
export type MetasView = Partial<Record<'taxa_conversao' | 'taxa_presenca' | 'receita_mensal', number>>;

const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Baixa um CSV simples (separador `;`, vírgula decimal) no navegador. */
function baixarCsv(nome: string, linhas: (string | number)[][]) {
  const texto = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

function Delta({ atual, anterior, inverso }: { atual: number | null; anterior: number | null | undefined; inverso?: boolean }) {
  if (atual === null || anterior === null || anterior === undefined) return <span className="font-body-sm text-body-sm text-text-muted">sem comparação</span>;
  const pp = (atual - anterior) * 100;
  if (Math.abs(pp) < 0.05) return <span className="font-body-sm text-body-sm text-text-muted">= período ant.</span>;
  const bom = inverso ? pp < 0 : pp > 0;
  return (
    <span className={`font-body-sm text-body-sm font-semibold flex items-center gap-0.5 ${bom ? 'text-success-text' : 'text-danger-text'}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{pp > 0 ? 'arrow_upward' : 'arrow_downward'}</span>
      {pp > 0 ? '+' : ''}
      {pp.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p. vs ant.
    </span>
  );
}

export function IndicadoresFunil() {
  const [preset, setPreset] = useState<Preset>('mes');
  const [responsavelId, setResponsavelId] = useState('');
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [anteriores, setAnteriores] = useState<Kpis | null>(null);
  const [metas, setMetas] = useState<MetasView>({});
  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [funil, setFunil] = useState<{ funil: Funil; porResponsavel: Desempenho[] } | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDoPreset(preset);
    const ant = periodoAnterior(preset);
    const q = new URLSearchParams({ de, ate });
    if (responsavelId) q.set('responsavelId', responsavelId);
    const qAnt = new URLSearchParams({ de: ant.de, ate: ant.ate });
    if (responsavelId) qAnt.set('responsavelId', responsavelId);
    // O período anterior, as metas e os alertas são complemento (se falharem, a tela segue sem eles); o período anterior é pedido
    // ANTES do escolhido para a última chamada ao servidor ser sempre a do período que está na tela.
    const opcional = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url);
        return r?.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    void opcional<Kpis>(`/api/relatorios/kpis?${qAnt}`).then((k) => setAnteriores(k && 'conexao' in k ? k : null));
    void opcional<{ metas?: MetasView }>('/api/metas').then((m) => setMetas(m?.metas ?? {}));
    void opcional<Alertas>(`/api/relatorios/alertas${responsavelId ? `?responsavelId=${responsavelId}` : ''}`).then((al) => setAlertas(al && 'propostasParadas' in al ? al : null));
    try {
      const [rk, rf] = await Promise.all([fetch(`/api/relatorios/kpis?${q}`), fetch(`/api/relatorios/funil?${q}`)]);
      if (!rk.ok || !rf.ok) throw new Error('relatórios indisponíveis');
      setKpis((await rk.json()) as Kpis);
      setFunil((await rf.json()) as { funil: Funil; porResponsavel: Desempenho[] });
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [preset, responsavelId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/pipeline/responsaveis')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { responsaveis: Responsavel[] } | null) => !cancelado && setResponsaveis(c?.responsaveis ?? []))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  const receitaTotal = funil ? funil.porResponsavel.reduce((soma, d) => soma + d.receitaGanha, 0) : 0;
  const ordenados = funil ? [...funil.porResponsavel].sort((a, b) => b.receitaGanha - a.receitaGanha) : [];
  const metasAtingidas = (() => {
    if (!kpis) return { total: 0, atingidas: 0 };
    const itens: boolean[] = [];
    if (metas.taxa_conversao !== undefined && kpis.conversao.valor !== null) itens.push(kpis.conversao.valor * 100 >= metas.taxa_conversao);
    if (metas.taxa_presenca !== undefined && kpis.noShow.valor !== null) itens.push((1 - kpis.noShow.valor) * 100 >= metas.taxa_presenca);
    return { total: itens.length, atingidas: itens.filter(Boolean).length };
  })();
  // A meta de receita é mensal: no trimestre vale três meses; em períodos que não são meses a comparação não se aplica.
  const mesesDaMeta = preset === 'mes' ? 1 : preset === 'trimestre' ? 3 : null;
  const metaDeReceita = metas.receita_mensal !== undefined && mesesDaMeta !== null ? metas.receita_mensal * mesesDaMeta : null;
  const andamentoDaReceita = metaDeReceita ? Math.min(receitaTotal / metaDeReceita, 1) : null;
  const rotuloDoPeriodo = preset === 'mes' ? 'do mês' : preset === 'trimestre' ? 'do trimestre' : 'do período';

  function exportar() {
    if (!funil) return;
    baixarCsv('desempenho-por-responsavel.csv', [
      ['Responsável', 'Papel', 'Cards atendidos', 'Régua 18 toques (%)', 'Demos agendadas', 'No-show (%)', 'Propostas', 'Contratos', 'Win rate (%)', 'Receita ganha (R$)'],
      ...ordenados.map((d) => [
        d.nome ?? 'Sem responsável',
        d.papel ?? '',
        d.atendidos,
        ((razao(d.cadenciaEsgotada, d.cadenciaIniciada) ?? 0) * 100).toFixed(1).replace('.', ','),
        d.agendadas,
        ((razao(d.noShows, d.agendadas) ?? 0) * 100).toFixed(1).replace('.', ','),
        d.propostas,
        d.contratos,
        ((d.winRate ?? 0) * 100).toFixed(1).replace('.', ','),
        d.receitaGanha.toFixed(2).replace('.', ','),
      ]),
    ]);
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[30rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Indicadores de Governança Comercial &amp; Funil de Vendas</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">
            Os 7 pilares da conversão: conexão, régua de 18 toques, agendamento, no-show, proposta, ativação em trial e conversão final.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <FiltroPeriodo valor={preset} presets={PRESETS} onMudar={setPreset} />
          <select aria-label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md">
            <option value="">Todos os Responsáveis</option>
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void carregar()} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">sync</span>
            Atualizar Métricas
          </button>
          <Link
            href={`/indicadores/executivo?periodo=${preset}${responsavelId ? `&responsavelId=${responsavelId}` : ''}`}
            target="_blank"
            className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">summarize</span>
            Relatório Executivo
          </Link>
        </div>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar os indicadores. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && (!kpis || !funil) && <EsqueletoCarregando />}
      {kpis && funil && (
        <div className="flex flex-col gap-space-md flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-space-md shrink-0">
            <section aria-label="Desempenho consolidado de receita" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="w-11 h-11 rounded-xl bg-info-surface text-primary flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[24px]">track_changes</span>
                  </span>
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Desempenho consolidado de receita</span>
                    <h2 className="font-headline-sm text-headline-sm text-text-primary">{metaDeReceita ? `Meta de receita ${rotuloDoPeriodo}` : `Novo MRR contratado ${rotuloDoPeriodo}`}</h2>
                  </div>
                </div>
                {andamentoDaReceita !== null && (
                  <span className="font-headline-lg text-headline-lg text-primary">{pct(andamentoDaReceita * 100)}</span>
                )}
              </div>
              <div className="flex items-end justify-between gap-3 flex-wrap font-body-md text-body-md text-text-secondary">
                <span>
                  Novo MRR contratado: <strong className="text-text-primary">{moeda(receitaTotal)}</strong>
                </span>
                {metaDeReceita ? (
                  <span>
                    Meta: <strong className="text-text-primary">{moeda(metaDeReceita)}</strong>
                  </span>
                ) : (
                  <Link href="/configuracoes/metas" className="text-primary font-semibold hover:underline">
                    {metas.receita_mensal === undefined ? 'Definir meta de receita' : 'A meta de receita é mensal: escolha "Este mês" ou "Trimestre"'}
                  </Link>
                )}
              </div>
              {andamentoDaReceita !== null && (
                <>
                  <div role="progressbar" aria-label="Andamento da meta de receita" aria-valuenow={Math.round(andamentoDaReceita * 100)} aria-valuemin={0} aria-valuemax={100} className="h-2.5 rounded-full bg-surface-container overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${andamentoDaReceita * 100}%` }} />
                  </div>
                  <span className="font-body-sm text-body-sm text-text-muted">
                    {receitaTotal >= (metaDeReceita ?? 0) ? 'Meta atingida' : `Faltam ${moeda((metaDeReceita ?? 0) - receitaTotal)}`} · {inteiro(funil.funil.ganhos)} {funil.funil.ganhos === 1 ? 'contrato fechado' : 'contratos fechados'}
                  </span>
                </>
              )}
            </section>

            <section aria-label="Governança de metas" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-space-md">
              {metasAtingidas.total > 0 ? (
                <>
                  <div className="relative w-24 h-24 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90" aria-hidden="true">
                      <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" className="stroke-surface-container" />
                      <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(metasAtingidas.atingidas / metasAtingidas.total) * 100} 100`} className="stroke-success-text" />
                    </svg>
                    <span className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-headline-md text-headline-md text-text-primary leading-none">{metasAtingidas.atingidas}/{metasAtingidas.total}</span>
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Governança de metas</span>
                    <h2 className="font-headline-sm text-headline-sm text-text-primary">Metas atingidas</h2>
                    <p className="font-body-sm text-body-sm text-text-secondary">Dos indicadores que têm meta cadastrada, {metasAtingidas.atingidas} {metasAtingidas.atingidas === 1 ? 'está' : 'estão'} no alvo neste período.</p>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Governança de metas</span>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">Sem metas para comparar</h2>
                  <p className="font-body-sm text-body-sm text-text-secondary">Cadastre as metas de conversão e de presença para ver se os indicadores estão no alvo.</p>
                  <Link href="/configuracoes/metas" className="font-label-md text-label-md text-primary font-semibold hover:underline w-fit">
                    Configurar Metas
                  </Link>
                </div>
              )}
            </section>
          </div>

          <section aria-label="Indicadores vitais" className="flex flex-col gap-space-sm shrink-0">
            <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-primary">verified_user</span>
              7 Indicadores Vitais da Régua e Conversão
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-space-sm">
              {CARTOES.map((c) => {
                const i = kpis[c.chave];
                const semDados = i.valor === null;
                const meta = c.chave === 'conversao' ? metas.taxa_conversao : c.chave === 'noShow' ? metas.taxa_presenca : undefined;
                const noAlvo =
                  meta === undefined || i.valor === null ? null : c.chave === 'noShow' ? (1 - i.valor) * 100 >= meta : i.valor * 100 >= meta;
                const rotuloMeta = meta === undefined ? null : c.chave === 'noShow' ? `Meta: presença ≥ ${meta.toLocaleString('pt-BR')}%` : `Meta: ≥ ${meta.toLocaleString('pt-BR')}%`;
                return (
                  <article key={c.chave} aria-label={c.titulo} className="bg-surface-card rounded-2xl p-3 shadow-sm flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-label-sm text-[10px] text-text-muted uppercase tracking-wider leading-tight">{c.pilar}</span>
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">{c.icone}</span>
                    </div>
                    <h3 className="font-label-md text-label-md text-text-secondary">{c.titulo}</h3>
                    <p className="font-metric-stat text-metric-stat text-text-primary">{semDados ? 'Sem dados' : porcentagem(i.valor)}</p>
                    {anteriores && !semDados ? <Delta atual={i.valor} anterior={anteriores[c.chave].valor} inverso={c.inverso} /> : <span className="h-5" />}
                    {rotuloMeta && (
                      <span className={`font-body-sm text-[11px] ${noAlvo ? 'text-success-text' : 'text-warning-text'}`}>
                        {rotuloMeta} · {noAlvo ? 'No alvo' : 'Abaixo'}
                      </span>
                    )}
                    <div className="h-1.5 rounded-full bg-surface-container overflow-hidden mt-auto">
                      <div className={`h-full ${noAlvo === false ? 'bg-warning-text' : 'bg-primary'}`} style={{ width: `${Math.min((i.valor ?? 0) * 100, 100)}%` }} />
                    </div>
                    <p className="font-body-sm text-[11px] text-text-muted">{semDados ? (c.chave === 'ativacaoTrial' ? 'Ainda sem fonte de dados' : 'Nenhum card na base') : `${inteiro(i.numerador)} de ${inteiro(i.denominador)}`}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-label="Funil de Conversão Comercial Contínuo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm shrink-0">
            <div className="flex items-end justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Jornada clínica ponta a ponta</span>
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Funil de Conversão Comercial Contínuo</h2>
              </div>
              <span className="font-body-sm text-body-sm text-text-muted flex items-center gap-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-primary inline-block rounded-sm" /> Retenção na etapa</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-danger-text inline-block rounded-sm" /> Drop-off (perda)</span>
              </span>
            </div>
            <ol className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-space-sm">
              {ETAPAS_DO_FUNIL.map((e, i) => {
                const quantidade = funil.funil[e.chave];
                const anterior = i > 0 ? funil.funil[ETAPAS_DO_FUNIL[i - 1].chave] : null;
                const retencao = anterior === null ? null : razao(quantidade, anterior);
                const doTopo = razao(quantidade, funil.funil.entrada);
                const ultima = i === ETAPAS_DO_FUNIL.length - 1;
                return (
                  <li key={e.chave} className={`rounded-xl p-3 flex flex-col gap-1 ${ultima ? 'bg-success-surface' : 'bg-surface-subtle'}`}>
                    <span className="flex items-center justify-between gap-1">
                      <span className="font-label-sm text-label-sm text-text-muted uppercase">{ultima ? 'Etapa final' : `Etapa ${String(i + 1).padStart(2, '0')}`}</span>
                      <span className={`font-label-sm text-[10px] px-1.5 py-0.5 rounded-full ${ultima ? 'bg-success-text text-on-primary' : 'bg-info-surface text-primary'}`}>
                        {i === 0 ? 'Topo' : ultima ? 'Ganho' : porcentagem(retencao)}
                      </span>
                    </span>
                    <span className="font-label-lg text-label-lg text-text-primary">{e.nome}</span>
                    <span className="flex items-baseline justify-between gap-2 mt-2">
                      <span className="font-headline-md text-headline-md text-text-primary">{inteiro(quantidade)}</span>
                      <span className="font-body-sm text-body-sm text-text-muted">{porcentagem(doTopo)} do topo</span>
                    </span>
                    {anterior !== null && (
                      <span className="font-body-sm text-[11px] text-text-muted border-t border-surface-container pt-1">
                        {retencao === null ? 'Retenção — · Perda —' : `Retenção ${porcentagem(retencao)} · `}
                        {retencao !== null && <span className="text-danger-text">Perda {porcentagem(1 - retencao)}</span>}
                      </span>
                    )}
                    {ultima && quantidade > 0 && (
                      <span className="font-body-sm text-[11px] text-success-text">
                        Ticket médio {moeda(receitaTotal / quantidade)} · MRR {moeda(receitaTotal)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div aria-hidden="true" className="h-1.5 rounded-full bg-gradient-to-r from-primary to-success-text" />
          </section>

          <section aria-label="Desempenho por Responsável" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Governança individual de vendas</span>
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Desempenho por Closer e SDR</h2>
              </div>
              <span className="flex items-center gap-2">
                <button type="button" onClick={exportar} disabled={funil.porResponsavel.length === 0} className="h-9 px-3 rounded-lg bg-surface-subtle inline-flex items-center gap-2 font-label-md text-label-md text-text-primary disabled:opacity-50">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
                  Exportar CSV
                </button>
                <Link href="/configuracoes/metas" className="h-9 px-3 rounded-lg bg-surface-subtle inline-flex items-center gap-2 font-label-md text-label-md text-text-primary">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">tune</span>
                  Configurar Metas
                </Link>
              </span>
            </div>
            {funil.porResponsavel.length === 0 ? (
              <EstadoVazio titulo="Nenhum card neste período" proximoPasso="escolha outro período ou crie leads no pipeline" icone="query_stats" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-subtle">
                      <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                        <th className="px-space-md py-3">Consultor / Closer</th>
                        <th className="px-space-md py-3">Cards atendidos</th>
                        <th className="px-space-md py-3">Régua 18 toques</th>
                        <th className="px-space-md py-3">Demos agendadas</th>
                        <th className="px-space-md py-3">No-show</th>
                        <th className="px-space-md py-3">Propostas</th>
                        <th className="px-space-md py-3">Contratos</th>
                        <th className="px-space-md py-3">Win rate</th>
                        <th className="px-space-md py-3">Receita ganha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordenados.map((d, posicao) => (
                        <tr key={d.responsavelId ?? 'sem-responsavel'} className="border-t border-surface-container">
                          <td className="px-space-md py-3">
                            <div className="flex items-center gap-3">
                              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-info-surface text-primary flex items-center justify-center font-label-md text-label-md">
                                {iniciais(d.nome ?? 'Sem responsável')}
                              </span>
                              <div className="flex flex-col">
                                <span className="font-label-lg text-label-lg text-text-primary flex items-center gap-2">
                                  {d.nome ?? 'Sem responsável'}
                                  {posicao === 0 && d.receitaGanha > 0 && ordenados.length > 1 && <span className="px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-label-sm text-[10px] uppercase">Top closer</span>}
                                </span>
                                {d.papel && <span className="font-body-sm text-body-sm text-text-muted">{d.papel}</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-space-md py-3">{inteiro(d.atendidos)}</td>
                          <td className="px-space-md py-3"><span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-md text-label-md">{porcentagem(razao(d.cadenciaEsgotada, d.cadenciaIniciada))}</span></td>
                          <td className="px-space-md py-3">{inteiro(d.agendadas)}</td>
                          <td className="px-space-md py-3 text-text-secondary">{porcentagem(razao(d.noShows, d.agendadas))}</td>
                          <td className="px-space-md py-3">{inteiro(d.propostas)}</td>
                          <td className="px-space-md py-3">{inteiro(d.contratos)}</td>
                          <td className="px-space-md py-3 text-primary font-semibold">{porcentagem(d.winRate)}</td>
                          <td className="px-space-md py-3 font-label-lg text-label-lg text-success-text">{moeda(d.receitaGanha)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-space-md py-3 font-body-sm text-body-sm text-text-muted">Mostrando {funil.porResponsavel.length} {funil.porResponsavel.length === 1 ? 'responsável' : 'responsáveis'}</p>
              </>
            )}
          </section>

          {alertas && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md shrink-0">
              <section aria-label="Propostas paradas" className="bg-surface-card rounded-2xl p-space-md shadow-sm border-l-4 border-warning-text flex flex-col gap-2">
                <span className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-warning-text uppercase tracking-wider">Alerta operacional · Etapa Proposta</span>
                  {alertas.propostasParadas.total > 0 && <span className="px-2 py-0.5 rounded-full bg-warning-surface text-warning-text font-label-sm text-label-sm">Risco de esfriamento</span>}
                </span>
                <h3 className="font-headline-sm text-headline-sm text-text-primary">
                  {alertas.propostasParadas.total === 0 ? 'Nenhuma proposta parada há mais de 48h' : `${inteiro(alertas.propostasParadas.total)} ${alertas.propostasParadas.total === 1 ? 'proposta parada' : 'propostas paradas'} há mais de 48h`}
                </h3>
                <p className="font-body-sm text-body-sm text-text-secondary">
                  {alertas.propostasParadas.total === 0
                    ? 'Todas as propostas em aberto tiveram movimento nas últimas 48 horas.'
                    : `Propostas enviadas que não tiveram nenhum movimento desde então. Valor estimado em pipeline sob risco: ${moeda(alertas.propostasParadas.valor)}.`}
                </p>
                <Link href="/pipeline/lista" className="font-label-md text-label-md text-primary font-semibold hover:underline w-fit">
                  Ver no pipeline
                </Link>
              </section>
              <section aria-label="No-shows para resgate" className="bg-surface-card rounded-2xl p-space-md shadow-sm border-l-4 border-danger-text flex flex-col gap-2">
                <span className="font-label-sm text-label-sm text-danger-text uppercase tracking-wider">Eficiência de resgate · No-show</span>
                <h3 className="font-headline-sm text-headline-sm text-text-primary">
                  {alertas.noShowsPendentes.total === 0 ? 'Nenhum no-show aguardando resgate' : `${inteiro(alertas.noShowsPendentes.total)} ${alertas.noShowsPendentes.total === 1 ? 'card está' : 'cards estão'} em No-show`}
                </h3>
                <p className="font-body-sm text-body-sm text-text-secondary">
                  {alertas.noShowsPendentes.total === 0 ? 'Não há reuniões perdidas pendentes de reagendamento.' : `Reuniões em que o lead faltou e ainda não foram reagendadas. Valor estimado em pipeline: ${moeda(alertas.noShowsPendentes.valor)}.`}
                </p>
                <Link href="/agenda" className="font-label-md text-label-md text-primary font-semibold hover:underline w-fit">
                  Abrir a agenda
                </Link>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
