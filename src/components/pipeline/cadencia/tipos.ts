// T-173 (fase4-card-abas, US-113): o formato da resposta de
// `GET /api/oportunidades/[id]/cadencia` (T-170) e os rótulos da tela.

export interface ToqueDaCadencia {
  sequencia: number;
  dia: 1 | 2 | 3;
  turno: 'manha' | 'tarde';
  canal: 'telefone' | 'whatsapp';
  tipo: 'ligacao' | 'mensagem' | 'breakup';
  estado: 'concluido' | 'cancelado' | 'da_vez' | 'programado';
  atividadeId: string | null;
  resultado: 'pendente' | 'sem_resposta' | 'conectou' | 'cancelada' | null;
  realizadaEm: string | null;
  realizadaPor: { id: string; nome: string } | null;
  observacao: string | null;
  atrasado: boolean;
}

export type SituacaoDaRegua = 'nao_iniciada' | 'em_andamento' | 'atrasada' | 'encerrada';

export interface CadenciaDoCardView {
  oportunidade: { id: string; etapaId: number; version: number };
  iniciada: boolean;
  encerrada: boolean;
  situacao: SituacaoDaRegua;
  total: number;
  concluidos: number;
  conectou: number;
  semResposta: number;
  toqueDaVez: ToqueDaCadencia | null;
  toques: ToqueDaCadencia[];
}

export const ROTULO_CANAL: Record<ToqueDaCadencia['canal'], string> = {
  telefone: 'Ligação',
  whatsapp: 'WhatsApp',
};

export const ROTULO_TIPO: Record<ToqueDaCadencia['tipo'], string> = {
  ligacao: 'Ligação',
  mensagem: 'Mensagem',
  breakup: 'Mensagem de despedida',
};

export const ROTULO_TURNO: Record<ToqueDaCadencia['turno'], string> = {
  manha: 'Manhã',
  tarde: 'Tarde',
};

export const ROTULO_SITUACAO: Record<SituacaoDaRegua, string> = {
  nao_iniciada: 'Não iniciada',
  em_andamento: 'Em andamento',
  atrasada: 'Com toque atrasado',
  encerrada: 'Encerrada',
};

export const ROTULO_RESULTADO: Record<'conectou' | 'sem_resposta' | 'cancelada' | 'pendente', string> = {
  conectou: 'Conectou',
  sem_resposta: 'Sem resposta',
  cancelada: 'Cancelado',
  pendente: 'Pendente',
};

/** "Ligação telefônica", "Mensagem · WhatsApp" ou "Mensagem de despedida · WhatsApp" (sem repetir "Ligação · Ligação"). */
export function tituloDoToque(toque: Pick<ToqueDaCadencia, 'tipo' | 'canal'>): string {
  if (toque.tipo === 'ligacao') return 'Ligação telefônica';
  return `${ROTULO_TIPO[toque.tipo]} · ${ROTULO_CANAL[toque.canal]}`;
}

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
