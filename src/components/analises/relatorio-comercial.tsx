'use client';

// T-207 (fase4-analises, US-135): relatório "Comercial e Vendas" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/25._relatorios_comerciais_comercial_e_vendas/`. Os
// dados vêm de `GET /api/relatorios/comercial` (eventos do histórico no período). Meta de
// MRR, especialidade e descontos não existem no sistema e não aparecem (Q-058).
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { descreverMeta, ehMesInteiro } from '@/lib/metas/catalogo';
import { useMetas } from '@/lib/metas/usar-metas';
import { dataBr, diaEMes, iniciais, inteiro, moeda, nomeDoArquivoCsv, periodoAnteriorDe, periodoDe, periodoPronto, porcentagem, type PeriodoEscolhido, type Preset, type Responsavel } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { FiltroPeriodo } from './filtro-periodo';
import { GraficoLinhas } from './grafico-linhas';

interface Linha {
  responsavelId: string | null;
  nome: string | null;
  reunioesRealizadas: number;
  propostas: number;
  contratos: number;
  perdas: number;
  winRate: number | null;
  cicloMedioDias: number | null;
  ticketMedio: number | null;
  valorFechado: number;
  sqls?: number;
  imagem?: string | null;
}
interface Dados {
  resumo: {
    mrrNovo: number;
    contratos: number;
    ticketMedio: number | null;
    pipelineEmNegociacao: { valor: number; propostas: number; ponderado?: number | null };
    cicloMedioDias: number | null;
    winRate: { valor: number | null; ganhos: number; perdas: number };
  };
  semanal: { inicio: string; valorFechado: number; pipelineCriado: number }[];
  ranking: Linha[];
  motivosPerda: { motivo: string; quantidade: number; percentual: number }[];
  totalPerdas: number;
  fechamentos?: Fechamentos;
  especialidadesDisponiveis?: string[];
  porEspecialidade?: { especialidade: string; contratos: number; valor: number; participacao: number }[];
  insights?: {
    melhorDiaDeFechamento: { dia: number; contratos: number; participacao: number } | null;
    ticketCampeao: { especialidade: string; ticketMedio: number; contratos: number } | null;
    propostaAteAssinaturaDias: number | null;
    descontoMedio?: { percentual: number; contratosComDesconto: number } | null;
    cicloPorTipo?: { inbound: { contratos: number; cicloMedioDias: number | null }; outbound: { contratos: number; cicloMedioDias: number | null } };
  };
}
interface ContagemFechamento {
  nome: string;
  quantidade: number;
  percentual: number;
}
interface Fechamentos {
  registrados: number;
  semRegistro: number;
  plataformas: ContagemFechamento[];
  motivos: ContagemFechamento[];
  planos: ContagemFechamento[];
  origens: ContagemFechamento[];
}

type Ordem = 'valor' | 'winrate' | 'contratos';
const PRESETS: Preset[] = ['hoje', '7dias', '30dias', 'mes', 'trimestre'];
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: 'valor', rotulo: 'Maior valor fechado' },
  { id: 'winrate', rotulo: 'Maior win rate' },
  { id: 'contratos', rotulo: 'Mais contratos' },
];

function ordenar(linhas: Linha[], ordem: Ordem): Linha[] {
  const copia = [...linhas];
  if (ordem === 'winrate') return copia.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.valorFechado - a.valorFechado);
  if (ordem === 'contratos') return copia.sort((a, b) => b.contratos - a.contratos || b.valorFechado - a.valorFechado);
  return copia.sort((a, b) => b.valorFechado - a.valorFechado || b.contratos - a.contratos);
}

