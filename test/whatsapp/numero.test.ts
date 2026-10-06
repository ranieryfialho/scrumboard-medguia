// T-072 (fase2c-whatsapp-conversa): prova pura (sem I/O) da normalização e
// das variações do nono dígito.
import { describe, expect, test } from 'vitest';

import { normalizarNumero, saoNumerosEquivalentes, variantesNumero } from '../../src/domain/whatsapp/numero';

describe('T-072: normalizarNumero', () => {
  test('mantém só dígitos, descartando máscara @spec:AC-143', () => {
    expect(normalizarNumero('(85) 99998-5587')).toBe('5585999985587');
  });

  test('número com 11 dígitos (DDD + nono dígito) recebe DDI 55 @spec:AC-149', () => {
    expect(normalizarNumero('85999985587')).toBe('5585999985587');
  });

  test('número com 10 dígitos (DDD sem nono dígito) recebe DDI 55 @spec:AC-149', () => {
    expect(normalizarNumero('8599985587')).toBe('558599985587');
  });

  test('número com 12 a 15 dígitos (já com DDI) fica como está @spec:AC-149', () => {
    expect(normalizarNumero('5585999985587')).toBe('5585999985587');
    expect(normalizarNumero('558599985587')).toBe('558599985587');
  });

  test.each([
    ['vazio', ''],
    ['9 dígitos', '123456789'],
    ['16 dígitos', '1234567890123456'],
  ])('fora de 10 a 15 dígitos (%s) é inválido @spec:AC-143', (_nome, entrada) => {
    expect(normalizarNumero(entrada)).toBeNull();
  });

  test('menos de 10 dígitos é inválido @spec:AC-162', () => {
    expect(normalizarNumero('123456789')).toBeNull();
  });

  test('mais de 15 dígitos é inválido @spec:AC-162', () => {
    expect(normalizarNumero('1234567890123456')).toBeNull();
  });
});

describe('T-072: variantesNumero', () => {
  test('12 dígitos (sem nono) gera também a grafia com o nono dígito @spec:AC-149', () => {
    expect(variantesNumero('558599985587')).toEqual(['558599985587', '5585999985587']);
  });

  test('13 dígitos (com nono) gera também a grafia sem o nono dígito @spec:AC-149', () => {
    expect(variantesNumero('5585999985587')).toEqual(['5585999985587', '558599985587']);
  });

  test('número fora do padrão brasileiro não gera variação @spec:AC-149', () => {
    expect(variantesNumero('12125551234')).toEqual(['12125551234']);
  });
});

describe('T-072: saoNumerosEquivalentes', () => {
  test('mesma grafia é equivalente @spec:AC-149', () => {
    expect(saoNumerosEquivalentes('5585999985587', '5585999985587')).toBe(true);
  });

  test('com e sem o nono dígito são equivalentes nos dois sentidos @spec:AC-149', () => {
    expect(saoNumerosEquivalentes('5585999985587', '558599985587')).toBe(true);
    expect(saoNumerosEquivalentes('558599985587', '5585999985587')).toBe(true);
  });

  test('reconhece a variação ao consultar com DDI e com e sem o nono dígito @spec:AC-149', () => {
    const gravadoComNono = normalizarNumero('5585999985587')!;
    const gravadoSemNono = normalizarNumero('558599985587')!;

    for (const consulta of ['85999985587', '5585999985587', '558599985587']) {
      const numeroConsultado = normalizarNumero(consulta)!;
      expect(
        saoNumerosEquivalentes(numeroConsultado, gravadoComNono) ||
          saoNumerosEquivalentes(numeroConsultado, gravadoSemNono)
      ).toBe(true);
    }
  });

  test('telefone repetido é reconhecido mesmo com a variação do nono dígito (cadastro) @spec:AC-161', () => {
    const principal = normalizarNumero('+5585999985587')!;
    const extra = normalizarNumero('5585988887777')!;
    const cadastrados = [principal, extra];

    for (const tentativa of ['558599985587', '85999985587', '5585988887777']) {
      const numeroTentativa = normalizarNumero(tentativa)!;
      expect(cadastrados.some((existente) => saoNumerosEquivalentes(numeroTentativa, existente))).toBe(true);
    }
  });

  test('números diferentes não são equivalentes @spec:AC-161', () => {
    expect(saoNumerosEquivalentes('5585999985587', '5585988887777')).toBe(false);
  });

  test('números fora do padrão brasileiro só coincidem com grafia idêntica @spec:AC-162', () => {
    expect(saoNumerosEquivalentes('12125551234', '12125551235')).toBe(false);
  });
});
