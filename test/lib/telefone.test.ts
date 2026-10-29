// T-234 (fase5-acoes-rapidas, US-151): o telefone do lead no formato do link `tel:`.
import { describe, expect, test } from 'vitest';

import { linkDeLigacao } from '../../src/lib/telefone';

describe('T-234: link de ligação', () => {
  test('dígitos viram tel:+número; vazio ou curto não vira link @spec:AC-645', () => {
    expect(linkDeLigacao('5511999990000')).toBe('tel:+5511999990000');
    expect(linkDeLigacao('+55 (11) 99999-0000')).toBe('tel:+5511999990000');
    expect(linkDeLigacao(null)).toBeNull();
    expect(linkDeLigacao('')).toBeNull();
    expect(linkDeLigacao('123')).toBeNull();
  });
});
