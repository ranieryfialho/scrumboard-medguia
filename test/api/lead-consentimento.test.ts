// T-249 (fase5-whatsapp-lote-base, US-159): consentimento do lead contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('T-249: consentimento do lead', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/leads/[id]/consentimento/route');
  let atendente: string;

  const chamar = (metodo: 'GET' | 'PUT', id: string, cookie: string | null, corpo?: unknown) => {
    const request = new NextRequest(`http://localhost/api/leads/${id}/consentimento`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    return rota[metodo](request, { params: Promise.resolve({ id }) });
  };

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.f667@teste.com', 'ATENDENTE');
    rota = await import('../../src/app/api/leads/[id]/consentimento/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('registrar grava data e autor, e revogar apaga os dois @spec:AC-667', async () => {
    const { leadA } = amb.tenants;
    expect(await (await chamar('GET', leadA, atendente)).json()).toEqual({ consentimento: false, em: null, porNome: null });

    const r = await chamar('PUT', leadA, atendente, { consentimento: true });
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.consentimento).toBe(true);
    expect(new Date(c.em).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(c.porNome).toBeTruthy();
    expect(await (await chamar('GET', leadA, atendente)).json()).toEqual(c);

    expect(await (await chamar('PUT', leadA, atendente, { consentimento: false })).json()).toEqual({ consentimento: false, em: null, porNome: null });
    expect((await chamar('PUT', leadA, atendente, { consentimento: 'sim' })).status).toBe(400);
  });

  test('lead de outra empresa e id inválido são 404, sem sessão 401, e nada muda @spec:AC-668', async () => {
    const { leadB } = amb.tenants;
    expect((await chamar('PUT', leadB, atendente, { consentimento: true })).status).toBe(404);
    expect((await chamar('GET', leadB, atendente)).status).toBe(404);
    expect((await chamar('GET', 'nao-e-uuid', atendente)).status).toBe(404);
    expect((await chamar('GET', amb.tenants.leadA, null)).status).toBe(401);
    expect((await chamar('PUT', amb.tenants.leadA, null, { consentimento: true })).status).toBe(401);
    const r = amb.pg.psqlComo('crm_migrator', `SELECT consentimento_whatsapp_em IS NULL FROM leads WHERE id = '${leadB}'`);
    expect(r.stdout.trim()).toBe('t');
  });
});
