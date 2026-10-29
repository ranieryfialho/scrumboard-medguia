// T-258 (fase5-meta-receita): regras puras da meta de receita — validação por unidade e "mês inteiro".
import { describe, expect, test } from 'vitest';

import { descreverMeta, ehMesInteiro, formatarAlvo, metaValida } from '../../src/lib/metas/catalogo';

describe('T-258: meta de receita', () => {
  test('a receita aceita de R$ 0,01 a R$ 99.999.999,99 com até duas casas; as taxas seguem de 0,1 a 100 @spec:AC-688', () => {
    for (const ok of [0.01, 1234.56, 50000, 99_999_999.99]) expect(metaValida('receita_mensal', ok), String(ok)).toBe(true);
    for (const ruim of [0, -1, 100_000_000, 1.005, '50000', null, Number.NaN]) expect(metaValida('receita_mensal', ruim), String(ruim)).toBe(false);
    expect(metaValida('taxa_conversao', 25.5)).toBe(true);
    expect(metaValida('taxa_conversao', 5000)).toBe(false); // 5000 vale para receita, não para taxa
    expect(metaValida('taxa_presenca', 0)).toBe(false);
    expect(metaValida('taxa_cliques_email', 100.1)).toBe(false);
  });

  test('mês inteiro é do dia 1 ao último dia do mesmo mês, com bissexto, e datas inválidas não valem @spec:AC-692', () => {
    for (const [de, ate] of [['2026-10-01', '2026-10-31'], ['2026-02-01', '2026-02-28'], ['2028-02-01', '2028-02-29'], ['2026-04-01', '2026-04-30']]) expect(ehMesInteiro(de, ate), `${de} ${ate}`).toBe(true);
    for (const [de, ate] of [['2026-10-02', '2026-10-31'], ['2026-10-01', '2026-10-30'], ['2026-10-01', '2026-11-30'], ['2026-09-15', '2026-10-14'], ['2026-02-01', '2026-02-29'], ['2026-13-01', '2026-13-31'], ['2026-10-01', 'lixo'], ['', '']]) expect(ehMesInteiro(de, ate), `${de} ${ate}`).toBe(false);
  });

  test('o selo em reais compara sem arredondar, e igualdade conta como atingida @spec:AC-690', () => {
    expect(formatarAlvo(50000, 'reais').replace(/\s/g, ' ')).toBe('R$ 50.000');
    expect(formatarAlvo(1234.5, 'reais').replace(/\s/g, ' ')).toBe('R$ 1.234,50');
    expect(formatarAlvo(25, 'porcentagem')).toBe('25%');
    expect(descreverMeta(62000, 50000, 'reais')?.atingida).toBe(true);
    expect(descreverMeta(50000, 50000, 'reais')?.atingida).toBe(true);
    expect(descreverMeta(49999.99, 50000, 'reais')?.atingida).toBe(false);
    expect(descreverMeta(62000, undefined, 'reais')).toBeNull();
    expect(descreverMeta(null, 50000, 'reais')).toBeNull();
  });
});
