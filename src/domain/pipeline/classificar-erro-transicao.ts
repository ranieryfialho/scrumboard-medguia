// T-049 (fase2-kanban, US-031/US-032): decide, a partir do `codigo` que a
// rota de transição devolve, se a UI deve abrir o modal de dado faltante
// (AC-088) ou só mostrar uma mensagem (AC-091) — grafo/papel não têm campo
// que resolva, então nunca abrem modal.
import type { CodigoErroTransicao } from './tipos';

const CODIGOS_DE_DADO_FALTANTE: ReadonlySet<CodigoErroTransicao> = new Set([
  'VALOR_OBRIGATORIO',
  'MOTIVO_PERDA_OBRIGATORIO',
  'PROXIMA_ACAO_OBRIGATORIA',
  'EVIDENCIA_OBRIGATORIA',
  'JUSTIFICATIVA_OBRIGATORIA',
]);

/**
 * `true` quando o código pede um dado específico que o modal (T-050) resolve
 * (AC-088); `false` para `TRANSICAO_NAO_PERMITIDA`/`PAPEL_NAO_PERMITIDO`, que
 * a UI só explica com uma mensagem, sem modal (AC-091).
 */
export function exigeDadoFaltante(codigo: CodigoErroTransicao): boolean {
  return CODIGOS_DE_DADO_FALTANTE.has(codigo);
}
