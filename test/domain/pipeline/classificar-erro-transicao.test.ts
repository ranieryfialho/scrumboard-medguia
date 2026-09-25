// Testes de T-049 (fase2-kanban, US-031/US-032): puro, sem I/O — não precisa
// de Postgres efêmero.
import { describe, expect, test } from 'vitest';

import { exigeDadoFaltante } from '../../../src/domain/pipeline/classificar-erro-transicao';

describe('T-049: exigeDadoFaltante', () => {
  describe('AC-091: rejeição por grafo ou papel não abre modal de dado', () => {
    test('TRANSICAO_NAO_PERMITIDA: false @spec:AC-091', () => {
      expect(exigeDadoFaltante('TRANSICAO_NAO_PERMITIDA')).toBe(false);
    });

    test('PAPEL_NAO_PERMITIDO: false @spec:AC-091', () => {
      expect(exigeDadoFaltante('PAPEL_NAO_PERMITIDO')).toBe(false);
    });
  });

  describe('AC-088: rejeição por dado obrigatório abre o modal correspondente', () => {
    test.each([
      'VALOR_OBRIGATORIO',
      'MOTIVO_PERDA_OBRIGATORIO',
      'PROXIMA_ACAO_OBRIGATORIA',
      'EVIDENCIA_OBRIGATORIA',
      'JUSTIFICATIVA_OBRIGATORIA',
    ] as const)('%s: true @spec:AC-088', (codigo) => {
      expect(exigeDadoFaltante(codigo)).toBe(true);
    });
  });
});
