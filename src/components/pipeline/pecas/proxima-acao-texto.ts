import type { ProximaAcao } from '@/domain/pipeline/proxima-acao';

const NOME_DO_PERIODO = { manha: 'manhã', tarde: 'tarde' } as const;

/** "14/11/2026, 15:00" para uma hora marcada; "14/11/2026 · manhã" quando a cadência só conhece o turno; `null` sem data. */
export function quandoDaProximaAcao(acao: ProximaAcao): string | null {
  if (!acao.quando) return null;
  if (acao.periodo) return `${new Date(acao.quando).toLocaleDateString('pt-BR')} · ${NOME_DO_PERIODO[acao.periodo]}`;
  return new Date(acao.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
