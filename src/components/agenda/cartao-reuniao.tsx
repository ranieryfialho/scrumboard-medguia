// T-186 (fase4-tarefas-agenda, AC-486/AC-488): o cartão de uma reunião, só com
// o que existe no sistema (horário, lead, valor do card, closer, status, resumo
// e evidência) e as ações que o status permite. O que ainda não tem backend
// (Meet, resgate por WhatsApp...) aparece "em breve".
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { linkDeLigacao } from '@/lib/telefone';
import { ROTULO_DO_STATUS } from '@/lib/reunioes/status';
import { horaDe } from './datas';
import { COR_DO_STATUS, type ReuniaoView } from './tipos';

export interface AcoesDaReuniao {
  onNoShow: (r: ReuniaoView) => void;
  onConcluir: (r: ReuniaoView) => void;
  onReagendar: (r: ReuniaoView) => void;
  onCancelar: (r: ReuniaoView) => void;
  /** T-301: a empresa tem o Google conectado — só então "Gerar link do Meet" aparece. */
  meetConectado?: boolean;
  onGerarMeet?: (r: ReuniaoView) => void;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const CLASSE_BOTAO = 'h-9 px-3 rounded-lg font-label-md text-label-md font-semibold disabled:opacity-50';

const ICONE_DO_STATUS: Record<ReuniaoView['status'], string> = {
  agendada: 'schedule',
  em_andamento: 'play_circle',
  aguardando_resultado: 'hourglass_top',
  realizada: 'check_circle',
  no_show: 'cancel',
  remarcada: 'update',
};

/** A faixa colorida na borda esquerda do cartão (só visual): verde realizada, azul agendada/andamento, âmbar aguardando, vermelho no-show. */
const BORDA_DO_STATUS: Record<ReuniaoView['status'], string> = {
  agendada: 'border-primary',
  em_andamento: 'border-primary',
  aguardando_resultado: 'border-warning-text',
  realizada: 'border-success-text',
  no_show: 'border-danger-text',
  remarcada: 'border-text-muted',
};

/** `comIcone` é falso nas células apertadas da semana e do mês, onde só o texto cabe. */
export function SeloStatus({ status, comIcone = true }: { status: ReuniaoView['status']; comIcone?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DO_STATUS[status]}`}>
      {comIcone && (
        <span aria-hidden="true" data-icone-do-status className="material-symbols-outlined text-[14px] leading-none">
          {ICONE_DO_STATUS[status]}
        </span>
      )}
      {ROTULO_DO_STATUS[status]}
    </span>
  );
}

/** Mostra o endereço da sala sem o `https://`. */
export function enderecoDaSala(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function BotaoLinkDaSala({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const espera = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(espera);
  }, [copiado]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => setCopiado(true)).catch(() => undefined);
      }}
      className={`${CLASSE_BOTAO} bg-primary text-on-primary inline-flex items-center gap-1.5`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
        {copiado ? 'check' : 'content_copy'}
      </span>
      {copiado ? 'Copiado' : 'Link da Sala'}
    </button>
  );
}