function ListaDeFechamento({ titulo, itens, cor }: { titulo: string; itens: ContagemFechamento[]; cor: string }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <h3 className="font-label-lg text-label-lg text-text-primary">{titulo}</h3>
      <ol className="flex flex-col gap-2">
        {itens.slice(0, 6).map((i) => (
          <li key={i.nome} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 font-body-sm text-body-sm text-text-primary">
              <span className="truncate">{i.nome}</span>
              <span className="shrink-0">
                {inteiro(i.quantidade)} ({i.percentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
              </span>
            </div>
            <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div className={`h-full ${cor}`} style={{ width: `${i.percentual}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CORES_DA_ESPECIALIDADE = ['bg-primary', 'bg-info-text', 'bg-slate-500', 'bg-warning-text', 'bg-success-text', 'bg-slate-300'];

function variacao(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function Variacao({ valor, menorEMelhor = false }: { valor: number | null; menorEMelhor?: boolean }) {
  if (valor === null) return <span className="font-body-sm text-body-sm text-text-muted">sem comparação</span>;
  const bom = menorEMelhor ? valor < 0 : valor > 0;
  return (
    <span className={`font-body-sm text-body-sm font-semibold inline-flex items-center gap-0.5 ${Math.abs(valor) < 0.05 ? 'text-text-muted' : bom ? 'text-success-text' : 'text-danger-text'}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{valor >= 0 ? 'arrow_upward' : 'arrow_downward'}</span>
      {valor > 0 ? '+' : ''}
      {valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% <span className="font-normal text-text-muted">vs período anterior</span>
    </span>
  );
}

function CartaoDeIndicador({ titulo, valor, icone, destaque, rodape, selo }: { titulo: string; valor: string; icone: string; destaque: string; rodape: React.ReactNode; selo?: { texto: string; atingida: boolean } | null }) {
  return (
    <div role="group" aria-label={titulo} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{titulo}</span>
        <span aria-hidden="true" className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${destaque}`}>
          <span className="material-symbols-outlined text-[20px]">{icone}</span>
        </span>
      </div>
      <p className="font-metric-stat text-metric-stat text-text-primary">{valor}</p>
      <div className="flex flex-col gap-0.5 font-body-sm text-body-sm text-text-secondary">{rodape}</div>
      {selo && (
        <span className="self-start flex items-center gap-1.5 font-body-sm text-body-sm text-text-secondary">
          <span>{selo.texto}</span>
          {selo.atingida && <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">Meta atingida</span>}
        </span>
      )}
    </div>
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

export function RelatorioComercial() {
  const metas = useMetas();
  const [periodo, setPeriodo] = useState<PeriodoEscolhido>(periodoPronto('mes'));
  const [responsavelId, setResponsavelId] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [ordem, setOrdem] = useState<Ordem>('valor');
  const [dados, setDados] = useState<Dados | null>(null);
  const [anterior, setAnterior] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  // fase5-meta-receita (AC-690/AC-691, ASM-255): a meta mensal só vale quando os dados NA TELA são de um mês inteiro e sem
  // filtro de responsável (guardados junto dos dados, para a meta não aparecer sobre números de outro período).
  const [recorteDosDados, setRecorteDosDados] = useState<{ de: string; ate: string; responsavelId: string } | null>(null);

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDe(periodo);
    const q = new URLSearchParams({ de, ate });
    if (responsavelId) q.set('responsavelId', responsavelId);
    if (especialidade) q.set('especialidade', especialidade);
    // O período anterior só serve para a comparação (se falhar, os números ficam sem variação); é pedido ANTES do período
    // escolhido para a última chamada ao servidor ser sempre a do período que está na tela.
    void (async () => {
      try {
        const ant = periodoAnteriorDe(periodo);
        const qAnt = new URLSearchParams({ de: ant.de, ate: ant.ate });
        if (responsavelId) qAnt.set('responsavelId', responsavelId);
        if (especialidade) qAnt.set('especialidade', especialidade);
        const r = await fetch(`/api/relatorios/comercial?${qAnt}`);
        setAnterior(r?.ok ? ((await r.json()) as Dados) : null);
      } catch {
        setAnterior(null);
      }
    })();
    try {
      const r = await fetch(`/api/relatorios/comercial?${q}`);
      if (!r.ok) throw new Error(`comercial respondeu ${r.status}`);
      setDados((await r.json()) as Dados);
      setRecorteDosDados({ de, ate, responsavelId });
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [periodo, responsavelId, especialidade]);

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

  const ranking = useMemo(() => (dados ? ordenar(dados.ranking, ordem) : []), [dados, ordem]);
  const totais = useMemo(() => {
    const t = { sqls: 0, reunioes: 0, propostas: 0, contratos: 0, perdas: 0, valor: 0 };
    for (const l of dados?.ranking ?? []) {
      t.sqls += l.sqls ?? 0;
      t.reunioes += l.reunioesRealizadas;
      t.propostas += l.propostas;
      t.contratos += l.contratos;
      t.perdas += l.perdas;
      t.valor += l.valorFechado;
    }
    return t;
  }, [dados]);

  // AC-573: os cinco primeiros em destaque, o resto em "Outros".
  const motivos = useMemo(() => {
    const todos = dados?.motivosPerda ?? [];
    const destaque = todos.slice(0, 5);
    const resto = todos.slice(5);
    if (resto.length === 0) return destaque;
    const quantidade = resto.reduce((s, m) => s + m.quantidade, 0);
    return [...destaque, { motivo: 'Outros', quantidade, percentual: Math.round(resto.reduce((s, m) => s + m.percentual, 0) * 10) / 10 }];
  }, [dados]);

  const metaDaReceita =
    dados && recorteDosDados && !recorteDosDados.responsavelId && ehMesInteiro(recorteDosDados.de, recorteDosDados.ate)
      ? descreverMeta(dados.resumo.mrrNovo, metas.receita_mensal, 'reais')
      : null;
  const atingimento = dados && metas.receita_mensal && metaDaReceita ? Math.round((dados.resumo.mrrNovo / metas.receita_mensal) * 100) : null;
  const taxaDePerda = dados && dados.resumo.winRate.ganhos + dados.resumo.winRate.perdas > 0 ? dados.resumo.winRate.perdas / (dados.resumo.winRate.ganhos + dados.resumo.winRate.perdas) : null;
  const maiorTotalDeEspecialidade = Math.max(1, ...(dados?.porEspecialidade ?? []).map((e) => e.valor));

  function exportar() {
    if (!dados) return;
    const { de, ate } = periodoDe(periodo);
    baixarCsv(nomeDoArquivoCsv('relatorio-comercial', periodo), [
      ['Período', `${dataBr(de)} a ${dataBr(ate)}`],
      ['Responsável', 'SQLs', 'Demos (reuniões realizadas)', 'Propostas', 'Contratos', 'Win rate (%)', 'Ciclo médio (dias)', 'Ticket médio (R$)', 'Valor fechado (R$)'],
      ...ranking.map((l) => [
        l.nome ?? 'Sem responsável',
        l.sqls ?? 0,
        l.reunioesRealizadas,
        l.propostas,
        l.contratos,
        l.winRate === null ? '' : (l.winRate * 100).toFixed(1).replace('.', ','),
        l.cicloMedioDias ?? '',
        l.ticketMedio === null ? '' : l.ticketMedio.toFixed(2).replace('.', ','),
        l.valorFechado.toFixed(2).replace('.', ','),
      ]),
    ]);
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[30rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <div className="flex items-center gap-space-md flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Relatórios Comerciais e Produtividade de Vendas</h1>
            {atingimento !== null && (
              <span className={`px-3 py-1 rounded-full font-label-md text-label-md ${atingimento >= 100 ? 'bg-success-surface text-success-text' : 'bg-warning-surface text-warning-text'}`}>
                Meta {atingimento}% {atingimento >= 100 ? 'atingida' : 'do mês'}
              </span>
            )}
          </div>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">Receita fechada, pipeline em negociação, ciclo de venda e desempenho da equipe comercial.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button type="button" onClick={exportar} disabled={!dados} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm inline-flex items-center gap-2 font-label-md text-label-md text-text-primary disabled:opacity-50">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
            Exportar Dados (CSV)
          </button>
          <Link href="/configuracoes/metas" className="h-10 px-4 rounded-xl bg-primary text-on-primary shadow-md inline-flex items-center gap-2 font-label-md text-label-md font-semibold">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">tune</span>
            Configurar Metas de Vendas
          </Link>
        </div>
      </div>

      <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-space-sm flex-wrap shrink-0">
        <FiltroPeriodo valor={periodo} presets={PRESETS} onMudar={setPeriodo} />
        <select aria-label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
          <option value="">Todos os Closers e SDRs</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
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
            <CartaoDeIndicador
              titulo="Novo MRR contratado"
              valor={moeda(dados.resumo.mrrNovo)}
              icone="payments"
              destaque="bg-success-surface text-success-text"
              selo={metaDaReceita}
              rodape={
                <>
                  <Variacao valor={variacao(dados.resumo.mrrNovo, anterior?.resumo.mrrNovo)} />
                  <span>
                    {inteiro(dados.resumo.contratos)} contratos · ticket médio {moeda(dados.resumo.ticketMedio)}
                  </span>
                </>
              }
            />
            <CartaoDeIndicador
              titulo="Pipeline em negociação"
              valor={moeda(dados.resumo.pipelineEmNegociacao.valor)}
              icone="request_quote"
              destaque="bg-info-surface text-primary"
              rodape={
                <>
                  <span>{inteiro(dados.resumo.pipelineEmNegociacao.propostas)} propostas em estágio de fechamento (foto de hoje)</span>
                  <span>
                    Ponderado pelo win rate do período:{' '}
                    <strong className="text-text-primary">{dados.resumo.pipelineEmNegociacao.ponderado == null ? '—' : moeda(dados.resumo.pipelineEmNegociacao.ponderado)}</strong>
                  </span>
                </>
              }
            />
            <CartaoDeIndicador
              titulo="Ciclo médio"
              valor={dados.resumo.cicloMedioDias === null ? '—' : `${dados.resumo.cicloMedioDias.toLocaleString('pt-BR')} dias`}
              icone="schedule"
              destaque="bg-warning-surface text-warning-text"
              rodape={
                <>
                  <Variacao valor={variacao(dados.resumo.cicloMedioDias, anterior?.resumo.cicloMedioDias)} menorEMelhor />
                  <span>da criação do card ao contrato</span>
                  {dados.insights?.cicloPorTipo && (
                    <span>
                      Inbound: {dados.insights.cicloPorTipo.inbound.cicloMedioDias == null ? '—' : `${dados.insights.cicloPorTipo.inbound.cicloMedioDias.toLocaleString('pt-BR')} d`} · Outbound:{' '}
                      {dados.insights.cicloPorTipo.outbound.cicloMedioDias == null ? '—' : `${dados.insights.cicloPorTipo.outbound.cicloMedioDias.toLocaleString('pt-BR')} d`}
                    </span>
                  )}
                </>
              }
            />
            <CartaoDeIndicador
              titulo="Win rate"
              valor={porcentagem(dados.resumo.winRate.valor)}
              icone="emoji_events"
              destaque="bg-info-surface text-primary"
              selo={descreverMeta(dados.resumo.winRate.valor === null ? null : dados.resumo.winRate.valor * 100, metas.taxa_conversao)}
              rodape={
                <>
                  <Variacao valor={variacao(dados.resumo.winRate.valor, anterior?.resumo.winRate.valor)} />
                  <span>
                    {inteiro(dados.resumo.winRate.ganhos)} ganhos · {inteiro(dados.resumo.winRate.perdas)} perdas
                  </span>
                </>
              }
            />
          </div>

          <section aria-label="Evolução Semanal de Receita Ganha vs Pipeline Criado" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm shrink-0">
            <div className="flex flex-col">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Evolução Semanal de Receita Ganha vs Pipeline Criado</h2>
              <p className="font-body-sm text-body-sm text-text-muted">Valor das propostas geradas e dos contratos assinados em cada semana do período.</p>
            </div>
            <GraficoLinhas
              titulo="Valor fechado e valor de propostas geradas por semana"
              rotulos={dados.semanal.map((s) => `Sem ${diaEMes(s.inicio)}`)}
              series={[
                { nome: 'Novo MRR assinado (R$)', corTraco: 'stroke-primary', corLegenda: 'bg-primary', valores: dados.semanal.map((s) => s.valorFechado) },
                { nome: 'Propostas geradas (R$)', corTraco: 'stroke-warning-text', corLegenda: 'bg-warning-text', valores: dados.semanal.map((s) => s.pipelineCriado) },
              ]}
              formatarValor={(v) => moeda(v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-space-sm">
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Melhor dia de fechamento</span>
                <span className="font-label-lg text-label-lg text-text-primary capitalize">
                  {dados.insights?.melhorDiaDeFechamento ? `${DIAS_DA_SEMANA[dados.insights.melhorDiaDeFechamento.dia]} (${porcentagem(dados.insights.melhorDiaDeFechamento.participacao)})` : '—'}
                </span>
                {dados.insights?.melhorDiaDeFechamento && <span className="font-body-sm text-body-sm text-text-muted">{inteiro(dados.insights.melhorDiaDeFechamento.contratos)} contratos neste dia</span>}
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Ticket médio campeão</span>
                <span className="font-label-lg text-label-lg text-text-primary">
                  {dados.insights?.ticketCampeao ? `${dados.insights.ticketCampeao.especialidade} (${moeda(dados.insights.ticketCampeao.ticketMedio)})` : '—'}
                </span>
                <span className="font-body-sm text-body-sm text-text-muted">especialidade com maior ticket</span>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Proposta até assinatura</span>
                <span className="font-label-lg text-label-lg text-text-primary">
                  {dados.insights?.propostaAteAssinaturaDias == null ? '—' : `${dados.insights.propostaAteAssinaturaDias.toLocaleString('pt-BR')} dias`}
                </span>
                <span className="font-body-sm text-body-sm text-text-muted">média dos contratos do período</span>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Desconto médio concedido</span>
                <span className="font-label-lg text-label-lg text-text-primary">
                  {dados.insights?.descontoMedio ? `${dados.insights.descontoMedio.percentual.toLocaleString('pt-BR')}%` : '—'}
                </span>
                <span className="font-body-sm text-body-sm text-text-muted">
                  {dados.insights?.descontoMedio ? `em ${inteiro(dados.insights.descontoMedio.contratosComDesconto)} contratos` : 'informe o desconto em Dados da Proposta'}
                </span>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Taxa de perda</span>
                <span className="font-label-lg text-label-lg text-text-primary">{porcentagem(taxaDePerda)}</span>
                <span className="font-body-sm text-body-sm text-text-muted">perdas ÷ (ganhos + perdas)</span>
              </div>
            </div>
          </section>

          <section aria-label="Ranking da Equipe Comercial" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden shrink-0">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-col">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Ranking e Performance Individual da Equipe Comercial</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Eficiência e conversão de ponta a ponta: da reunião à assinatura do contrato.</p>
              </div>
              <label className="flex items-center gap-2 font-label-md text-label-md text-text-secondary">
                Ordenar por
                <select aria-label="Ordenar por" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="h-9 px-2 rounded-lg bg-surface-subtle">
                  {ORDENS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {ranking.length === 0 ? (
              <EstadoVazio titulo="Nenhum card neste período" proximoPasso="escolha outro período" icone="groups" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Consultor / Closer</th>
                      <th className="px-space-md py-3">SQLs</th>
                      <th className="px-space-md py-3">Demos</th>
                      <th className="px-space-md py-3">Propostas</th>
                      <th className="px-space-md py-3">Fechados</th>
                      <th className="px-space-md py-3">Win rate</th>
                      <th className="px-space-md py-3">Ciclo médio</th>
                      <th className="px-space-md py-3">Ticket médio</th>
                      <th className="px-space-md py-3">Valor fechado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((l, posicao) => (
                      <tr key={l.responsavelId ?? 'sem-responsavel'} data-responsavel={l.nome ?? 'Sem responsável'} className="border-t border-surface-container">
                        <td className="px-space-md py-3">
                          <div className="flex items-center gap-3">
                            <span aria-hidden="true" className="relative w-9 h-9 rounded-full bg-info-surface text-primary flex items-center justify-center font-label-md text-label-md">
                              {l.imagem ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={l.imagem} alt="" className="w-9 h-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                iniciais(l.nome ?? 'Sem responsável')
                              )}
                              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary text-on-primary text-[10px] flex items-center justify-center">{posicao + 1}</span>
                            </span>
                            <span className="font-label-lg text-label-lg text-text-primary flex items-center gap-2">
                              {l.nome ?? 'Sem responsável'}
                              {posicao === 0 && ranking.length > 1 && l.valorFechado > 0 && <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-[10px] uppercase">Top performer</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-space-md py-3">{inteiro(l.sqls ?? 0)}</td>
                        <td className="px-space-md py-3">{inteiro(l.reunioesRealizadas)}</td>
                        <td className="px-space-md py-3">{inteiro(l.propostas)}</td>
                        <td className="px-space-md py-3 text-primary font-semibold">{inteiro(l.contratos)}</td>
                        <td className="px-space-md py-3">
                          <span className={`px-2 py-0.5 rounded-full font-label-md text-label-md ${l.winRate === null ? '' : l.winRate >= 0.5 ? 'bg-success-surface text-success-text' : l.winRate >= 0.3 ? 'bg-warning-surface text-warning-text' : 'bg-danger-surface text-danger-text'}`}>
                            {porcentagem(l.winRate)}
                          </span>
                        </td>
                        <td className="px-space-md py-3">{l.cicloMedioDias === null ? '—' : `${l.cicloMedioDias.toLocaleString('pt-BR')} dias`}</td>
                        <td className="px-space-md py-3">{moeda(l.ticketMedio)}</td>
                        <td className="px-space-md py-3 font-label-lg text-label-lg">{moeda(l.valorFechado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-surface-container bg-surface-subtle font-label-lg text-label-lg">
                      <td className="px-space-md py-3">Totais consolidados</td>
                      <td className="px-space-md py-3">{inteiro(totais.sqls)}</td>
                      <td className="px-space-md py-3">{inteiro(totais.reunioes)}</td>
                      <td className="px-space-md py-3">{inteiro(totais.propostas)}</td>
                      <td className="px-space-md py-3">{inteiro(totais.contratos)}</td>
                      <td className="px-space-md py-3">{porcentagem(totais.contratos + totais.perdas > 0 ? totais.contratos / (totais.contratos + totais.perdas) : null)}</td>
                      <td className="px-space-md py-3">{dados.resumo.cicloMedioDias === null ? '—' : `${dados.resumo.cicloMedioDias.toLocaleString('pt-BR')} dias`}</td>
                      <td className="px-space-md py-3">{moeda(totais.contratos > 0 ? totais.valor / totais.contratos : null)}</td>
                      <td className="px-space-md py-3">{moeda(totais.valor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md shrink-0">
            <section aria-label="Distribuição por Especialidade" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Distribuição por Especialidade Médica</h2>
                <span className="font-body-sm text-body-sm text-text-muted">{inteiro(dados.resumo.contratos)} contratos</span>
              </div>
              {(dados.porEspecialidade ?? []).length === 0 ? (
                <p className="font-body-md text-body-md text-text-secondary">Nenhum contrato no período.</p>
              ) : (
                <>
                  <div aria-hidden="true" className="flex h-2.5 rounded-full overflow-hidden bg-surface-container">
                    {(dados.porEspecialidade ?? []).slice(0, 6).map((e, i) => (
                      <div key={e.especialidade} className={CORES_DA_ESPECIALIDADE[i]} style={{ width: `${e.participacao * 100}%` }} />
                    ))}
                  </div>
                  <ol className="flex flex-col gap-2">
                    {(dados.porEspecialidade ?? []).slice(0, 6).map((e, i) => (
                      <li key={e.especialidade} className="rounded-xl bg-surface-subtle p-3 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 min-w-0">
                          <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${CORES_DA_ESPECIALIDADE[i]}`} />
                          <span className="flex flex-col min-w-0">
                            <span className="font-label-md text-label-md text-text-primary truncate">{e.especialidade}</span>
                            <span className="font-body-sm text-body-sm text-text-muted">
                              {inteiro(e.contratos)} {e.contratos === 1 ? 'contrato' : 'contratos'} ({porcentagem(e.participacao)})
                            </span>
                          </span>
                        </span>
                        <span className="font-label-lg text-label-lg text-text-primary shrink-0" title={`${Math.round((e.valor / maiorTotalDeEspecialidade) * 100)}% do maior`}>
                          {moeda(e.valor)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>

            <section aria-label="Motivos de Perda no Ciclo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Motivos de Perda no Ciclo</h2>
                <span className="px-2.5 py-1 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm">{inteiro(dados.totalPerdas)} {dados.totalPerdas === 1 ? 'perda' : 'perdas'}</span>
              </div>
              {motivos.length === 0 && <p className="font-body-md text-body-md text-text-secondary">Nenhuma perda no período</p>}
              <ol className="flex flex-col gap-2">
                {motivos.map((m, i) => (
                  <li key={m.motivo} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 font-label-md text-label-md text-text-primary">
                      <span>
                        {i + 1}. {m.motivo}
                      </span>
                      <span className="shrink-0">
                        {inteiro(m.quantidade)} ({m.percentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                      <div className="h-full bg-danger-text" style={{ width: `${m.percentual}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              {taxaDePerda !== null && (
                <p className="font-body-sm text-body-sm text-text-muted">
                  Taxa de perda geral: {porcentagem(taxaDePerda)} ({inteiro(dados.resumo.winRate.perdas)} de {inteiro(dados.resumo.winRate.ganhos + dados.resumo.winRate.perdas)} negociações encerradas).{' '}
                  <Link href="/configuracoes/motivos-perda" className="text-primary font-semibold hover:underline">
                    Gerenciar motivos
                  </Link>
                </p>
              )}
            </section>
          </div>

          {dados.fechamentos && (
            <section aria-label="Fechamentos de Clientes" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Fechamentos de Clientes: de onde vêm e por que trocam</h2>
                <span className="px-2.5 py-1 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">
                  {inteiro(dados.fechamentos.registrados)} {dados.fechamentos.registrados === 1 ? 'fechamento registrado' : 'fechamentos registrados'}
                </span>
              </div>
              {dados.fechamentos.registrados === 0 ? (
                <p className="font-body-md text-body-md text-text-secondary">Nenhum fechamento registrado neste período. Os dados aparecem quando um card é movido para Contrato (Ganho) e o fechamento é preenchido.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
                  <ListaDeFechamento titulo="Plataforma que usavam antes" itens={dados.fechamentos.plataformas} cor="bg-primary" />
                  <ListaDeFechamento titulo="O que deixou a desejar" itens={dados.fechamentos.motivos} cor="bg-danger-text" />
                  <ListaDeFechamento titulo="Plano escolhido" itens={dados.fechamentos.planos} cor="bg-success-text" />
                  <ListaDeFechamento titulo="Por onde conheceram" itens={dados.fechamentos.origens} cor="bg-warning-text" />
                </div>
              )}
              {dados.fechamentos.semRegistro > 0 && (
                <p className="font-body-sm text-body-sm text-text-muted">
                  {inteiro(dados.fechamentos.semRegistro)} {dados.fechamentos.semRegistro === 1 ? 'contrato do período ainda não tem' : 'contratos do período ainda não têm'} o fechamento registrado (abra o card e use &quot;Registrar fechamento&quot;).
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
