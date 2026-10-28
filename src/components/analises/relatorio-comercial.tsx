'use client';

// T-207 (fase4-analises, US-135): relatório "Comercial e Vendas" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/25._relatorios_comerciais_comercial_e_vendas/`. Os
// dados vêm de `GET /api/relatorios/comercial` (eventos do histórico no período). Meta de
// MRR, especialidade e descontos não existem no sistema e não aparecem (Q-058).
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { diaEMes, inteiro, moeda, periodoDoPreset, porcentagem, type Preset, type Responsavel } from './comum';
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
}
interface Dados {
  resumo: {
    mrrNovo: number;
    contratos: number;
    ticketMedio: number | null;
    pipelineEmNegociacao: { valor: number; propostas: number };
    cicloMedioDias: number | null;
    winRate: { valor: number | null; ganhos: number; perdas: number };
  };
  semanal: { inicio: string; valorFechado: number; pipelineCriado: number }[];
  ranking: Linha[];
  motivosPerda: { motivo: string; quantidade: number; percentual: number }[];
  totalPerdas: number;
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

export function RelatorioComercial() {
  const [preset, setPreset] = useState<Preset>('mes');
  const [responsavelId, setResponsavelId] = useState('');
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [ordem, setOrdem] = useState<Ordem>('valor');
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDoPreset(preset);
    const q = new URLSearchParams({ de, ate });
    if (responsavelId) q.set('responsavelId', responsavelId);
    try {
      const r = await fetch(`/api/relatorios/comercial?${q}`);
      if (!r.ok) throw new Error(`comercial respondeu ${r.status}`);
      setDados((await r.json()) as Dados);
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

  const ranking = useMemo(() => (dados ? ordenar(dados.ranking, ordem) : []), [dados, ordem]);
  const totais = useMemo(() => {
    const t = { reunioes: 0, propostas: 0, contratos: 0, perdas: 0, valor: 0 };
    for (const l of dados?.ranking ?? []) {
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

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Relatórios Comerciais e Produtividade de Vendas</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">Receita fechada, pipeline em negociação, ciclo de venda e desempenho da equipe comercial.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Exportar Dados (CSV/XLSX)" icone="download" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          <ItemEmBreve rotulo="Configurar Metas de Vendas" icone="tune" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
        </div>
      </div>

      <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-space-sm flex-wrap">
        <FiltroPeriodo valor={preset} presets={PRESETS} onMudar={setPreset} />
        <select aria-label="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
          <option value="">Todos os Closers e SDRs</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
        <ItemEmBreve rotulo="Filtrar por especialidade" icone="stethoscope" className="h-10 px-3 rounded-xl bg-surface-subtle" />
      </section>

      {erro && <EstadoErro mensagem="Não foi possível carregar o relatório. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}
      {dados && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
            <CartaoIndicador
              titulo="Novo MRR contratado"
              valor={moeda(dados.resumo.mrrNovo)}
              legenda={`/mês · ${inteiro(dados.resumo.contratos)} contratos · ticket médio ${moeda(dados.resumo.ticketMedio)}`}
              icone="payments"
              cor="success"
            />
            <CartaoIndicador titulo="Pipeline em negociação" valor={moeda(dados.resumo.pipelineEmNegociacao.valor)} legenda={`${inteiro(dados.resumo.pipelineEmNegociacao.propostas)} propostas`} icone="request_quote" cor="info" />
            <CartaoIndicador titulo="Ciclo médio" valor={dados.resumo.cicloMedioDias === null ? '—' : `${dados.resumo.cicloMedioDias.toLocaleString('pt-BR')} dias`} legenda="da criação ao contrato" icone="schedule" cor="warning" />
            <CartaoIndicador
              titulo="Win rate"
              valor={porcentagem(dados.resumo.winRate.valor)}
              legenda={`${inteiro(dados.resumo.winRate.ganhos)} ganhos · ${inteiro(dados.resumo.winRate.perdas)} perdas`}
              icone="emoji_events"
              cor="primary"
            />
          </div>

          <section aria-label="Evolução Semanal de Receita Ganha vs Pipeline Criado" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Evolução Semanal de Receita Ganha vs Pipeline Criado</h2>
            <GraficoLinhas
              titulo="Valor fechado e valor de propostas geradas por semana"
              rotulos={dados.semanal.map((s) => `Sem ${diaEMes(s.inicio)}`)}
              series={[
                { nome: 'Novo MRR assinado (R$)', corTraco: 'stroke-primary', corLegenda: 'bg-primary', valores: dados.semanal.map((s) => s.valorFechado) },
                { nome: 'Propostas geradas (R$)', corTraco: 'stroke-warning-text', corLegenda: 'bg-warning-text', valores: dados.semanal.map((s) => s.pipelineCriado) },
              ]}
              formatarValor={(v) => moeda(v)}
            />
          </section>

          <section aria-label="Ranking da Equipe Comercial" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Ranking e Performance Individual da Equipe Comercial</h2>
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
                      <th className="px-space-md py-3">Responsável</th>
                      <th className="px-space-md py-3">Reuniões</th>
                      <th className="px-space-md py-3">Propostas</th>
                      <th className="px-space-md py-3">Contratos</th>
                      <th className="px-space-md py-3">Win rate</th>
                      <th className="px-space-md py-3">Ciclo médio</th>
                      <th className="px-space-md py-3">Ticket médio</th>
                      <th className="px-space-md py-3">Valor fechado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((l) => (
                      <tr key={l.responsavelId ?? 'sem-responsavel'} className="border-t border-surface-container">
                        <td className="px-space-md py-3 font-label-lg text-label-lg text-text-primary">{l.nome ?? 'Sem responsável'}</td>
                        <td className="px-space-md py-3">{inteiro(l.reunioesRealizadas)}</td>
                        <td className="px-space-md py-3">{inteiro(l.propostas)}</td>
                        <td className="px-space-md py-3">{inteiro(l.contratos)}</td>
                        <td className="px-space-md py-3">{porcentagem(l.winRate)}</td>
                        <td className="px-space-md py-3">{l.cicloMedioDias === null ? '—' : `${l.cicloMedioDias.toLocaleString('pt-BR')} dias`}</td>
                        <td className="px-space-md py-3">{moeda(l.ticketMedio)}</td>
                        <td className="px-space-md py-3 font-label-lg text-label-lg">{moeda(l.valorFechado)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-surface-container bg-surface-subtle font-label-lg text-label-lg">
                      <td className="px-space-md py-3">Totais consolidados</td>
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

          <section aria-label="Motivos de Perda no Ciclo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Motivos de Perda no Ciclo</h2>
              <span className="px-2.5 py-1 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm">{inteiro(dados.totalPerdas)} {dados.totalPerdas === 1 ? 'perda' : 'perdas'}</span>
            </div>
            {motivos.length === 0 && <p className="font-body-md text-body-md text-text-secondary">Nenhuma perda no período</p>}
            <ol className="flex flex-col gap-3">
              {motivos.map((m) => (
                <li key={m.motivo} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 font-label-md text-label-md text-text-primary">
                    <span>{m.motivo}</span>
                    <span>
                      {inteiro(m.quantidade)} ({m.percentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                    <div className="h-full bg-danger-text" style={{ width: `${m.percentual}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
