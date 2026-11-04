// T-306 (fase4-campanhas, US-130): a barra de formatação e o pré-cabeçalho do editor de HTML da campanha.
import { describe, expect, test } from 'vitest';

import { aplicarTrecho, definirPrecabecalho, lerPrecabecalho, MODELOS, MODELO_BASICO, TRECHOS } from '../../../src/components/campanhas/modelos-html';

describe('T-306: modelos, trechos e pré-cabeçalho', () => {
  test('os modelos são HTML completo e usam a variável do primeiro nome @spec:AC-784', () => {
    expect(MODELOS.map((m) => m.id)).toEqual(['institucional', 'tiss', 'reativacao']);
    for (const html of [MODELO_BASICO, ...MODELOS.map((m) => m.html)]) {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('{{primeiro_nome}}');
    }
  });

  test('um trecho envolve a seleção ou entra o texto padrão no cursor @spec:AC-785', () => {
    const negrito = TRECHOS.find((t) => t.id === 'b')!;
    expect(aplicarTrecho('Olá mundo', 4, 9, negrito)).toEqual({ texto: 'Olá <strong>mundo</strong>', cursor: 'Olá <strong>mundo</strong>'.length });
    expect(aplicarTrecho('ab', 1, 1, negrito).texto).toBe('a<strong>texto</strong>b');
    const divisor = TRECHOS.find((t) => t.id === 'hr')!;
    expect(aplicarTrecho('x', 1, 1, divisor).texto).toContain('<hr');
  });

  test('o pré-cabeçalho vai logo depois do <body>, troca e sai sem sobrar nada @spec:AC-786', () => {
    const base = '<html><body style="x"><p>Oi</p></body></html>';
    const com = definirPrecabecalho(base, 'Só até sexta');
    expect(com).toContain('<body style="x"><div data-precabecalho');
    expect(lerPrecabecalho(com)).toBe('Só até sexta');
    expect(lerPrecabecalho(definirPrecabecalho(com, 'Outro texto'))).toBe('Outro texto');
    expect(definirPrecabecalho(com, '')).toBe(base);
    expect(lerPrecabecalho(base)).toBe('');
    // sem <body>, o bloco vai no começo; "<" e ">" não entram
    expect(definirPrecabecalho('<p>Oi</p>', 'a<b>c').startsWith('<div data-precabecalho')).toBe(true);
    expect(lerPrecabecalho(definirPrecabecalho('<p>Oi</p>', 'a<b>c'))).toBe('abc');
  });
});
