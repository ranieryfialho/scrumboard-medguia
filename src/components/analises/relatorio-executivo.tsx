'use client';

// T-311 (fase4-analises, US-133): o "Relatório Executivo" — um resumo de uma página dos indicadores do período (receita contra a
// meta, os 7 indicadores com a variação, o funil, o desempenho por responsável e os alertas), com o mesmo número da tela de
// indicadores. Sem dependência de PDF: o botão abre a impressão do navegador, de onde se salva em PDF. Na impressão só o
// relatório aparece (a casca some).
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  CARTOES,
  ETAPAS_DO_FUNIL,
  razao,
  type Alertas,
  type Desempenho,
  type Funil,
  type Kpis,
  type MetasView,
} from './indicadores-funil';
import { diaEMes, inteiro, moeda, periodoAnterior, periodoDoPreset, porcentagem, ROTULO_DO_PRESET, type Preset } from './comum';
import { EsqueletoCarregando, EstadoErro } from './estados';

const PRESETS: Preset[] = ['hoje', '7dias', '30dias', 'mes', 'trimestre'];

function Titulo({ children }: { children: string }) {
  return <h2 className="font-headline-sm text-headline-sm text-text-primary border-b border-surface-container pb-1 mb-2">{children}</h2>;
}

const dataCompleta = (iso: string) => iso.split('-').reverse().join('/');