export function BotoesDaReuniao({ reuniao, acoes, ocupado }: { reuniao: ReuniaoView; acoes: AcoesDaReuniao; ocupado: boolean }) {
  const s = reuniao.status;
  const nome = reuniao.lead.nome;
  const podeResultado = s === 'em_andamento' || s === 'aguardando_resultado';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {s === 'em_andamento' && reuniao.meetUrl && (
        <a href={reuniao.meetUrl} target="_blank" rel="noopener noreferrer" className={`${CLASSE_BOTAO} bg-primary text-on-primary inline-flex items-center gap-1.5`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            videocam
          </span>
          Entrar no Meet Agora
        </a>
      )}
      {s === 'agendada' && reuniao.meetUrl && <BotaoLinkDaSala url={reuniao.meetUrl} />}
      {(s === 'agendada' || s === 'em_andamento') && !reuniao.meetUrl && acoes.meetConectado && acoes.onGerarMeet && (
        <button type="button" disabled={ocupado} onClick={() => acoes.onGerarMeet?.(reuniao)} aria-label={`Gerar link do Meet: ${nome}`} className={`${CLASSE_BOTAO} bg-surface-subtle text-text-primary inline-flex items-center gap-1.5`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            add_link
          </span>
          Gerar link do Meet
        </button>
      )}
      {s === 'em_andamento' && !reuniao.meetUrl && !acoes.meetConectado && (
        <ItemEmBreve rotulo="Entrar no Meet Agora" icone="videocam" className="h-9 px-3 rounded-lg bg-surface-subtle" />
      )}
      {podeResultado && (
        <button type="button" disabled={ocupado} onClick={() => acoes.onNoShow(reuniao)} aria-label={`Registrar No-Show: ${nome}`} className={`${CLASSE_BOTAO} bg-danger-surface text-danger-text`}>
          Registrar No-Show
        </button>
      )}
      {podeResultado && (
        <button type="button" disabled={ocupado} onClick={() => acoes.onConcluir(reuniao)} aria-label={`Marcar como Concluída: ${nome}`} className={`${CLASSE_BOTAO} bg-success-surface text-success-text`}>
          Marcar como Concluída
        </button>
      )}
      {(s === 'agendada' || podeResultado || s === 'no_show') && (
        <button type="button" disabled={ocupado} onClick={() => acoes.onReagendar(reuniao)} aria-label={`Reagendar: ${nome}`} className={`${CLASSE_BOTAO} bg-surface-subtle text-text-primary`}>
          Reagendar
        </button>
      )}
      {s === 'agendada' && (
        <button type="button" disabled={ocupado} onClick={() => acoes.onCancelar(reuniao)} aria-label={`Cancelar: ${nome}`} className={`${CLASSE_BOTAO} bg-surface-subtle text-text-primary`}>
          Cancelar
        </button>
      )}
      {s === 'aguardando_resultado' && (
        <>
          {linkDeLigacao(reuniao.lead.telefoneE164) && (
            <a href={linkDeLigacao(reuniao.lead.telefoneE164)!} className={`${CLASSE_BOTAO} bg-surface-subtle text-text-primary inline-flex items-center`}>
              Ligar para Clínica
            </a>
          )}
          <ItemEmBreve rotulo="Confirmar Manualmente" className="h-9 px-3 rounded-lg bg-surface-subtle" />
        </>
      )}
      {s === 'no_show' && (
        <>
          <ItemEmBreve rotulo="Transferir para Cadência de Resgate" className="h-9 px-3 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Disparar WhatsApp de Reagendamento" className="h-9 px-3 rounded-lg bg-surface-subtle" />
        </>
      )}
    </div>
  );
}

export function CartaoReuniao({ reuniao, acoes, ocupado }: { reuniao: ReuniaoView; acoes: AcoesDaReuniao; ocupado: boolean }) {
  const status = reuniao.status;
  return (
    <article
      className={`rounded-2xl shadow-sm overflow-hidden border-l-4 ${BORDA_DO_STATUS[status]} ${status === 'no_show' ? 'bg-danger-surface/20' : 'bg-surface-card'}`}
      aria-label={`Reunião com ${reuniao.lead.nome}`}
    >
      <div className="p-space-md flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-16 shrink-0 rounded-lg bg-surface-subtle py-1.5 flex flex-col items-center font-label-md text-label-md text-text-secondary">
            <span className={status === 'em_andamento' ? 'text-primary font-bold' : 'text-text-primary font-semibold'}>{horaDe(reuniao.agendadaPara)}</span>
            {reuniao.encerradaEm && (
              <>
                <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-text-muted">
                  arrow_downward
                </span>
                <span>{horaDe(reuniao.encerradaEm)}</span>
              </>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/pipeline/${reuniao.oportunidadeId}`}
                className={`font-headline-sm text-headline-sm hover:text-primary truncate ${status === 'no_show' ? 'text-text-primary' : 'text-text-primary'}`}
              >
                {reuniao.lead.nome}
              </Link>
              <SeloStatus status={status} />
            </div>
            <div className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-text-muted">
                person
              </span>
              <p className="font-body-sm text-body-sm">Closer: {reuniao.closer?.nome ?? 'Sem responsável'}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="font-headline-sm text-headline-sm text-text-primary">
              {reuniao.valor !== null ? MOEDA.format(Number(reuniao.valor)) : '—'} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
            </span>
          </div>
        </div>
        {reuniao.meetUrl && (status === 'agendada' || status === 'em_andamento') && (
          <a href={reuniao.meetUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 w-fit font-body-sm text-body-sm text-primary hover:underline">
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              link
            </span>
            {enderecoDaSala(reuniao.meetUrl)}
          </a>
        )}
        {status === 'realizada' && (reuniao.resumo || reuniao.anexoId) && (
          <div className="rounded-lg bg-surface-subtle px-3 py-2 font-body-sm text-body-sm text-text-secondary flex flex-col gap-1">
            {reuniao.resumo && <p>{reuniao.resumo}</p>}
            {reuniao.anexoId && (
              <a href={`/api/anexos/${reuniao.anexoId}`} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline w-fit">
                Abrir evidência
              </a>
            )}
          </div>
        )}
        <div className="pt-3 border-t border-surface-container">
          <BotoesDaReuniao reuniao={reuniao} acoes={acoes} ocupado={ocupado} />
        </div>
      </div>
    </article>
  );
}
