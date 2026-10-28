// T-223 (fase5-metas, US-144): `GET/PUT /api/metas` contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('T-223: API de metas', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/metas/route');
  let gerente: string;
  let atendente: string;
  let gerenteB: string;

  const req = (cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest('http://localhost/api/metas', {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const ler = (cookie: string | null = gerente) => rota.GET(req(cookie));
  const gravar = (metas: unknown, cookie: string | null = gerente) => rota.PUT(req(cookie, 'PUT', { metas }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f5m@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f5m@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f5m@teste.com', 'GERENTE', amb.tenants.empresaB);
    rota = await import('../../src/app/api/metas/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('sem meta cadastrada a leitura vem vazia; salvar grava e devolve quem e quando @spec:AC-615 @spec:AC-616', async () => {
    expect(await (await ler()).json()).toMatchObject({ metas: {}, detalhes: [] });

    const r = await gravar({ taxa_conversao: 25, taxa_presenca: 80.5 });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.metas).toEqual({ taxa_conversao: 25, taxa_presenca: 80.5 });
    expect(corpo.detalhes).toHaveLength(2);
    expect(corpo.detalhes[0].atualizadoEm).toBeTruthy();
    expect(await (await ler(atendente)).json()).toMatchObject({ metas: { taxa_conversao: 25 } });
  });

  test('valor inválido ou meta desconhecida dá 400 e nada é gravado @spec:AC-617', async () => {
    for (const valor of [0, 101, -5, 'abc', 12.34]) {
      const r = await gravar({ taxa_entrega_email: valor });
      expect(r.status, `valor ${String(valor)}`).toBe(400);
      expect((await r.json()).campo).toBe('taxa_entrega_email');
    }
    expect((await gravar({ meta_inventada: 10 })).status).toBe(400);
    expect((await (await ler()).json()).metas.taxa_entrega_email).toBeUndefined();
  });

  test('null remove a meta @spec:AC-618', async () => {
    await gravar({ taxa_cliques_email: 3 });
    expect((await (await ler()).json()).metas.taxa_cliques_email).toBe(3);
    await gravar({ taxa_cliques_email: null });
    expect((await (await ler()).json()).metas.taxa_cliques_email).toBeUndefined();
  });

  test('cada empresa só vê as próprias metas @spec:AC-619', async () => {
    await gravar({ taxa_conversao: 40 }, gerenteB);
    expect((await (await ler(gerenteB)).json()).metas.taxa_conversao).toBe(40);
    expect((await (await ler(gerente)).json()).metas.taxa_conversao).toBe(25);
  });

  test('o atendente lê mas não grava; sem sessão dá 401 @spec:AC-620', async () => {
    expect((await gravar({ taxa_conversao: 99 }, atendente)).status).toBe(403);
    expect((await ler(atendente)).status).toBe(200);
    expect((await ler(null)).status).toBe(401);
    expect((await gravar({ taxa_conversao: 99 }, null)).status).toBe(401);
    expect((await (await ler(gerente)).json()).metas.taxa_conversao).toBe(25);
  });
});
