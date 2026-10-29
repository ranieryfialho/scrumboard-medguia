// T-228 (fase5-investimento-midia, US-147): `GET/PUT /api/investimento` contra um Postgres efêmero real
// com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const MES = '2026-10';

describe('T-228: API de investimento', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/investimento/route');
  let gerente: string;
  let atendente: string;
  let gerenteB: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const req = (cookie: string | null, metodo = 'GET', corpo?: unknown, query = `?mes=${MES}`) =>
    new NextRequest(`http://localhost/api/investimento${metodo === 'GET' ? query : ''}`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const ler = (cookie: string | null = gerente, query?: string) => rota.GET(req(cookie, 'GET', undefined, query));
  const gravar = (valores: unknown, cookie: string | null = gerente, mes: unknown = MES) => rota.PUT(req(cookie, 'PUT', { mes, valores }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    gerente = await cookieDePapel(amb, 'gerente.f5i@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f5i@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f5i@teste.com', 'GERENTE', empresaB);
    sql(`INSERT INTO leads (id, empresa_id, nome, origem) VALUES
           ('eeeeeeee-5050-0000-0000-000000000001', '${empresaA}', 'L1', 'Meta Ads'),
           ('eeeeeeee-5050-0000-0000-000000000002', '${empresaA}', 'L2', 'Indicação'),
           ('eeeeeeee-5050-0000-0000-000000000003', '${empresaB}', 'L3', 'Origem da B');
         INSERT INTO investimento_midia (empresa_id, mes, canal, valor) VALUES ('${empresaA}', '2026-10-01', 'Google Ads', 2000);`);
    rota = await import('../../src/app/api/investimento/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista as origens dos leads e os canais já cadastrados do mês, com o total @spec:AC-627', async () => {
    const corpo = await (await ler()).json();
    expect(corpo.mes).toBe(MES);
    expect(corpo.canais).toEqual([
      { canal: 'Google Ads', valor: 2000 },
      { canal: 'Indicação', valor: null },
      { canal: 'Meta Ads', valor: null },
    ]);
    expect(corpo.total).toBe(2000);
    expect((await (await ler(gerente, '?mes=2026-09')).json()).total).toBe(0);
    expect((await ler(gerente, '?mes=2026-13')).status).toBe(400);
  });

  test('salvar grava o valor e atualiza o total do mês @spec:AC-628', async () => {
    const r = await gravar({ 'Meta Ads': 4500.5 });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.canais.find((c: { canal: string }) => c.canal === 'Meta Ads').valor).toBe(4500.5);
    expect(corpo.total).toBe(6500.5);
  });

  test('valor inválido, canal inválido ou mês inválido dá 400 e nada é gravado @spec:AC-629', async () => {
    for (const valor of [0, -5, 'abc', 10_000_000, 1.234]) {
      const r = await gravar({ 'Indicação': valor });
      expect(r.status, `valor ${String(valor)}`).toBe(400);
      expect((await r.json()).campo).toBe('Indicação');
    }
    expect((await gravar({ x: 10 })).status).toBe(400);
    expect((await gravar({ 'Indicação': 10 }, gerente, '2026-99')).status).toBe(400);
    expect((await (await ler()).json()).canais.find((c: { canal: string }) => c.canal === 'Indicação').valor).toBeNull();
  });

  test('null remove o investimento do canal @spec:AC-630', async () => {
    await gravar({ 'Indicação': 300 });
    expect((await (await ler()).json()).total).toBe(6800.5);
    await gravar({ 'Indicação': null });
    const corpo = await (await ler()).json();
    expect(corpo.canais.find((c: { canal: string }) => c.canal === 'Indicação').valor).toBeNull();
    expect(corpo.total).toBe(6500.5);
  });

  test('canal novo entra; grafia só com maiúsculas ou espaços diferentes usa o canal existente @spec:AC-631', async () => {
    await gravar({ 'TikTok Ads': 700 });
    await gravar({ ' meta   ads ': 5000 });
    const corpo = await (await ler()).json();
    expect(corpo.canais.map((c: { canal: string }) => c.canal)).toEqual(['Google Ads', 'Indicação', 'Meta Ads', 'TikTok Ads']);
    expect(corpo.canais.find((c: { canal: string }) => c.canal === 'Meta Ads').valor).toBe(5000);
    expect(corpo.canais.find((c: { canal: string }) => c.canal === 'TikTok Ads').valor).toBe(700);
  });

  test('cada empresa só vê o próprio investimento @spec:AC-632', async () => {
    await gravar({ 'Meta Ads': 9000 }, gerenteB);
    const b = await (await ler(gerenteB)).json();
    expect(b.canais).toEqual([{ canal: 'Meta Ads', valor: 9000 }, { canal: 'Origem da B', valor: null }]);
    expect((await (await ler(gerente)).json()).canais.find((c: { canal: string }) => c.canal === 'Meta Ads').valor).toBe(5000);
  });

  test('o atendente não lê nem grava; sem sessão dá 401 @spec:AC-633', async () => {
    expect((await ler(atendente)).status).toBe(403);
    expect((await gravar({ 'Meta Ads': 1 }, atendente)).status).toBe(403);
    expect((await ler(null)).status).toBe(401);
    expect((await gravar({ 'Meta Ads': 1 }, null)).status).toBe(401);
    expect((await (await ler(gerente)).json()).canais.find((c: { canal: string }) => c.canal === 'Meta Ads').valor).toBe(5000);
  });
});
