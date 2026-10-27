// Testes de T-179 (fase4-pipeline-lote, US-118, AC-458): o gerador de CSV para o
// Excel em português — BOM, ponto e vírgula, aspas, formatos e a proteção contra
// injeção de fórmula. Funções puras: sem banco.
import { describe, expect, test } from 'vitest';

import { formatarDataHoraCsv, formatarTelefoneCsv, formatarValorCsv, gerarCsv, neutralizarFormula } from '../../src/lib/csv/gerar-csv';

describe('T-179: gerador de CSV', () => {
  describe('AC-458: o arquivo abre certo no Excel e não executa fórmulas', () => {
    test('começa com o BOM do UTF-8, separa por ponto e vírgula e quebra linha com CRLF @spec:AC-458', () => {
      const csv = gerarCsv(['Lead', 'Valor'], [['Clínica Alfa', '1500,50']]);

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv.slice(1)).toBe('Lead;Valor\r\nClínica Alfa;1500,50\r\n');
    });

    test('protege com aspas o campo que tem ponto e vírgula, aspas ou quebra de linha, duplicando as aspas @spec:AC-458', () => {
      const csv = gerarCsv(['Lead'], [['Clínica "Alfa"; Beta'], ['Linha 1\nLinha 2'], ['Simples']]);

      expect(csv).toContain('"Clínica ""Alfa""; Beta"');
      expect(csv).toContain('"Linha 1\nLinha 2"');
      expect(csv).toContain('\r\nSimples\r\n');
    });

    test.each([
      ['=SOMA(1;1)', "'=SOMA(1;1)"],
      ['+55 11 9', "'+55 11 9"],
      ['-cmd', "'-cmd"],
      ['@usuario', "'@usuario"],
      ['\tcomtab', "'\tcomtab"],
    ])('texto que começa com fórmula (%j) sai com apóstrofo na frente @spec:AC-458', (entrada, esperado) => {
      expect(neutralizarFormula(entrada)).toBe(esperado);
      expect(gerarCsv(['Lead'], [[entrada]])).toContain(esperado.includes(';') ? `"${esperado}"` : esperado);
    });

    test('texto comum, vazio e nulo não ganham apóstrofo; número entra com vírgula decimal @spec:AC-458', () => {
      expect(neutralizarFormula('Clínica Alfa')).toBe('Clínica Alfa');
      expect(neutralizarFormula('')).toBe('');
      const csv = gerarCsv(['A', 'B', 'C', 'D'], [['x', null, undefined, 12.5]]);
      expect(csv.slice(1)).toBe('A;B;C;D\r\nx;;;12,5\r\n');
    });

    test('valor em reais ganha vírgula decimal e duas casas; vazio ou inválido vira vazio @spec:AC-458', () => {
      expect(formatarValorCsv('1500.5')).toBe('1500,50');
      expect(formatarValorCsv(1234)).toBe('1234,00');
      expect(formatarValorCsv('0')).toBe('0,00');
      expect(formatarValorCsv(null)).toBe('');
      expect(formatarValorCsv('')).toBe('');
      expect(formatarValorCsv('abc')).toBe('');
    });

    test('telefone brasileiro sai como "(DD) NNNNN-NNNN", sem o "+" que viraria fórmula; os outros ficam como vieram @spec:AC-458', () => {
      expect(formatarTelefoneCsv('+5541866330013')).toBe('(41) 86633-0013');
      expect(formatarTelefoneCsv('5511900000001')).toBe('(11) 90000-0001');
      expect(formatarTelefoneCsv('+551133334444')).toBe('(11) 3333-4444');
      expect(formatarTelefoneCsv('+14155550123')).toBe('+14155550123');
      expect(formatarTelefoneCsv('')).toBe('');
      expect(formatarTelefoneCsv(null)).toBe('');
      // O que não é brasileiro continua protegido contra fórmula pelo gerador.
      expect(gerarCsv(['Tel'], [[formatarTelefoneCsv('+14155550123')]]).slice(1)).toBe("Tel\r\n'+14155550123\r\n");
      expect(gerarCsv(['Tel'], [[formatarTelefoneCsv('+5541866330013')]]).slice(1)).toBe('Tel\r\n(41) 86633-0013\r\n');
    });

    test('data vira dd/mm/aaaa hh:mm no fuso de São Paulo; sem data vira vazio @spec:AC-458', () => {
      // 27/10/2026 14:05 UTC = 11:05 em São Paulo (UTC-3, sem horário de verão).
      expect(formatarDataHoraCsv(new Date('2026-10-27T14:05:00.000Z'))).toBe('27/10/2026 11:05');
      expect(formatarDataHoraCsv(null)).toBe('');
      expect(formatarDataHoraCsv(undefined)).toBe('');
    });

    test('uma Date entregue direto à célula também sai formatada, sem apóstrofo @spec:AC-458', () => {
      const csv = gerarCsv(['Quando'], [[new Date('2026-10-27T14:05:00.000Z')]]);
      expect(csv.slice(1)).toBe('Quando\r\n27/10/2026 11:05\r\n');
    });
  });
});
