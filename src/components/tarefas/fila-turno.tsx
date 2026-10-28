'use client';

// T-182 (fase4-tarefas-agenda, US-119): tela "Fila do Turno Operacional" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/13._tarefas_fila_do_turno_atual/`.
// Dados: `GET /api/atividades?atrasados=1` (fila, AC-469), `GET
// /api/atividades/resumo` (indicadores, AC-462) e, para MASTER/GERENTE, o
// filtro por responsável (AC-468). Tempo real pelo mesmo fluxo da fila antiga
// (`cadencia.fila_alterada`, AC-470). Busca e paginação rodam no navegador
// sobre a fila (AC-467), que já vem toda do servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import { AvisoTempoReal } from '@/components/pipeline/pecas/aviso-tempo-real';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { SeloEtapa } from '@/components/pipeline/pecas/selo-etapa';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { podeLiberar } from '@/domain/cadencia/feriados';
import { turnoVigente } from '@/domain/cadencia/turno';
import { useStreamOportunidades, type EventoStreamCliente } from '@/hooks/use-stream-oportunidades';
import {
  CANAL_LABEL,
  TIPO_LABEL,
  concluirToque,
  horaLocal,
  iniciais,
  nomeEtapa,
  ordenarFila,
  type ItemDaFila,
  type ResultadoToque,
  type ResumoDoTurno,
} from './comum';
import { DestaqueTarefa } from './destaque-tarefa';
import { EsqueletoCarregando, EstadoErro } from './estados';
import { IndicadoresTurno } from './indicadores-turno';

const POR_PAGINA = 10;

function seloDoTurno(agora: Date): string {
  const turno = podeLiberar(agora) ? turnoVigente(agora) : null;
  if (turno === 'manha') return 'Turno Manhã em andamento (08h00 – 12h00)';
  if (turno === 'tarde') return 'Turno Tarde em andamento (13h00 – 18h00)';
  return 'Fora do horário de atendimento';
}

export function FilaTurno() {
  const [itens, setItens] = useState<ItemDaFila[] | null>(null);
  const [resumo, setResumo] = useState<ResumoDoTurno | null>(null);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const envioRef = useRef(false);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [responsavelId, setResponsavelId] = useState('');
  const [podeFiltrar, setPodeFiltrar] = useState(false);
  const [responsaveis, setResponsaveis] = useState<{ id: string; nome: string }[]>([]);
  const [agora] = useState(() => new Date());

  const carregar = useCallback(async () => {
    const filtro = responsavelId ? `&responsavelId=${responsavelId}` : '';
    try {
      const [fila, indicadores] = await Promise.all([
        fetch(`/api/atividades?atrasados=1${filtro}`),
        fetch(`/api/atividades/resumo${filtro ? `?${filtro.slice(1)}` : ''}`),
      ]);
      if (!fila.ok) throw new Error(`fila respondeu ${fila.status}`);
      setItens(((await fila.json()) as { itens: ItemDaFila[] }).itens ?? []);
      if (indicadores.ok) setResumo((await indicadores.json()) as ResumoDoTurno);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [responsavelId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // AC-468: só MASTER/GERENTE (ou super admin) veem o filtro por responsável.
  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (usuario: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (cancelado || !usuario) return;
        const gerente = usuario.isSuperAdmin === true || usuario.papel === 'MASTER' || usuario.papel === 'GERENTE';
        setPodeFiltrar(gerente);
        if (!gerente) return;
        const r = await fetch('/api/pipeline/responsaveis');
        if (r.ok && !cancelado) setResponsaveis(((await r.json()) as { responsaveis: { id: string; nome: string }[] }).responsaveis);
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

  const fila = useMemo(() => ordenarFila(itens ?? []), [itens]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? fila.filter((i) => i.lead.nome.toLowerCase().includes(termo)) : fila;
  }, [fila, busca]);
  const paginaAtual = Math.min(pagina, Math.max(1, Math.ceil(filtrados.length / POR_PAGINA)));
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Fila do Turno Operacional</h1>
          <span className="inline-flex mt-2 px-3 py-1 rounded-full bg-info-surface text-info-text font-label-md text-label-md">
            {seloDoTurno(agora)}
          </span>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {podeFiltrar && (
            <label className="flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md text-text-primary">
              Responsável
              <select
                value={responsavelId}
                onChange={(e) => {
                  setResponsavelId(e.target.value);
                  setPagina(1);
                }}
                className="bg-transparent focus:outline-none"
              >
                <option value="">Todos</option>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="h-10 px-3 rounded-xl bg-surface-card shadow-sm flex items-center font-label-md text-label-md text-primary font-semibold">
            Lista Corrida
          </span>
          <ItemEmBreve rotulo="Bloco de 3 Toques" icone="grid_view" className="h-10 px-3 rounded-xl bg-surface-card shadow-sm" />
          <ItemEmBreve rotulo="Iniciar Próxima Ação (Play)" icone="play_arrow" className="h-10 px-3 rounded-xl bg-surface-card shadow-sm" />
        </div>
      </div>

      <AvisoTempoReal estadoConexao={estadoConexao} />

      {erro && <EstadoErro mensagem="Não foi possível carregar a fila. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && itens === null && <EsqueletoCarregando />}
      {!erro && itens !== null && (
        <>
          {resumo && <IndicadoresTurno resumo={resumo} />}
          {aviso && (
            <p role="alert" className="text-sm text-danger-text">
              {aviso}
            </p>
          )}
          <DestaqueTarefa item={fila[0] ?? null} enviando={enviando} onConcluir={concluir} />

          <section className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
            <div className="p-space-md flex items-center justify-between flex-wrap gap-space-sm">
              <div className="flex items-center gap-3">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Fila Ordenada do Turno</h2>
                <span className="px-2.5 py-1 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">
                  {fila.length} pendentes
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="search"
                  aria-label="Filtrar nesta lista"
                  placeholder="Filtrar nesta lista..."
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setPagina(1);
                  }}
                  className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md focus:outline-none"
                />
                <ItemEmBreve rotulo="Exportar fila" icone="download" />
              </div>
            </div>

            {filtrados.length === 0 ? (
              fila.length === 0 && (
                <p className="px-space-md pb-space-md font-body-md text-body-md text-text-secondary">Nenhum toque pendente neste turno.</p>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Horário</th>
                      <th className="px-space-md py-3">Lead</th>
                      <th className="px-space-md py-3">Etapa no pipeline</th>
                      <th className="px-space-md py-3">Toque &amp; canal</th>
                      <th className="px-space-md py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((item) => (
                      <tr key={item.atividade.id} className="border-t border-surface-container">
                        <td className="px-space-md py-3 font-label-md text-label-md text-primary">
                          {horaLocal(item.liberadaEm)}
                          {item.atrasado && (
                            <span className="ml-2 text-[10px] font-bold uppercase text-danger-text bg-danger-surface rounded-full px-2 py-0.5">
                              Atrasado
                            </span>
                          )}
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
                              <span className="font-body-sm text-body-sm text-text-muted">{item.responsavel?.nome ?? 'Sem responsável'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-space-md py-3">
                          <SeloEtapa nome={nomeEtapa(item.oportunidade.etapaId)} />
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
                            <Link
                              href={`/pipeline/${item.oportunidade.id}`}
                              aria-label={`Abrir o card de ${item.lead.nome}`}
                              className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-subtle flex items-center justify-center"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">open_in_new</span>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Paginacao pagina={paginaAtual} porPagina={POR_PAGINA} total={filtrados.length} onMudarPagina={setPagina} rotuloItem="toques" />
          </section>
        </>
      )}
    </div>
  );
}
