// Testes de T-053 (fase2c-anexos): URL assinada HMAC com validade de 60 s.
import { beforeAll, describe, expect, test } from 'vitest';

import { assinarUrl, verificarAssinatura, VALIDADE_URL_SEGUNDOS } from '../../src/lib/anexos/assinatura';

const ID = '11111111-1111-1111-1111-111111111111';
const OUTRO_ID = '22222222-2222-2222-2222-222222222222';
const EMPRESA = 'eeeeeeee-0000-0000-0000-00000000000a';
const OUTRA_EMPRESA = 'eeeeeeee-0000-0000-0000-00000000000b';
const AGORA = Date.UTC(2026, 9, 2, 12, 0, 0);

function partes(url: string) {
  const u = new URL(url, 'http://localhost');
  return { caminho: u.pathname, emp: u.searchParams.get('emp'), exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
}

describe('T-053: assinatura de URL de anexo', () => {
  beforeAll(() => {
    process.env.ANEXOS_SEGREDO = 'segredo-de-teste-anexos';
  });

  test('a URL aponta para o arquivo e expira em exatos 60 s @spec:AC-101', () => {
    const { url, expiracao } = assinarUrl(ID, EMPRESA, AGORA);
    const { caminho, emp, exp, sig } = partes(url);

    expect(VALIDADE_URL_SEGUNDOS).toBe(60);
    expect(caminho).toBe(`/api/anexos/arquivo/${ID}`);
    expect(expiracao).toBe(Math.floor(AGORA / 1000) + 60);
    expect(emp).toBe(EMPRESA);
    expect(Number(exp)).toBe(expiracao);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('assinatura recém-emitida e ainda dentro dos 60 s é aceita @spec:AC-103', () => {
    const { exp, sig } = partes(assinarUrl(ID, EMPRESA, AGORA).url);

    expect(verificarAssinatura(ID, EMPRESA, exp, sig, AGORA)).toBe(true);
    expect(verificarAssinatura(ID, EMPRESA, exp, sig, AGORA + 59_000)).toBe(true);
  });

  test('assinatura com mais de 60 s é recusada @spec:AC-104', () => {
    const { exp, sig } = partes(assinarUrl(ID, EMPRESA, AGORA).url);

    expect(verificarAssinatura(ID, EMPRESA, exp, sig, AGORA + 61_000)).toBe(false);
  });

  test('id, expiração ou assinatura alterados são recusados @spec:AC-104', () => {
    const { exp, sig } = partes(assinarUrl(ID, EMPRESA, AGORA).url);

    expect(verificarAssinatura(OUTRO_ID, EMPRESA, exp, sig, AGORA)).toBe(false);
    expect(verificarAssinatura(ID, OUTRA_EMPRESA, exp, sig, AGORA)).toBe(false);
    expect(verificarAssinatura(ID, EMPRESA, String(Number(exp) + 3600), sig, AGORA)).toBe(false);
    expect(verificarAssinatura(ID, EMPRESA, exp, sig!.replace(/.$/, sig!.endsWith('0') ? '1' : '0'), AGORA)).toBe(false);
    expect(verificarAssinatura(ID, EMPRESA, exp, null, AGORA)).toBe(false);
    expect(verificarAssinatura(ID, EMPRESA, null, sig, AGORA)).toBe(false);
    expect(verificarAssinatura(ID, EMPRESA, exp, 'não-é-hex', AGORA)).toBe(false);
  });

  test('sem ANEXOS_SEGREDO nenhuma URL é emitida @spec:AC-101', () => {
    const guardado = process.env.ANEXOS_SEGREDO;
    delete process.env.ANEXOS_SEGREDO;
    try {
      expect(() => assinarUrl(ID, EMPRESA, AGORA)).toThrow();
    } finally {
      process.env.ANEXOS_SEGREDO = guardado;
    }
  });
});
