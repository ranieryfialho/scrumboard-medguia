'use client';

// T-186 (fase4-tarefas-agenda, US-121): tela "Agenda de Reuniões Comerciais e
// No-Show" — fonte visual `docs/ui/stitch_medcrm_interface_design/15._agenda_calend_rio_e_gest_o_de_no_show/`.
// Pede ao servidor só o período visível (AC-484) e, à parte, o dia de hoje (fila
// de hoje) e os indicadores da semana (AC-483). Relê tudo quando o funil muda
// (`oportunidade.movida`, AC-495) ou o tempo real reconecta.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AvisoTempoReal } from '@/components/pipeline/pecas/aviso-tempo-real';
import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { descreverMeta } from '@/lib/metas/catalogo';
import { useMetas } from '@/lib/metas/usar-metas';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { EsqueletoCarregando, EstadoErro } from '@/components/pipeline/pecas/estados';
import { useStreamOportunidades, type EventoStreamCliente } from '@/hooks/use-stream-oportunidades';
import { STATUS_DE_REUNIAO, ROTULO_DO_STATUS, type StatusReuniao } from '@/lib/reunioes/status';
import { registrarNoShow, type ResultadoAcaoAgenda } from './acoes-reuniao';
import { CartaoReuniao, type AcoesDaReuniao } from './cartao-reuniao';
import { diaDe, navegar, periodoDaVisao, rotuloDoPeriodo } from './datas';
import { LateralAgenda } from './lateral-agenda';
import { ModalAgendar, ModalConcluir, ModalReagendar } from './modais';
import type { ReuniaoView, ResumoAgendaView, VisaoAgenda } from './tipos';
import { VisaoDia, VisaoLista, VisaoMes, VisaoSemana } from './visoes';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const ROTULO_DA_VISAO: Record<VisaoAgenda, string> = { mes: 'Mês', semana: 'Semana', dia: 'Dia', lista: 'Lista' };

type Modal = { tipo: 'agendar' } | { tipo: 'reagendar'; reuniao: { id: string; leadNome: string } } | { tipo: 'concluir'; reuniao: ReuniaoView };

