// T-274 (fase5-email-descadastro, AC-721): as rotas de descadastro são públicas; o resto segue protegido.
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';

describe('T-274: rotas públicas do descadastro', () => {
  test('a página e a API do descadastro respondem sem sessão @spec:AC-721', () => {
    for (const rota of ['/descadastro/abc.def', '/api/descadastro/abc.def', '/descadastro']) expect(ehRotaPublica(rota), rota).toBe(true);
  });

  test('as demais rotas, inclusive as vizinhas, seguem exigindo login e papel @spec:AC-721', () => {
    for (const rota of ['/configuracoes/email', '/api/configuracoes/email', '/api/campanhas', '/descadastros', '/api/descadastros', '/campanhas']) expect(ehRotaPublica(rota), rota).toBe(false);
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/configuracoes/email')).toBe(false);
    expect(podeAcessarRota({ papel: 'GERENTE', isSuperAdmin: false }, '/configuracoes/email')).toBe(true);
  });
});
