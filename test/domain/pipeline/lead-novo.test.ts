import { describe, expect, test } from 'vitest';

import { duracaoDoSeloNovoMs, leadEhNovo } from '../../../src/domain/pipeline/lead-novo';

const H = 60 * 60 * 1000;

// Brasília = UTC-3. 2026-11-09 é segunda-feira.
const segunda10h = new Date('2026-11-09T13:00:00Z');
const sexta22h = new Date('2026-11-14T01:00:00Z'); // sexta 13/11, 22h em Brasília
const sabado00h = new Date('2026-11-07T03:00:00Z');
const sabado10h = new Date('2026-11-07T13:00:00Z');
const domingo10h = new Date('2026-11-08T13:00:00Z');
const domingo2330 = new Date('2026-11-09T02:30:00Z');

describe('duracaoDoSeloNovoMs', () => {
  test('segunda a sexta: 12 horas', () => {
    expect(duracaoDoSeloNovoMs(segunda10h)).toBe(12 * H);
    expect(duracaoDoSeloNovoMs(new Date('2026-11-13T22:00:00Z'))).toBe(12 * H); // sexta 19h
    expect(duracaoDoSeloNovoMs(sexta22h)).toBe(12 * H); // sexta 22h (Brasília) — ainda é dia útil
  });

  test('sábado 00:00: 48 horas inteiras', () => {
    expect(duracaoDoSeloNovoMs(sabado00h)).toBe(48 * H);
  });

  test('sábado e domingo encolhem até a virada de segunda', () => {
    expect(duracaoDoSeloNovoMs(sabado10h)).toBe(38 * H);
    expect(duracaoDoSeloNovoMs(domingo10h)).toBe(14 * H);
    expect(duracaoDoSeloNovoMs(domingo2330)).toBe(30 * 60 * 1000);
  });

  test('usa o dia de Brasília, não o UTC (sábado 22h em Brasília já é domingo em UTC)', () => {
    expect(duracaoDoSeloNovoMs(new Date('2026-11-08T01:00:00Z'))).toBe(26 * H); // sáb 22:00 BRT
  });
});

describe('leadEhNovo', () => {
  test('dia útil: novo antes de 12h, não novo a partir de 12h', () => {
    expect(leadEhNovo(segunda10h, new Date(segunda10h.getTime() + 11 * H + 59 * 60_000))).toBe(true);
    expect(leadEhNovo(segunda10h, new Date(segunda10h.getTime() + 12 * H))).toBe(false);
  });

  test('sábado 10h: some na segunda 00:00, não 48h depois', () => {
    expect(leadEhNovo(sabado10h, new Date('2026-11-09T02:59:00Z'))).toBe(true); // seg 23:59 BRT de domingo
    expect(leadEhNovo(sabado10h, new Date('2026-11-09T03:00:00Z'))).toBe(false); // seg 00:00 BRT
  });

  test('aceita ISO string e ignora vazio, inválido ou data futura', () => {
    expect(leadEhNovo(segunda10h.toISOString(), new Date(segunda10h.getTime() + H))).toBe(true);
    expect(leadEhNovo(undefined, segunda10h)).toBe(false);
    expect(leadEhNovo('lixo', segunda10h)).toBe(false);
    expect(leadEhNovo(segunda10h, new Date(segunda10h.getTime() - H))).toBe(false);
  });
});
