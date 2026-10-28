// T-184 (fase4-tarefas-agenda, AC-482): status de uma reunião, derivado só dos
// dados que existem (ASM-164) — sem coluna nova. O relógio é sempre um parâmetro.
export type StatusReuniao = 'agendada' | 'em_andamento' | 'aguardando_resultado' | 'realizada' | 'no_show' | 'remarcada';

export const STATUS_DE_REUNIAO: readonly StatusReuniao[] = [
  'agendada',
  'em_andamento',
  'aguardando_resultado',
  'realizada',
  'no_show',
  'remarcada',
];

/** Duração padrão enquanto a reunião conta como "em andamento" (a coluna `duracao_minutos` nunca é preenchida). */
export const DURACAO_PADRAO_MINUTOS = 60;

export interface DadosDeStatus {
  agendadaPara: Date;
  encerradaEm: Date | null;
  noShow: boolean;
  /** Existe uma reunião mais nova ligada a esta (`remarcada_de`). */
  temRemarcacao: boolean;
}

export function statusDaReuniao(r: DadosDeStatus, agora: Date): StatusReuniao {
  if (r.encerradaEm && !r.noShow) return 'realizada';
  if (r.temRemarcacao) return 'remarcada';
  if (r.noShow) return 'no_show';
  const inicio = r.agendadaPara.getTime();
  const t = agora.getTime();
  if (t < inicio) return 'agendada';
  if (t < inicio + DURACAO_PADRAO_MINUTOS * 60_000) return 'em_andamento';
  return 'aguardando_resultado';
}

export const ROTULO_DO_STATUS: Record<StatusReuniao, string> = {
  agendada: 'Agendada',
  em_andamento: 'Em andamento',
  aguardando_resultado: 'Aguardando resultado',
  realizada: 'Realizada',
  no_show: 'No-show',
  remarcada: 'Remarcada',
};
