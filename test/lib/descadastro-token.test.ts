// T-274 (fase5-email-descadastro, AC-714): o token assinado do link de descadastro — sem banco.
import { describe, expect, test } from 'vitest';

import { gerarTokenDeDescadastro, linkDeDescadastro, mascararEmail, verificarTokenDeDescadastro } from '../../src/lib/email/descadastro-token';

const SEGREDO = 'segredo-de-teste-do-descadastro-com-32-caracteres+';
const EMPRESA_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const EMPRESA_B = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('T-274: token de descadastro', () => {
  test('gera e confere: o e-mail vale sem diferenciar maiúsculas e volta em minúsculas @spec:AC-714', () => {
    const token = gerarTokenDeDescadastro(EMPRESA_A, '  Maria@Clinica.COM ', SEGREDO);
    expect(verificarTokenDeDescadastro(token, SEGREDO)).toEqual({ empresaId: EMPRESA_A, email: 'maria@clinica.com' });
    expect(gerarTokenDeDescadastro(EMPRESA_A, 'maria@clinica.com', SEGREDO)).toBe(token);
  });

  test('adulterado, truncado, vazio, de outro segredo ou de outra empresa/e-mail é recusado @spec:AC-714', () => {
    const token = gerarTokenDeDescadastro(EMPRESA_A, 'maria@clinica.com', SEGREDO);
    const [carga, assinatura] = token.split('.');
    for (const ruim of ['', 'abc', `${carga}`, `${carga}.`, `.${assinatura}`, `${token}x`, token.slice(0, -3), `${carga}.${assinatura.slice(0, -1)}A`, `${carga}x.${assinatura}`, 'a.b.c']) {
      expect(verificarTokenDeDescadastro(ruim, SEGREDO), ruim).toBeNull();
    }
    expect(verificarTokenDeDescadastro(token, `${SEGREDO}x`)).toBeNull();
    // trocar a carga por outra empresa/e-mail mantendo a assinatura antiga não vale
    const outraCarga = Buffer.from(`${EMPRESA_B}|maria@clinica.com`).toString('base64url');
    expect(verificarTokenDeDescadastro(`${outraCarga}.${assinatura}`, SEGREDO)).toBeNull();
  });

  test('dois e-mails ou duas empresas nunca geram o mesmo token; o token não carrega o segredo @spec:AC-714', () => {
    const t = [
      gerarTokenDeDescadastro(EMPRESA_A, 'a@x.com', SEGREDO),
      gerarTokenDeDescadastro(EMPRESA_A, 'b@x.com', SEGREDO),
      gerarTokenDeDescadastro(EMPRESA_B, 'a@x.com', SEGREDO),
    ];
    expect(new Set(t).size).toBe(3);
    for (const x of t) expect(x).not.toContain(SEGREDO);
  });

  test('o link é <base>/descadastro/<token> e o e-mail é mascarado na página @spec:AC-714', () => {
    const link = linkDeDescadastro('https://crm.medguia.cloud/', EMPRESA_A, 'maria@clinica.com', SEGREDO);
    expect(link.startsWith('https://crm.medguia.cloud/descadastro/')).toBe(true);
    const token = link.split('/descadastro/')[1];
    expect(verificarTokenDeDescadastro(token, SEGREDO)?.email).toBe('maria@clinica.com');
    expect(mascararEmail('Maria@Clinica.com')).toBe('m***@clinica.com');
  });
});
