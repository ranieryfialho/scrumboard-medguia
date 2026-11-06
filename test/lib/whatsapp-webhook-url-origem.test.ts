// O endereço que a Evolution chama (webhook) é o do ambiente em que a pessoa está, não o que ficou gravado na imagem no build.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { appUrlDoWebhook } from '../../src/lib/whatsapp/webhook-url';

const antes = { app: process.env.APP_URL, publico: process.env.NEXT_PUBLIC_APP_URL };

beforeEach(() => {
  delete process.env.APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = 'https://gravado-no-build.exemplo.com';
});

afterEach(() => {
  if (antes.app === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = antes.app;
  if (antes.publico === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = antes.publico;
});

const cabecalhos = (dados: Record<string, string>) => new Headers(dados);

describe('appUrlDoWebhook', () => {
  test('atrás do proxy: usa o host e o protocolo encaminhados, e ignora o gravado no build', () => {
    const url = appUrlDoWebhook(
      cabecalhos({ 'x-forwarded-host': 'staging.exemplo.com', 'x-forwarded-proto': 'https', host: '0.0.0.0:3000' }),
      new URL('http://0.0.0.0:3000/api/whatsapp/qrcode')
    );
    expect(url).toBe('https://staging.exemplo.com');
  });

  test('cada ambiente registra o seu: staging e produção dão endereços diferentes com a mesma imagem', () => {
    const naProducao = appUrlDoWebhook(cabecalhos({ 'x-forwarded-host': 'crm.exemplo.com', 'x-forwarded-proto': 'https' }), new URL('http://0.0.0.0:3000/x'));
    const noStaging = appUrlDoWebhook(cabecalhos({ 'x-forwarded-host': 'staging.exemplo.com', 'x-forwarded-proto': 'https' }), new URL('http://0.0.0.0:3000/x'));
    expect(naProducao).toBe('https://crm.exemplo.com');
    expect(noStaging).toBe('https://staging.exemplo.com');
  });

  test('sem proxy, usa o host do pedido', () => {
    expect(appUrlDoWebhook(cabecalhos({ host: 'crm.exemplo.com' }), new URL('https://crm.exemplo.com/x'))).toBe('https://crm.exemplo.com');
  });

  test('rodando na própria máquina (localhost não é alcançável pela Evolution): cai no endereço configurado', () => {
    expect(appUrlDoWebhook(cabecalhos({ host: 'localhost:3000' }), new URL('http://localhost:3000/x'))).toBe('https://gravado-no-build.exemplo.com');
    expect(appUrlDoWebhook(cabecalhos({ host: '127.0.0.1:3000' }), new URL('http://127.0.0.1:3000/x'))).toBe('https://gravado-no-build.exemplo.com');
    process.env.APP_URL = 'https://app-url.exemplo.com';
    expect(appUrlDoWebhook(cabecalhos({ host: 'localhost:3000' }), new URL('http://localhost:3000/x'))).toBe('https://app-url.exemplo.com');
  });

  test('localhost sem nada configurado: devolve a própria origem (não inventa endereço)', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appUrlDoWebhook(cabecalhos({ host: 'localhost:3000' }), new URL('http://localhost:3000/x'))).toBe('http://localhost:3000');
  });
});
