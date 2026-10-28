'use client';

// T-183 (fase4-tarefas-agenda, US-120): tela "Controle de Atrasos e Toques
// Vencidos" — fonte visual `docs/ui/stitch_medcrm_interface_design/14._tarefas_atrasadas_toques_vencidos/`.
// Mesma fila da tela do turno (`GET /api/atividades?atrasados=1`), só os
// atrasados, com os indicadores de `GET /api/atividades/resumo` (AC-473).
// Filtros e ordenação rodam no navegador sobre a fila (AC-475); a
// reatribuição em lote reaproveita o diálogo e a rota do pipeline (AC-477).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { DialogoLote, type OpcaoDoDialogo } from '@/components/pipeline/lote/dialogo-lote';
import { ResultadoLote } from '@/components/pipeline/lote/resultado-lote';
import { MENSAGEM_DO_PEDIDO, type ResultadoDoLoteView } from '@/components/pipeline/lote/tipos';
import { ETAPAS_PIPELINE } from '@/components/pipeline/detalhe/jornada';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { useStreamOportunidades, type EventoStreamCliente } from '@/hooks/use-stream-oportunidades';
import { AvisoTempoReal } from '@/components/pipeline/pecas/aviso-tempo-real';
import {
  CANAL_LABEL,
  TIPO_LABEL,
  concluirToque,
  faixaDeAtraso,
  iniciais,
  minutosDeAtraso,
  moeda,
  ordenarFila,
  textoDoAtraso,
  type ItemDaFila,
  type ResultadoToque,
  type ResumoDoTurno,
} from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

type AtrasoMinimo = 'todos' | '60' | '240';
type Ordem = 'maior' | 'menor';

const COR_DA_FAIXA = {
  ate1h: 'bg-warning-surface text-warning-text',
  de1a4h: 'bg-warning-surface text-danger-text',
  mais4h: 'bg-danger-surface text-danger-text',
} as const;