export function RelatorioExecutivo() {
  const parametros = useSearchParams();
  const bruto = parametros.get('periodo') as Preset | null;
  const preset: Preset = bruto && PRESETS.includes(bruto) ? bruto : 'mes';
  const responsavelId = parametros.get('responsavelId') ?? '';

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [anteriores, setAnteriores] = useState<Kpis | null>(null);
  const [funil, setFunil] = useState<{ funil: Funil; porResponsavel: Desempenho[] } | null>(null);
  const [metas, setMetas] = useState<MetasView>({});
  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [nomeDoResponsavel, setNomeDoResponsavel] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [geradoEm] = useState(() => new Date());

  useEffect(() => {
    let cancelado = false;
    const { de, ate } = periodoDoPreset(preset);
    const ant = periodoAnterior(preset);
    const q = new URLSearchParams({ de, ate });
    const qAnt = new URLSearchParams({ de: ant.de, ate: ant.ate });
    if (responsavelId) {
      q.set('responsavelId', responsavelId);
      qAnt.set('responsavelId', responsavelId);
    }
    const buscar = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url);
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    void (async () => {
      const [k, f] = await Promise.all([buscar<Kpis>(`/api/relatorios/kpis?${q}`), buscar<{ funil: Funil; porResponsavel: Desempenho[] }>(`/api/relatorios/funil?${q}`)]);
      if (cancelado) return;
      if (!k || !f) {
        setErro(true);
        return;
      }
      setKpis(k);
      setFunil(f);
      const [a, m, al, resp] = await Promise.all([
        buscar<Kpis>(`/api/relatorios/kpis?${qAnt}`),
        buscar<{ metas?: MetasView }>('/api/metas'),
        buscar<Alertas>(`/api/relatorios/alertas${responsavelId ? `?responsavelId=${responsavelId}` : ''}`),
        responsavelId ? buscar<{ responsaveis: { id: string; nome: string }[] }>('/api/pipeline/responsaveis') : Promise.resolve(null),
      ]);
      if (cancelado) return;
      setAnteriores(a && 'conexao' in a ? a : null);
      setMetas(m?.metas ?? {});
      setAlertas(al && 'propostasParadas' in al ? al : null);
      setNomeDoResponsavel(resp?.responsaveis.find((r) => r.id === responsavelId)?.nome ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [preset, responsavelId]);

  const { de, ate } = periodoDoPreset(preset);
  const receita = funil ? funil.porResponsavel.reduce((soma, d) => soma + d.receitaGanha, 0) : 0;
  const meses = preset === 'mes' ? 1 : preset === 'trimestre' ? 3 : null;
  const metaDeReceita = metas.receita_mensal !== undefined && meses !== null ? metas.receita_mensal * meses : null;
  const variacao = (atual: number | null, anterior: number | null | undefined) => {
    if (atual === null || anterior === null || anterior === undefined) return '—';
    const pp = (atual - anterior) * 100;
    return `${pp > 0 ? '+' : ''}${pp.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`;
  };

  return (
    <div className="p-space-md">
      <style>{`@media print { body * { visibility: hidden !important; } #relatorio-executivo, #relatorio-executivo * { visibility: visible !important; } #relatorio-executivo { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; } .nao-imprimir { display: none !important; } @page { size: A4; margin: 14mm; } }`}</style>

      <div className="nao-imprimir flex items-center justify-between gap-2 flex-wrap mb-space-md">
        <Link href="/indicadores" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
          Voltar para Indicadores
        </Link>
        <button type="button" onClick={() => window.print()} disabled={!kpis || !funil} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2 disabled:opacity-50">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">print</span>
          Imprimir / Salvar como PDF
        </button>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível montar o relatório. Tente de novo." onTentarDeNovo={() => window.location.reload()} />}
      {!erro && (!kpis || !funil) && <EsqueletoCarregando />}

      {kpis && funil && (
        <article id="relatorio-executivo" aria-label="Relatório Executivo" className="bg-surface-card rounded-2xl shadow-sm p-space-lg max-w-4xl mx-auto flex flex-col gap-space-md">
          <header className="flex items-start justify-between gap-3 border-b border-surface-container pb-3">
            <div>
              <p className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">MedCRM · Relatório Executivo</p>
              <h1 className="font-headline-lg text-headline-lg text-text-primary">Governança Comercial &amp; Funil de Vendas</h1>
              <p className="font-body-md text-body-md text-text-secondary">
                Período: {dataCompleta(de)} a {dataCompleta(ate)} ({ROTULO_DO_PRESET[preset]}) · {nomeDoResponsavel ?? (responsavelId ? 'Responsável filtrado' : 'Todos os responsáveis')}
              </p>
            </div>
            <p className="font-body-sm text-body-sm text-text-muted text-right shrink-0">
              Gerado em
              <br />
              {geradoEm.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </header>

          <section aria-label="Resumo de receita">
            <Titulo>Resumo</Titulo>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm">
              {[
                ['Novo MRR contratado', moeda(receita)],
                ['Meta de receita', metaDeReceita ? moeda(metaDeReceita) : '—'],
                ['Atingimento', metaDeReceita ? porcentagem(receita / metaDeReceita) : '—'],
                ['Contratos fechados', inteiro(funil.funil.ganhos)],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="rounded-xl bg-surface-subtle p-3">
                  <p className="font-label-sm text-label-sm text-text-muted uppercase">{rotulo}</p>
                  <p className="font-headline-md text-headline-md text-text-primary">{valor}</p>
                </div>
              ))}
            </div>
            {metas.receita_mensal !== undefined && meses === null && <p className="font-body-sm text-body-sm text-text-muted mt-1">A meta de receita é mensal: escolha &quot;Este mês&quot; ou &quot;Trimestre&quot; para compará-la.</p>}
          </section>

          <section aria-label="Indicadores vitais">
            <Titulo>7 Indicadores Vitais da Régua e Conversão</Titulo>
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead>
                <tr className="text-text-muted uppercase font-label-sm text-label-sm">
                  <th className="py-1">Indicador</th>
                  <th>Resultado</th>
                  <th>Base</th>
                  <th>Vs. período anterior</th>
                  <th>Meta</th>
                </tr>
              </thead>
              <tbody>
                {CARTOES.map((c) => {
                  const i = kpis[c.chave];
                  const meta = c.chave === 'conversao' ? metas.taxa_conversao : c.chave === 'noShow' ? metas.taxa_presenca : undefined;
                  const noAlvo = meta === undefined || i.valor === null ? null : c.chave === 'noShow' ? (1 - i.valor) * 100 >= meta : i.valor * 100 >= meta;
                  return (
                    <tr key={c.chave} className="border-t border-surface-container">
                      <td className="py-1.5 text-text-primary font-semibold">{c.titulo}</td>
                      <td>{i.valor === null ? 'Sem dados' : porcentagem(i.valor)}</td>
                      <td>{i.valor === null ? '—' : `${inteiro(i.numerador)} de ${inteiro(i.denominador)}`}</td>
                      <td>{variacao(i.valor, anteriores?.[c.chave].valor)}</td>
                      <td>{meta === undefined ? '—' : `${c.chave === 'noShow' ? 'presença ≥ ' : '≥ '}${meta.toLocaleString('pt-BR')}% · ${noAlvo ? 'no alvo' : 'abaixo'}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section aria-label="Funil de conversão">
            <Titulo>Funil de Conversão Comercial</Titulo>
            <table className="w-full text-left font-body-sm text-body-sm">
              <thead>
                <tr className="text-text-muted uppercase font-label-sm text-label-sm">
                  <th className="py-1">Etapa</th>
                  <th>Cards</th>
                  <th>% do topo</th>
                  <th>Retenção</th>
                  <th>Perda</th>
                </tr>
              </thead>
              <tbody>
                {ETAPAS_DO_FUNIL.map((e, i) => {
                  const q = funil.funil[e.chave];
                  const anterior = i > 0 ? funil.funil[ETAPAS_DO_FUNIL[i - 1].chave] : null;
                  const retencao = anterior === null ? null : razao(q, anterior);
                  return (
                    <tr key={e.chave} className="border-t border-surface-container">
                      <td className="py-1.5 text-text-primary font-semibold">{e.nome}</td>
                      <td>{inteiro(q)}</td>
                      <td>{porcentagem(razao(q, funil.funil.entrada))}</td>
                      <td>{retencao === null ? '—' : porcentagem(retencao)}</td>
                      <td>{retencao === null ? '—' : porcentagem(1 - retencao)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section aria-label="Desempenho por responsável">
            <Titulo>Desempenho por Closer e SDR</Titulo>
            {funil.porResponsavel.length === 0 ? (
              <p className="font-body-sm text-body-sm text-text-muted">Nenhum card neste período.</p>
            ) : (
              <table className="w-full text-left font-body-sm text-body-sm">
                <thead>
                  <tr className="text-text-muted uppercase font-label-sm text-label-sm">
                    <th className="py-1">Responsável</th>
                    <th>Cards</th>
                    <th>Régua</th>
                    <th>Demos</th>
                    <th>No-show</th>
                    <th>Propostas</th>
                    <th>Contratos</th>
                    <th>Win rate</th>
                    <th>Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {[...funil.porResponsavel]
                    .sort((a, b) => b.receitaGanha - a.receitaGanha)
                    .map((d) => (
                      <tr key={d.responsavelId ?? 'sem'} className="border-t border-surface-container">
                        <td className="py-1.5 text-text-primary font-semibold">{d.nome ?? 'Sem responsável'}</td>
                        <td>{inteiro(d.atendidos)}</td>
                        <td>{porcentagem(razao(d.cadenciaEsgotada, d.cadenciaIniciada))}</td>
                        <td>{inteiro(d.agendadas)}</td>
                        <td>{porcentagem(razao(d.noShows, d.agendadas))}</td>
                        <td>{inteiro(d.propostas)}</td>
                        <td>{inteiro(d.contratos)}</td>
                        <td>{porcentagem(d.winRate)}</td>
                        <td>{moeda(d.receitaGanha)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          {alertas && (
            <section aria-label="Alertas operacionais">
              <Titulo>Alertas operacionais (situação atual)</Titulo>
              <ul className="font-body-md text-body-md text-text-secondary list-disc pl-5">
                <li>
                  {alertas.propostasParadas.total === 0
                    ? 'Nenhuma proposta parada há mais de 48 horas.'
                    : `${inteiro(alertas.propostasParadas.total)} ${alertas.propostasParadas.total === 1 ? 'proposta parada' : 'propostas paradas'} há mais de 48 horas — ${moeda(alertas.propostasParadas.valor)} em pipeline sob risco.`}
                </li>
                <li>
                  {alertas.noShowsPendentes.total === 0
                    ? 'Nenhum no-show aguardando resgate.'
                    : `${inteiro(alertas.noShowsPendentes.total)} ${alertas.noShowsPendentes.total === 1 ? 'card em No-show' : 'cards em No-show'} sem reagendamento — ${moeda(alertas.noShowsPendentes.valor)} em pipeline.`}
                </li>
              </ul>
            </section>
          )}

          <footer className="border-t border-surface-container pt-2 font-body-sm text-body-sm text-text-muted">
            Os indicadores usam os cards criados no período (coorte) e os eventos de cada card; a variação compara com o período imediatamente anterior ({diaEMes(periodoAnterior(preset).de)} a {diaEMes(periodoAnterior(preset).ate)}).
          </footer>
        </article>
      )}
    </div>
  );
}
