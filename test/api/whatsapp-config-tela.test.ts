// T-193 (fase4-whatsapp, US-127): `GET /api/whatsapp/config` estendida com a URL do
// servidor, o webhook mascarado e os eventos, contra um Postgres efêmero real.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { obterOuCriarSegredoWebhook } from '../../src/repositories/whatsapp-config';

describe('T-193: configuração do WhatsApp para a tela', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/whatsapp/config/route');
  let segredo: string;

  const get = (cookie: string | null) =>
    rota.GET(new NextRequest('http://localhost/api/whatsapp/config', { headers: cookie ? { Cookie: cookie } : {} }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    process.env.EVOLUTION_API_URL = 'https://evolution.teste.local';
    process.env.EVOLUTION_API_KEY = 'chave-super-secreta';
    process.env.NEXT_PUBLIC_APP_URL = 'https://crm.teste.local';
    segredo = await obterOuCriarSegredoWebhook(amb.db, { empresaId: amb.tenants.empresaA });
    rota = await import('../../src/app/api/whatsapp/config/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('traz servidor, webhook mascarado e eventos, mantém o formato antigo e nunca vaza segredo @spec:AC-524', async () => {
    const r = await get(amb.cookieA);
    expect(r.status).toBe(200);
    const texto = await r.text();
    const corpo = JSON.parse(texto);
    expect(corpo.empresaId).toBe(amb.tenants.empresaA);
    expect(corpo).toHaveProperty('config');
    expect(corpo.servidor).toEqual({ urlBase: 'https://evolution.teste.local', chaveConfigurada: true });
    expect(corpo.webhookUrl).toBe(`https://crm.teste.local/api/whatsapp/webhook?empresa_id=${amb.tenants.empresaA}&secret=••••••••`);
    expect(corpo.eventos).toEqual(['MESSAGES_UPSERT', 'MESSAGES_UPDATE']);
    expect(texto).not.toContain(segredo);
    expect(texto).not.toContain('chave-super-secreta');
    expect(JSON.stringify(corpo.config)).not.toContain(segredo);

    // a outra empresa vê só a própria URL
    const daB = await (await get(amb.cookieB)).json();
    expect(daB.webhookUrl).toContain(amb.tenants.empresaB);
    expect(daB.webhookUrl).not.toContain(amb.tenants.empresaA);

    expect((await get(null)).status).toBe(401);
  });

  test('sem as variáveis do servidor, a URL vem nula e a chave não configurada @spec:AC-524', async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const corpo = await (await get(amb.cookieA)).json();
    expect(corpo.servidor).toEqual({ urlBase: null, chaveConfigurada: false });
  });
});
