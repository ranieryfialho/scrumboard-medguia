// T-186 (fase4-tarefas-agenda, US-121): o formato das respostas de
// `GET /api/reunioes` e `GET /api/reunioes/resumo` (src/repositories/reunioes.ts).
import type { StatusReuniao } from '@/lib/reunioes/status';

export interface ReuniaoView {
  id: string;
  oportunidadeId: string;
  agendadaPara: string;
  status: StatusReuniao;
  encerradaEm: string | null;
  noShow: boolean;
  resumo: string | null;
  anexoId: string | null;
  remarcadaDe: string | null;
  lead: { id: string; nome: string; telefoneE164: string | null };
  valor: string | null;
  etapaId: number;
  version: number;
  closer: { id: string; nome: string } | null;
}

export interface ResumoAgendaView {
  hoje: { total: number; emAndamentoOuPorVir: number };
  presenca: { taxa: number | null; realizadas: number; noShows: number };
  noShow: { quantidade: number; percentual: number | null };
  pipelineEmDemonstracao: { valor: number; contas: number };
  resgateDeNoShows: {
    reuniaoId: string;
    oportunidadeId: string;
    leadNome: string;
    agendadaPara: string;
    closer: { id: string; nome: string } | null;
  }[];
  desempenhoPorCloser: { closerId: string; nome: string; realizadas: number; comResultado: number; taxa: number | null }[];
}

export type VisaoAgenda = 'mes' | 'semana' | 'dia' | 'lista';

/** Cor do selo de cada status (só visual). */
export const COR_DO_STATUS: Record<StatusReuniao, string> = {
  agendada: 'bg-info-surface text-info-text',
  em_andamento: 'bg-info-surface text-primary',
  aguardando_resultado: 'bg-warning-surface text-warning-text',
  realizada: 'bg-success-surface text-success-text',
  no_show: 'bg-danger-surface text-danger-text',
  remarcada: 'bg-surface-container text-text-secondary',
};