export function TarefasAtrasadas() {
  const [itens, setItens] = useState<ItemDaFila[] | null>(null);
  const [resumo, setResumo] = useState<ResumoDoTurno | null>(null);
  const [agora, setAgora] = useState(0);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const envioRef = useRef(false);

  const [atraso, setAtraso] = useState<AtrasoMinimo>('todos');
  const [consultor, setConsultor] = useState('');
  const [etapa, setEtapa] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('maior');

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [podeReatribuir, setPodeReatribuir] = useState(false);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [responsaveis, setResponsaveis] = useState<OpcaoDoDialogo[]>([]);
  const [aplicando, setAplicando] = useState(false);
  const [erroDoLote, setErroDoLote] = useState<string | null>(null);
  const [resultadoDoLote, setResultadoDoLote] = useState<{ lote: ResultadoDoLoteView; nomes: Record<string, string> } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [fila, indicadores] = await Promise.all([fetch('/api/atividades?atrasados=1'), fetch('/api/atividades/resumo')]);
      if (!fila.ok) throw new Error(`fila respondeu ${fila.status}`);
      const corpo = (await fila.json()) as { itens: ItemDaFila[] };
      setItens((corpo.itens ?? []).filter((i) => i.atrasado));
      if (indicadores.ok) setResumo((await indicadores.json()) as ResumoDoTurno);
      setAgora(Date.now());
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (cancelado || !u) return;
        setPodeReatribuir(u.isSuperAdmin === true || u.papel === 'MASTER' || u.papel === 'GERENTE');
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  const aoReceberEvento = useCallback(
    (evento: EventoStreamCliente) => {
      if (evento.tipo === 'cadencia.fila_alterada' || evento.tipo === 'stream.reconectado') void carregar();
    },
    [carregar]
  );
  const { estadoConexao } = useStreamOportunidades({ aoReceberEvento, aoPolling: carregar });

  async function concluir(item: ItemDaFila, resultado: ResultadoToque) {
    if (envioRef.current) return;
    envioRef.current = true;
    setEnviando(true);
    setAviso(null);
    const r = await concluirToque(item, resultado);
    if (!r.ok) setAviso(r.mensagem);
    await carregar();
    envioRef.current = false;
    setEnviando(false);
  }

  const consultores = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const i of itens ?? []) if (i.responsavel) mapa.set(i.responsavel.id, i.responsavel.nome);
    return [...mapa.entries()];
  }, [itens]);

  const visiveis = useMemo(() => {
    const base = ordenarFila(itens ?? []).filter((i) => {
      const minutos = minutosDeAtraso(i.liberadaEm, agora);
      if (atraso !== 'todos' && minutos <= Number(atraso)) return false;
      if (consultor && i.responsavel?.id !== consultor) return false;
      if (etapa && String(i.oportunidade.etapaId) !== etapa) return false;
      return true;
    });
    // `ordenarFila` já põe o maior atraso (liberado há mais tempo) primeiro.
    return ordem === 'maior' ? base : [...base].reverse();
  }, [itens, agora, atraso, consultor, etapa, ordem]);

  function limpar() {
    setAtraso('todos');
    setConsultor('');
    setEtapa('');
    setOrdem('maior');
  }

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados((atual) => (visiveis.length > 0 && visiveis.every((i) => atual.has(i.atividade.id)) ? new Set() : new Set(visiveis.map((i) => i.atividade.id))));
  }

  /** Dois toques do mesmo card contam como um card (AC-477). */
  const cardsSelecionados = useMemo(() => {
    const ids = new Set<string>();
    for (const i of itens ?? []) if (selecionados.has(i.atividade.id)) ids.add(i.oportunidade.id);
    return [...ids];
  }, [itens, selecionados]);

  async function abrirReatribuicao() {
    setErroDoLote(null);
    setResultadoDoLote(null);
    setDialogoAberto(true);
    try {
      const r = await fetch('/api/pipeline/responsaveis');
      if (r.ok) setResponsaveis(((await r.json()) as { responsaveis: OpcaoDoDialogo[] }).responsaveis);
    } catch {
      setResponsaveis([]);
    }
  }

  async function reatribuir(responsavelId: string) {
    const nomes: Record<string, string> = {};
    for (const i of itens ?? []) nomes[i.oportunidade.id] = i.lead.nome;
    setAplicando(true);
    setErroDoLote(null);
    try {
      const r = await fetch('/api/oportunidades/lote/reatribuir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: cardsSelecionados, responsavelId }),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setErroDoLote(MENSAGEM_DO_PEDIDO[corpo?.codigo ?? ''] ?? 'Não foi possível reatribuir. Tente de novo.');
        return;
      }
      const lote = (await r.json()) as ResultadoDoLoteView;
      setDialogoAberto(false);
      setResultadoDoLote({ lote, nomes });
      setSelecionados(new Set());
      await carregar();
    } catch {
      setErroDoLote('Não foi possível reatribuir. Tente de novo.');
    } finally {
      setAplicando(false);
    }
  }

  const total = itens?.length ?? 0;

  return (
    <div className="p-space-md space-y-space-md">
      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-start justify-between flex-wrap gap-space-md">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Controle de Atrasos e Toques Vencidos</h1>
              <span className="px-2.5 py-1 rounded-full bg-danger-surface text-danger-text font-label-sm text-label-sm">
                {total} {total === 1 ? 'toque atrasado' : 'toques atrasados'}
              </span>
            </div>
            <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">
              Toques liberados em turnos anteriores e ainda não executados. A prioridade é o maior tempo de atraso.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <ItemEmBreve rotulo="Forçar Mutirão de Regularização" icone="bolt" className="h-10 px-4 rounded-xl bg-surface-subtle" />
            <button
              type="button"
              disabled={!podeReatribuir || cardsSelecionados.length === 0}
              onClick={abrirReatribuicao}
              title={podeReatribuir ? 'Marque os toques que serão reatribuídos' : 'Só MASTER e GERENTE reatribuem'}
              className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">swap_horiz</span>
              Reatribuir em Lote
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-label-md text-label-md text-text-secondary">
          <span className="uppercase tracking-wider text-text-muted font-label-sm">Filtrar por:</span>
          <select aria-label="Atraso" value={atraso} onChange={(e) => setAtraso(e.target.value as AtrasoMinimo)} className="h-9 px-2 rounded-lg bg-surface-subtle">
            <option value="todos">Atraso: Todos</option>
            <option value="60">Atraso: mais de 1 h</option>
            <option value="240">Atraso: mais de 4 h</option>
          </select>
          <select aria-label="Consultor" value={consultor} onChange={(e) => setConsultor(e.target.value)} className="h-9 px-2 rounded-lg bg-surface-subtle">
            <option value="">Consultor: Todos</option>
            {consultores.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
          <select aria-label="Etapa do funil" value={etapa} onChange={(e) => setEtapa(e.target.value)} className="h-9 px-2 rounded-lg bg-surface-subtle">
            <option value="">Etapa do funil: Todas</option>
            {ETAPAS_PIPELINE.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
          <select aria-label="Classificação" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="h-9 px-2 rounded-lg bg-surface-subtle">
            <option value="maior">Maior tempo de atraso</option>
            <option value="menor">Menor tempo de atraso</option>
          </select>
          <button type="button" onClick={limpar} className="h-9 px-3 rounded-lg text-text-muted hover:text-text-primary">
            Limpar
          </button>
        </div>
      </section>

      <AvisoTempoReal estadoConexao={estadoConexao} />

      {erro && <EstadoErro mensagem="Não foi possível carregar as tarefas atrasadas. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && itens === null && <EsqueletoCarregando />}
      {!erro && itens !== null && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
            <div className="bg-surface-card rounded-2xl p-space-md shadow-sm">
              <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Toques atrasados</span>
              <p className="font-metric-stat text-metric-stat text-danger-text">{resumo?.atrasados ?? total}</p>
            </div>
            <div className="bg-surface-card rounded-2xl p-space-md shadow-sm">
              <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Receita sob risco</span>
              <p className="font-metric-stat text-metric-stat text-text-primary">
                {moeda(resumo?.receitaSobRisco ?? 0)} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
              </p>
              <span className="font-body-sm text-body-sm text-text-muted">
                Ticket médio em risco: {resumo?.ticketMedio != null ? `${moeda(resumo.ticketMedio)} / card` : '—'}
              </span>
            </div>
            <div className="bg-surface-card rounded-2xl p-space-md shadow-sm">
              <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Maior tempo de atraso</span>
              <p className="font-metric-stat text-metric-stat text-danger-text">
                {resumo?.maiorAtraso ? textoDoAtraso(resumo.maiorAtraso.minutos) : '—'}
              </p>
              <span className="font-body-sm text-body-sm text-text-muted">{resumo?.maiorAtraso?.leadNome ?? ''}</span>
            </div>
          </div>

          {resultadoDoLote && (
            <ResultadoLote acao="reatribuir" lote={resultadoDoLote.lote} nomes={resultadoDoLote.nomes} onFechar={() => setResultadoDoLote(null)} />
          )}
          {aviso && (
            <p role="alert" className="text-sm text-danger-text">
              {aviso}
            </p>
          )}

          <section className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
            <div className="p-space-md flex items-center justify-between flex-wrap gap-space-sm">
              <div className="flex items-center gap-3">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Fila de Resgate Imediato</h2>
                <span className="font-body-sm text-body-sm text-text-muted">Exibindo {visiveis.length} contatos críticos</span>
              </div>
              <div className="flex items-center gap-2">
                <ItemEmBreve rotulo="Alertar Consultores" icone="notifications_active" className="h-9 px-3 rounded-lg bg-surface-subtle" />
                <ItemEmBreve rotulo="Exportar Auditoria" icone="download" className="h-9 px-3 rounded-lg bg-surface-subtle" />
              </div>
            </div>

            {visiveis.length === 0 ? (
              <EstadoVazio titulo="Nenhum toque atrasado" proximoPasso="Tudo em dia por aqui." icone="task_alt" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">
                        <input type="checkbox" aria-label="Marcar todos" checked={visiveis.every((i) => selecionados.has(i.atividade.id))} onChange={alternarTodos} />
                      </th>
                      <th className="px-space-md py-3">Tempo de atraso</th>
                      <th className="px-space-md py-3">Lead e responsável</th>
                      <th className="px-space-md py-3">Valor estimado</th>
                      <th className="px-space-md py-3">Toque &amp; canal</th>
                      <th className="px-space-md py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((item) => {
                      const minutos = minutosDeAtraso(item.liberadaEm, agora);
                      return (
                        <tr key={item.atividade.id} className="border-t border-surface-container">
                          <td className="px-space-md py-3">
                            <input
                              type="checkbox"
                              aria-label={`Marcar ${item.lead.nome}`}
                              checked={selecionados.has(item.atividade.id)}
                              onChange={() => alternar(item.atividade.id)}
                            />
                          </td>
                          <td className="px-space-md py-3">
                            <span className={`px-2.5 py-1 rounded-full font-label-md text-label-md ${COR_DA_FAIXA[faixaDeAtraso(minutos)]}`}>
                              {textoDoAtraso(minutos)} atrasado
                            </span>
                          </td>
                          <td className="px-space-md py-3">
                            <div className="flex items-center gap-3">
                              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary">
                                {iniciais(item.lead.nome)}
                              </span>
                              <div className="flex flex-col min-w-0">
                                <Link href={`/pipeline/${item.oportunidade.id}`} className="font-label-lg text-label-lg text-text-primary hover:text-primary truncate">
                                  {item.lead.nome}
                                </Link>
                                <span className="font-body-sm text-body-sm text-text-muted">
                                  {item.responsavel?.nome ?? 'Sem responsável'}
                                  {item.lead.telefoneE164 ? ` · ${item.lead.telefoneE164}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-space-md py-3 font-label-lg text-label-lg text-text-primary">
                            {moeda(item.oportunidade.valor)} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
                          </td>
                          <td className="px-space-md py-3 font-body-md text-body-md text-text-primary">
                            Toque #{item.atividade.sequencia} — {TIPO_LABEL[item.atividade.tipo]} · {CANAL_LABEL[item.atividade.canal]}
                          </td>
                          <td className="px-space-md py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={enviando}
                                aria-label={`Concluir com sucesso: ${item.lead.nome}`}
                                onClick={() => concluir(item, 'conectou')}
                                className="w-8 h-8 rounded-lg text-success-text hover:bg-success-surface disabled:opacity-50 flex items-center justify-center"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">check_circle</span>
                              </button>
                              <button
                                type="button"
                                disabled={enviando}
                                aria-label={`Não atendeu: ${item.lead.nome}`}
                                onClick={() => concluir(item, 'sem_resposta')}
                                className="w-8 h-8 rounded-lg text-danger-text hover:bg-danger-surface disabled:opacity-50 flex items-center justify-center"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">phone_missed</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-space-md py-3 flex items-center gap-2 flex-wrap font-body-sm text-body-sm text-text-muted">
              <span>Ações para os itens selecionados:</span>
              <button
                type="button"
                disabled={!podeReatribuir || cardsSelecionados.length === 0}
                onClick={abrirReatribuicao}
                className="h-8 px-3 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reatribuir em Lote ({cardsSelecionados.length})
              </button>
              <ItemEmBreve rotulo="Notificar Atraso Urgente" className="h-8 px-3 rounded-lg bg-surface-subtle" />
            </div>
          </section>
        </>
      )}

      {dialogoAberto && (
        <DialogoLote
          acao="reatribuir"
          quantidade={cardsSelecionados.length}
          opcoes={responsaveis}
          carregandoOpcoes={false}
          enviando={aplicando}
          erro={erroDoLote}
          onConfirmar={reatribuir}
          onFechar={() => setDialogoAberto(false)}
        />
      )}
    </div>
  );
}
