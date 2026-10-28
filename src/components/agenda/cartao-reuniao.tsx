// T-186 (fase4-tarefas-agenda, AC-486/AC-488): o cartão de uma reunião, só com
// o que existe no sistema (horário, lead, valor do card, closer, status, resumo
// e evidência) e as ações que o status permite. O que ainda não tem backend
// (Meet, cancelar, resgate por WhatsApp...) aparece "em breve".
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { ROTULO_DO_STATUS } from '@/lib/reunioes/status';
import { horaDe } from './datas';
import { COR_DO_STATUS, type ReuniaoView } from './tipos';

export interface AcoesDaReuniao {
  onNoShow: (r: ReuniaoView) => void;
  onConcluir: (r: ReuniaoView) => void;
  onReagendar: (r: ReuniaoView) => void;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const CLASSE_BOTAO = 'h-9 px-3 rounded-lg font-label-md text-label-md font-semibold disabled:opacity-50';

export function SeloStatus({ status }: { status: ReuniaoView['status'] }) {
  return (
    <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DO_STATUS[status]}`}>{ROTULO_DO_STATUS[status]}</span>
  );
}

export function BotoesDaReuniao({ reuniao, acoes, ocupado }: { reuniao: ReuniaoView; acoes: AcoesDaReuniao; ocupado: boolean }) {
  const s = reuniao.status;
  const nome = reuniao.lead.nome;
  const podeResultado = s === 'em_andamento' || s === 'aguardando_resultado';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {s === 'em_andamento' && <ItemEmBreve rotulo="Entrar no Meet Agora" icone="videocam" className="h-9 px-3 rounded-lg bg-surface-subtle" />}
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
      {s === 'agendada' && <ItemEmBreve rotulo="Cancelar" className="h-9 px-3 rounded-lg bg-surface-subtle" />}
      {s === 'aguardando_resultado' && (
        <>
          <ItemEmBreve rotulo="Ligar para Clínica" className="h-9 px-3 rounded-lg bg-surface-subtle" />
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
  return (
    <article className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-3" aria-label={`Reunião com ${reuniao.lead.nome}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-label-lg text-label-lg text-primary shrink-0">{horaDe(reuniao.agendadaPara)}</span>
          <Link href={`/pipeline/${reuniao.oportunidadeId}`} className="font-headline-sm text-headline-sm text-text-primary hover:text-primary truncate">
            {reuniao.lead.nome}
          </Link>
          <SeloStatus status={reuniao.status} />
        </div>
        <span className="font-label-lg text-label-lg text-text-primary">
          {reuniao.valor !== null ? MOEDA.format(Number(reuniao.valor)) : '—'} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
        </span>
      </div>
      <p className="font-body-sm text-body-sm text-text-secondary">Closer: {reuniao.closer?.nome ?? 'Sem responsável'}</p>
      {reuniao.status === 'realizada' && (reuniao.resumo || reuniao.anexoId) && (
        <div className="font-body-sm text-body-sm text-text-secondary">
          {reuniao.resumo && <p>{reuniao.resumo}</p>}
          {reuniao.anexoId && (
            <a href={`/api/anexos/${reuniao.anexoId}`} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">
              Abrir evidência
            </a>
          )}
        </div>
      )}
      <BotoesDaReuniao reuniao={reuniao} acoes={acoes} ocupado={ocupado} />
    </article>
  );
}
