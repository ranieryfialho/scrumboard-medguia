// T-228 (fase5-investimento-midia): regras puras — valor, canal, rateio por dias e razões.
import { describe, expect, test } from 'vitest';

import { chaveDoCanal, investimentoDoPeriodo, mesValido, normalizarCanal, razao, valorValido } from '../../src/lib/investimento/calculo';

describe('T-228: cálculo do investimento', () => {
  test('o valor vai de R$ 0,01 a R$ 9.999.999,99 com até duas casas @spec:AC-629', () => {
    for (const ok of [0.01, 1, 4500.5, 9_999_999.99]) expect(valorValido(ok), String(ok)).toBe(true);
    for (const ruim of [0, -1, 10_000_000, 1.005, '100', null, Number.NaN]) expect(valorValido(ruim), String(ruim)).toBe(false);
  });

  test('canal repetido por maiúsculas ou espaços é o mesmo; nome fora de 2 a 60 caracteres é recusado @spec:AC-631', () => {
    expect(chaveDoCanal('  Meta   Ads ')).toBe(chaveDoCanal('meta ads'));
    expect(normalizarCanal('  TikTok   Ads ')).toBe('TikTok Ads');
    expect(normalizarCanal('a')).toBeNull();
    expect(normalizarCanal('x'.repeat(61))).toBeNull();
    expect(normalizarCanal(10)).toBeNull();
    expect(mesValido('2026-10')).toBe(true);
    expect(mesValido('2026-13')).toBe(false);
    expect(mesValido('26-10')).toBe(false);
  });

  test('o período parcial usa a parte proporcional dos dias; períodos que cruzam meses somam cada parte @spec:AC-635', () => {
    const linhas = [
      { mes: '2026-10-01', canal: 'Meta Ads', valor: 3100 },
      { mes: '2026-11-01', canal: 'meta ads', valor: 3000 },
    ];
    expect(investimentoDoPeriodo(linhas, '2026-10-01', '2026-10-10').get('meta ads')?.valor).toBe(1000);
    expect(investimentoDoPeriodo(linhas, '2026-10-01', '2026-10-31').get('meta ads')?.valor).toBe(3100);
    // 6 dias de outubro (26 a 31) = 600 + 15 de 30 dias de novembro = 1500
    expect(investimentoDoPeriodo(linhas, '2026-10-26', '2026-11-15').get('meta ads')?.valor).toBe(2100);
    expect(investimentoDoPeriodo(linhas, '2026-12-01', '2026-12-31').size).toBe(0);
  });

  test('divisão por zero vira nulo @spec:AC-638', () => {
    expect(razao(4500, 9)).toBe(500);
    expect(razao(4500, 0)).toBeNull();
    expect(razao(0, 5)).toBe(0);
  });
});
