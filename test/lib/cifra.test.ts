// T-263 (fase5-email-config, AC-696): a cifra dos segredos guardados — sem banco.
import { describe, expect, test } from 'vitest';

import { cifrar, decifrar, ErroDecifra, segredoDeConfiguracoes } from '../../src/lib/seguranca/cifra';

const SEGREDO = 'um-segredo-de-teste-com-mais-de-32-caracteres-ok';
const CHAVE = 're_abcdefghijklmnopqrstuvwxyz0123456789';

describe('T-263: cifra de segredos', () => {
  test('cifrar e decifrar devolvem o texto; o cifrado não contém o texto e muda a cada vez @spec:AC-696', () => {
    const a = cifrar(CHAVE, SEGREDO);
    const b = cifrar(CHAVE, SEGREDO);
    expect(decifrar(a, SEGREDO)).toBe(CHAVE);
    expect(a).not.toContain(CHAVE);
    expect(a).not.toContain(CHAVE.slice(0, 12));
    expect(a).not.toBe(b); // iv aleatório
    expect(a.startsWith('v1:')).toBe(true);
  });

  test('outro segredo, byte alterado ou formato errado não decifram @spec:AC-696', () => {
    const c = cifrar(CHAVE, SEGREDO);
    expect(() => decifrar(c, `${SEGREDO}x`)).toThrow(ErroDecifra);
    const partes = c.split(':');
    const adulterado = [partes[0], partes[1], partes[2], `${partes[3].slice(0, -2)}${partes[3].endsWith('AA') ? 'BB' : 'AA'}`].join(':');
    expect(() => decifrar(adulterado, SEGREDO)).toThrow(ErroDecifra);
    expect(() => decifrar('texto-puro', SEGREDO)).toThrow(ErroDecifra);
    expect(() => decifrar('v2:a:b:c', SEGREDO)).toThrow(ErroDecifra);
  });

  test('o segredo do ambiente só vale com 32 caracteres ou mais @spec:AC-696', () => {
    expect(segredoDeConfiguracoes({ SEGREDO_CONFIGURACOES: SEGREDO } as unknown as NodeJS.ProcessEnv)).toBe(SEGREDO);
    expect(segredoDeConfiguracoes({ SEGREDO_CONFIGURACOES: 'curto' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(segredoDeConfiguracoes({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});
