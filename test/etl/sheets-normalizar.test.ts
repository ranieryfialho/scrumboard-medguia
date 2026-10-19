// Testes de T-115 (fase3-etl-sheets, US-076): normalização de telefone e
// datas (src/etl/sheets/normalizar.ts). Funções puras — sem rede nem Postgres.
import { describe, expect, test } from 'vitest';

import { normalizarData, normalizarTelefone } from '../../src/etl/sheets/normalizar';

describe('T-115: normalizarTelefone (@spec:AC-277)', () => {
  test('p:+5511981665252 já tem código de país e vira E.164 sem alteração', () => {
    expect(normalizarTelefone('p:+5511981665252')).toBe('+5511981665252');
  });

  test('p:43996131309 não tem código de país e assume +55 (ASM-089)', () => {
    expect(normalizarTelefone('p:43996131309')).toBe('+5543996131309');
  });

  test('092-991593737 tem prefixo de discagem nacional (0) e vira +5592991593737', () => {
    expect(normalizarTelefone('092-991593737')).toBe('+5592991593737');
  });

  test('número incompleto (poucos dígitos) é inválido e devolve undefined', () => {
    expect(normalizarTelefone('123456')).toBeUndefined();
  });

  test('vazio ou ausente devolve undefined', () => {
    expect(normalizarTelefone('')).toBeUndefined();
    expect(normalizarTelefone(undefined)).toBeUndefined();
    expect(normalizarTelefone(null)).toBeUndefined();
  });
});

describe('T-115: normalizarData (@spec:AC-278)', () => {
  test('created_time com fuso -05:00 e -03:00 do mesmo instante produzem o mesmo ISO', () => {
    const umaLeitura = normalizarData('2026-09-15T16:06:12-05:00');
    const outraLeitura = normalizarData('2026-09-15T18:06:12-03:00');

    expect(umaLeitura).toBe(outraLeitura);
  });

  test('data_alteracao no formato dd/mm/aaaa, hh:mm:ss é lida como horário de Brasília (ASM-088)', () => {
    const resultado = normalizarData('15/09/2026, 18:06:12');

    expect(resultado).toBe(new Date('2026-09-15T18:06:12-03:00').toISOString());
  });

  test('data_alteracao equivale à mesma leitura em ISO com -03:00 explícito', () => {
    const viaDataAlteracao = normalizarData('15/09/2026, 18:06:12');
    const viaIso = normalizarData('2026-09-15T18:06:12-03:00');

    expect(viaDataAlteracao).toBe(viaIso);
  });

  test('data inválida devolve undefined', () => {
    expect(normalizarData('não é uma data')).toBeUndefined();
  });

  test('vazio ou ausente devolve undefined', () => {
    expect(normalizarData('')).toBeUndefined();
    expect(normalizarData(undefined)).toBeUndefined();
    expect(normalizarData(null)).toBeUndefined();
  });
});
