'use client';

// T-205 (fase4-analises, US-133): tela "Indicadores de Governança Comercial & Funil de
// Vendas" — fonte visual `docs/ui/stitch_medcrm_interface_design/23._indicadores_funil_comercial_e_governan_a/`.
// Os 7 indicadores vêm de `GET /api/relatorios/kpis`; o funil por etapa e o desempenho
// por responsável vêm de `GET /api/relatorios/funil` (mesma coorte). Metas, comparação
// com o mês anterior e alertas não existem no sistema e não aparecem (Q-058).
import { useCallback, useEffect, useState } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { iniciais, inteiro, moeda, porcentagem, type Preset, type Responsavel, periodoDoPreset } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { FiltroPeriodo } from './filtro-periodo';

interface Indicador {
  valor: number | null;
  numerador: number;
  denominador: number;
}
interface Kpis {
  conexao: Indicador;
  cumprimentoCadencia: Indicador;
  agendamento: Indicador;
  noShow: Indicador;
  proposta: Indicador;
  ativacaoTrial: Indicador;
  conversao: Indicador;
}
interface Funil {
  entrada: number;
  conectados: number;
  agendadas: number;
  realizadas: number;
  propostas: number;
  ganhos: number;
}
interface Desempenho {
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

const CARTOES: { chave: keyof Kpis; pilar: string; titulo: string }[] = [
  { chave: 'conexao', pilar: 'Pilar 01 · Contato', titulo: 'Taxa de Conexão' },
  { chave: 'cumprimentoCadencia', pilar: 'Pilar 02 · Cadência', titulo: 'Régua de 18 Toques' },
  { chave: 'agendamento', pilar: 'Pilar 03 · Demos', titulo: 'Agendamento' },
  { chave: 'noShow', pilar: 'Pilar 04 · Faltas', titulo: 'Taxa de No-Show' },
  { chave: 'proposta', pilar: 'Pilar 05 · Propostas', titulo: 'Envio de Proposta' },
  { chave: 'ativacaoTrial', pilar: 'Pilar 06 · Trial', titulo: 'Ativação em Trial' },
  { chave: 'conversao', pilar: 'Pilar 07 · Win rate', titulo: 'Conversão Final' },
];

const ETAPAS_DO_FUNIL: { chave: keyof Funil; nome: string }[] = [
  { chave: 'entrada', nome: 'Entrada de Leads' },
  { chave: 'conectados', nome: 'Conexão Efetiva' },
  { chave: 'agendadas', nome: 'Demo Agendada' },
  { chave: 'realizadas', nome: 'Demo Realizada' },
  { chave: 'propostas', nome: 'Proposta Enviada' },
  { chave: 'ganhos', nome: 'Contrato Assinado' },
];

const razao = (parte: number, total: number): number | null => (total > 0 ? parte / total : null);

export function IndicadoresFunil() {
  const [preset, setPreset] = useState<Preset>('mes');
  const [responsavelId, setResponsavelId] = useState('');
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [funil, setFunil] = useState<{ funil: Funil; porResponsavel: Desempenho[] } | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDoPreset(preset);
    const q = new URLSearchParams({ de, ate });
    if (responsavelId) q.set('responsavelId', responsavelId);
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

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
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
          <button type="button" onClick={() => void carregar()} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary">
            Atualizar Métricas
          </button>
          <ItemEmBreve rotulo="Relatório Executivo" icone="summarize" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
        </div>
      </div>

      {erro && (
        <EstadoErro mensagem="Não foi possível carregar os indicadores. Tente de novo." onTentarDeNovo={carregar} />
      )}
      {!erro && (!kpis || !funil) && <EsqueletoCarregando />}
      {kpis && funil && (
        <>
          <section aria-label="Indicadores vitais" className="flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">7 Indicadores Vitais da Régua e Conversão</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
              {CARTOES.map((c) => {
                const i = kpis[c.chave];
                const semDados = i.valor === null;
                return (
                  <article key={c.chave} aria-label={c.titulo} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1">
                    <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{c.pilar}</span>
                    <h3 className="font-label-lg text-label-lg text-text-secondary">{c.titulo}</h3>
                    <p className="font-metric-stat text-metric-stat text-text-primary">{semDados ? 'Sem dados' : porcentagem(i.valor)}</p>
                    <p className="font-body-sm text-body-sm text-text-muted">{semDados ? (c.chave === 'ativacaoTrial' ? 'Ainda sem fonte de dados' : 'Nenhum card na base') : `${inteiro(i.numerador)} de ${inteiro(i.denominador)}`}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-label="Funil de Conversão Comercial Contínuo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Funil de Conversão Comercial Contínuo</h2>
            <ol className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-6 gap-space-sm">
              {ETAPAS_DO_FUNIL.map((e, i) => {
                const quantidade = funil.funil[e.chave];
                const anterior = i > 0 ? funil.funil[ETAPAS_DO_FUNIL[i - 1].chave] : null;
                const retencao = anterior === null ? null : razao(quantidade, anterior);
                return (
                  <li key={e.chave} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                    <span className="font-label-sm text-label-sm text-text-muted uppercase">Etapa {String(i + 1).padStart(2, '0')}</span>
                    <span className="font-label-lg text-label-lg text-text-primary">{e.nome}</span>
                    <span className="font-headline-md text-headline-md text-text-primary">{inteiro(quantidade)}</span>
                    {anterior !== null && (
                      <span className="font-body-sm text-body-sm text-text-muted">
                        {retencao === null ? 'Retenção — · Perda —' : `Retenção ${porcentagem(retencao)} · Perda ${porcentagem(1 - retencao)}`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-label="Desempenho por Responsável" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
            <div className="p-space-md flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Desempenho por Closer e SDR</h2>
              <span className="flex items-center gap-2">
                <ItemEmBreve rotulo="Exportar CSV" icone="download" className="h-9 px-3 rounded-lg bg-surface-subtle" />
                <ItemEmBreve rotulo="Configurar Metas" icone="tune" className="h-9 px-3 rounded-lg bg-surface-subtle" />
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
                        <th className="px-space-md py-3">Responsável</th>
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
                      {funil.porResponsavel.map((d) => (
                        <tr key={d.responsavelId ?? 'sem-responsavel'} className="border-t border-surface-container">
                          <td className="px-space-md py-3">
                            <div className="flex items-center gap-3">
                              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary">
                                {iniciais(d.nome ?? 'Sem responsável')}
                              </span>
                              <div className="flex flex-col">
                                <span className="font-label-lg text-label-lg text-text-primary">{d.nome ?? 'Sem responsável'}</span>
                                {d.papel && <span className="font-body-sm text-body-sm text-text-muted">{d.papel}</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-space-md py-3">{inteiro(d.atendidos)}</td>
                          <td className="px-space-md py-3">{porcentagem(razao(d.cadenciaEsgotada, d.cadenciaIniciada))}</td>
                          <td className="px-space-md py-3">{inteiro(d.agendadas)}</td>
                          <td className="px-space-md py-3">{porcentagem(razao(d.noShows, d.agendadas))}</td>
                          <td className="px-space-md py-3">{inteiro(d.propostas)}</td>
                          <td className="px-space-md py-3">{inteiro(d.contratos)}</td>
                          <td className="px-space-md py-3">{porcentagem(d.winRate)}</td>
                          <td className="px-space-md py-3 font-label-lg text-label-lg">{moeda(d.receitaGanha)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-space-md py-3 font-body-sm text-body-sm text-text-muted">Mostrando {funil.porResponsavel.length} {funil.porResponsavel.length === 1 ? 'responsável' : 'responsáveis'}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