export function AgendaTela() {
  const metas = useMetas();
  const [visao, setVisao] = useState<VisaoAgenda>('semana');
  const [hoje] = useState(() => diaDe(new Date()));
  const [referencia, setReferencia] = useState(hoje);
  const [closerId, setCloserId] = useState('');
  const [status, setStatus] = useState<StatusReuniao | ''>('');
  const [reunioes, setReunioes] = useState<ReuniaoView[] | null>(null);
  const [reunioesHoje, setReunioesHoje] = useState<ReuniaoView[]>([]);
  const [resumo, setResumo] = useState<ResumoAgendaView | null>(null);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [podeFiltrar, setPodeFiltrar] = useState(false);
  const [closers, setClosers] = useState<{ id: string; nome: string }[]>([]);

  const periodo = useMemo(() => periodoDaVisao(visao, referencia), [visao, referencia]);

  const carregar = useCallback(async () => {
    const filtros = `${closerId ? `&closerId=${closerId}` : ''}${status ? `&status=${status}` : ''}`;
    try {
      const [doDia, lista, indicadores] = await Promise.all([
        fetch(`/api/reunioes?de=${hoje}&ate=${hoje}${filtros}`),
        fetch(`/api/reunioes?de=${periodo.de}&ate=${periodo.ate}${filtros}`),
        fetch('/api/reunioes/resumo'),
      ]);
      if (!lista.ok) throw new Error(`agenda respondeu ${lista.status}`);
      setReunioes(((await lista.json()) as { reunioes: ReuniaoView[] }).reunioes);
      if (doDia.ok) setReunioesHoje(((await doDia.json()) as { reunioes: ReuniaoView[] }).reunioes);
      if (indicadores.ok) setResumo((await indicadores.json()) as ResumoAgendaView);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [periodo, hoje, closerId, status]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (u: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (cancelado || !u) return;
        const gerente = u.isSuperAdmin === true || u.papel === 'MASTER' || u.papel === 'GERENTE';
        setPodeFiltrar(gerente);
        if (!gerente) return;
        const r = await fetch('/api/pipeline/responsaveis');
        if (r.ok && !cancelado) setClosers(((await r.json()) as { responsaveis: { id: string; nome: string }[] }).responsaveis);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  // AC-495: o funil mudou (agendar, no-show, concluir, reagendar) → a agenda relê o período visível.
  const aoReceberEvento = useCallback(
    (evento: EventoStreamCliente) => {
      if (evento.tipo === 'oportunidade.movida' || evento.tipo === 'stream.reconectado') void carregar();
    },
    [carregar]
  );
  const { estadoConexao } = useStreamOportunidades({ aoReceberEvento, aoPolling: carregar });

  async function aposAcao(r: ResultadoAcaoAgenda) {
    if (!r.ok) setAviso(r.mensagem);
    await carregar();
  }

  const acoes: AcoesDaReuniao = {
    onNoShow: async (r) => {
      setOcupado(true);
      setAviso(null);
      await aposAcao(await registrarNoShow(r.id));
      setOcupado(false);
    },
    onConcluir: (r) => setModal({ tipo: 'concluir', reuniao: r }),
    onReagendar: (r) => setModal({ tipo: 'reagendar', reuniao: { id: r.id, leadNome: r.lead.nome } }),
  };

  function fecharModalERecarregar() {
    setModal(null);
    void carregar();
  }

  function limpar() {
    setCloserId('');
    setStatus('');
  }

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Agenda de Reuniões Comerciais e No-Show</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-xl">
            Reuniões de demonstração e alinhamento, com o resultado de cada uma e o acompanhamento dos no-shows.
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Google Meet / Outlook" icone="sync" className="h-10 px-3 rounded-xl bg-surface-card shadow-sm" />
          <button
            type="button"
            onClick={() => setModal({ tipo: 'agendar' })}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
              add
            </span>
            Agendar Reunião
          </button>
        </div>
      </div>

      <AvisoTempoReal estadoConexao={estadoConexao} />

      {resumo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
          <CartaoIndicador
            titulo="Reuniões agendadas hoje"
            valor={String(resumo.hoje.total)}
            legenda={`${resumo.hoje.emAndamentoOuPorVir} em andamento / próximas`}
            icone="event"
          />
          <CartaoIndicador
            titulo="Taxa de presença"
            valor={resumo.presenca.taxa === null ? '—' : `${resumo.presenca.taxa}%`}
            legenda={`${resumo.presenca.realizadas} realizadas na semana`}
            icone="how_to_reg"
            cor="success"
            meta={descreverMeta(resumo.presenca.taxa, metas.taxa_presenca)}
          />
          <CartaoIndicador
            titulo="Ocorrências de no-show"
            valor={String(resumo.noShow.quantidade)}
            legenda={resumo.noShow.percentual === null ? 'Sem reuniões com resultado na semana' : `${resumo.noShow.percentual}% na semana`}
            icone="person_off"
            cor="danger"
          />
          <CartaoIndicador
            titulo="Pipeline em demonstração"
            valor={MOEDA.format(resumo.pipelineEmDemonstracao.valor)}
            legenda={`${resumo.pipelineEmDemonstracao.contas} ${resumo.pipelineEmDemonstracao.contas === 1 ? 'conta' : 'contas'}`}
            icone="payments"
            cor="info"
          />
        </div>
      )}

      <section aria-label="Calendário" className="bg-surface-card rounded-2xl p-space-md shadow-sm space-y-space-sm">
        <div className="flex items-center justify-between flex-wrap gap-space-sm">
          <div role="tablist" aria-label="Visão do calendário" className="flex items-center gap-1 rounded-xl bg-surface-subtle p-1">
            {(['mes', 'semana', 'dia', 'lista'] as VisaoAgenda[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={visao === v}
                onClick={() => setVisao(v)}
                className={`h-8 px-3 rounded-lg font-label-md text-label-md ${visao === v ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`}
              >
                {ROTULO_DA_VISAO[v]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Período anterior" onClick={() => setReferencia((r) => navegar(visao, r, -1))} className="w-9 h-9 rounded-lg bg-surface-subtle">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <button type="button" onClick={() => setReferencia(hoje)} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md">
              Hoje
            </button>
            <button type="button" aria-label="Próximo período" onClick={() => setReferencia((r) => navegar(visao, r, 1))} className="w-9 h-9 rounded-lg bg-surface-subtle">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
            <span aria-live="polite" className="font-label-lg text-label-lg text-text-primary">
              {rotuloDoPeriodo(visao, referencia)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-label-md text-label-md text-text-secondary">
          {podeFiltrar && (
            <select aria-label="Closer" value={closerId} onChange={(e) => setCloserId(e.target.value)} className="h-9 px-2 rounded-lg bg-surface-subtle">
              <option value="">Closer: Todos</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusReuniao | '')} className="h-9 px-2 rounded-lg bg-surface-subtle">
            <option value="">Status: Todos</option>
            {STATUS_DE_REUNIAO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_DO_STATUS[s]}
              </option>
            ))}
          </select>
          <button type="button" onClick={limpar} className="h-9 px-3 rounded-lg text-text-muted hover:text-text-primary">
            Limpar
          </button>
        </div>

        {aviso && (
          <p role="alert" className="text-sm text-danger-text">
            {aviso}
          </p>
        )}
        {erro && <EstadoErro mensagem="Não foi possível carregar a agenda. Tente de novo." onTentarDeNovo={carregar} />}
        {!erro && reunioes === null && <EsqueletoCarregando linhas={3} />}
        {!erro && reunioes !== null && (
          <>
            {visao === 'lista' && <VisaoLista reunioes={reunioes} acoes={acoes} ocupado={ocupado} />}
            {visao === 'dia' && <VisaoDia reunioes={reunioes} acoes={acoes} ocupado={ocupado} />}
            {visao === 'semana' && <VisaoSemana reunioes={reunioes} referencia={referencia} hoje={hoje} />}
            {visao === 'mes' && (
              <VisaoMes
                reunioes={reunioes}
                referencia={referencia}
                hoje={hoje}
                onEscolherDia={(dia) => {
                  setReferencia(dia);
                  setVisao('dia');
                }}
              />
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-space-md items-start">
        <section aria-label="Fila de Reuniões e Sessões Clínicas (Hoje)" className="flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Fila de Reuniões e Sessões Clínicas (Hoje)</h2>
          {reunioesHoje.length === 0 && <p className="font-body-md text-body-md text-text-secondary">Nenhuma reunião neste período</p>}
          {reunioesHoje.map((r) => (
            <CartaoReuniao key={r.id} reuniao={r} acoes={acoes} ocupado={ocupado} />
          ))}
        </section>
        {resumo && (
          <LateralAgenda resumo={resumo} onReagendar={(reuniao) => setModal({ tipo: 'reagendar', reuniao })} />
        )}
      </div>

      {modal?.tipo === 'agendar' && <ModalAgendar onFechar={() => setModal(null)} onConcluido={fecharModalERecarregar} />}
      {modal?.tipo === 'reagendar' && <ModalReagendar reuniao={modal.reuniao} onFechar={() => setModal(null)} onConcluido={fecharModalERecarregar} />}
      {modal?.tipo === 'concluir' && <ModalConcluir reuniao={modal.reuniao} onFechar={() => setModal(null)} onConcluido={fecharModalERecarregar} />}
    </div>
  );
}
