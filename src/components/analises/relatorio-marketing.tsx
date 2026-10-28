'use client';

// T-206 (fase4-analises, US-134): relatório "Marketing e Origem dos Leads" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/24._relatorios_marketing_e_tr_fego/`. Os dados vêm de
// `GET /api/relatorios/marketing` (leads criados no período, por origem). O sistema não
// tem investimento, custo nem mídia: CAC, ROAS, CPL e afins não aparecem (Q-057).
import { useCallback, useEffect, useState } from 'react';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { diaEMes, inteiro, moeda, periodoDoPreset, porcentagem, type Preset } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { FiltroPeriodo } from './filtro-periodo';
import { GraficoLinhas } from './grafico-linhas';

type Agrupamento = 'dia' | 'semana' | 'mes';

interface Dados {
  resumo: { leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null };
  agrupar: Agrupamento;
  serie: { inicio: string; leads: number; reunioes: number }[];
  porOrigem: { origem: string; leads: number; conectados: number; reunioesRealizadas: number; contratos: number; conversaoFinal: number | null; valorGanho: number }[];
  origens: string[];
}

const PRESETS: Preset[] = ['hoje', '7dias', '30dias', 'mes', 'trimestre'];
const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = { dia: 'Diário', semana: 'Semanal', mes: 'Mensal' };

function rotuloDoIntervalo(inicio: string, agrupar: Agrupamento): string {
  if (agrupar === 'mes') return `${inicio.slice(5, 7)}/${inicio.slice(0, 4)}`;
  return agrupar === 'semana' ? `Sem ${diaEMes(inicio)}` : diaEMes(inicio);
}

export function RelatorioMarketing() {
  const [preset, setPreset] = useState<Preset>('30dias');
  const [origem, setOrigem] = useState('');
  const [agrupar, setAgrupar] = useState<Agrupamento | ''>('');
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    const { de, ate } = periodoDoPreset(preset);
    const q = new URLSearchParams({ de, ate });
    if (origem) q.set('origem', origem);
    if (agrupar) q.set('agrupar', agrupar);
    try {
      const r = await fetch(`/api/relatorios/marketing?${q}`);
      if (!r.ok) throw new Error(`marketing respondeu ${r.status}`);
      setDados((await r.json()) as Dados);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [preset, origem, agrupar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const totais = dados?.porOrigem.reduce(
    (t, l) => ({ leads: t.leads + l.leads, conectados: t.conectados + l.conectados, realizadas: t.realizadas + l.reunioesRealizadas, contratos: t.contratos + l.contratos, valor: t.valor + l.valorGanho }),
    { leads: 0, conectados: 0, realizadas: 0, contratos: 0, valor: 0 }
  );

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Relatórios de Marketing e Origem dos Leads</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">De onde vêm os leads e quantos viram conexão, reunião e contrato.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button type="button" onClick={() => void carregar()} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary">
            Atualizar
          </button>
          <ItemEmBreve rotulo="Exportar Relatório Completo (CSV/PDF)" icone="download" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
        </div>
      </div>

      <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-space-sm flex-wrap">
        <FiltroPeriodo valor={preset} presets={PRESETS} onMudar={setPreset} />
        <select aria-label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
          <option value="">Todas as origens</option>
          {(dados?.origens ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
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
            <CartaoIndicador titulo="Leads captados" valor={inteiro(dados.resumo.leads)} legenda="criados no período" icone="person_add" />
            <CartaoIndicador titulo="Leads conectados" valor={inteiro(dados.resumo.conectados)} legenda="com conexão efetiva" icone="call" cor="info" />
            <CartaoIndicador titulo="Reuniões realizadas" valor={inteiro(dados.resumo.reunioesRealizadas)} legenda="demonstrações concluídas" icone="event_available" cor="warning" />
            <CartaoIndicador titulo="Contratos fechados" valor={inteiro(dados.resumo.contratos)} legenda={`${porcentagem(dados.resumo.conversaoFinal)} dos leads`} icone="handshake" cor="success" />
          </div>

          <section aria-label="Aquisição de Leads e Conversão por Período" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Aquisição de Leads e Conversão por Período</h2>
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
          </section>

          <section aria-label="Desempenho por Origem" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
            <h2 className="p-space-md font-headline-sm text-headline-sm text-text-primary">Desempenho por Origem dos Leads</h2>
            {dados.porOrigem.length === 0 ? (
              <EstadoVazio titulo="Nenhum lead neste período" proximoPasso="escolha outro período ou cadastre leads" icone="person_search" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Origem</th>
                      <th className="px-space-md py-3">Leads</th>
                      <th className="px-space-md py-3">Conectados</th>
                      <th className="px-space-md py-3">Reuniões realizadas</th>
                      <th className="px-space-md py-3">Contratos</th>
                      <th className="px-space-md py-3">Conversão final</th>
                      <th className="px-space-md py-3">Valor ganho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.porOrigem.map((l) => (
                      <tr key={l.origem} className="border-t border-surface-container">
                        <td className="px-space-md py-3 font-label-lg text-label-lg text-text-primary">{l.origem}</td>
                        <td className="px-space-md py-3">{inteiro(l.leads)}</td>
                        <td className="px-space-md py-3">{inteiro(l.conectados)}</td>
                        <td className="px-space-md py-3">{inteiro(l.reunioesRealizadas)}</td>
                        <td className="px-space-md py-3">{inteiro(l.contratos)}</td>
                        <td className="px-space-md py-3">{porcentagem(l.conversaoFinal)}</td>
                        <td className="px-space-md py-3">{moeda(l.valorGanho)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {totais && (
                    <tfoot>
                      <tr className="border-t border-surface-container bg-surface-subtle font-label-lg text-label-lg">
                        <td className="px-space-md py-3">Totais consolidados</td>
                        <td className="px-space-md py-3">{inteiro(totais.leads)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.conectados)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.realizadas)}</td>
                        <td className="px-space-md py-3">{inteiro(totais.contratos)}</td>
                        <td className="px-space-md py-3">{porcentagem(totais.leads > 0 ? totais.contratos / totais.leads : null)}</td>
                        <td className="px-space-md py-3">{moeda(totais.valor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
