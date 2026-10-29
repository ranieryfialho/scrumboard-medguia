// T-258 (fase5-meta-receita, US-166): a meta de receita em `GET/PUT /api/metas` contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('T-258: API da meta de receita', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/metas/route');
  let gerente: string;
  let gerenteB: string;
  let atendente: string;

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
    gerente = await cookieDePapel(amb, 'gerente.f688@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f688@teste.com', 'GERENTE', amb.tenants.empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f688@teste.com', 'ATENDENTE');
    rota = await import('../../src/app/api/metas/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('a receita aceita reais com até duas casas e recusa 0, negativo, texto, três casas e acima do limite; taxa não aceita 5000 @spec:AC-688', async () => {
    expect((await gravar({ receita_mensal: 50000 })).status).toBe(200);
    expect((await gravar({ receita_mensal: 1234.56 })).status).toBe(200);
    for (const valor of [0, -10, 'abc', 10.005, 100_000_000]) {
      const r = await gravar({ receita_mensal: valor });
      expect(r.status, String(valor)).toBe(400);
      const corpo = await r.json();
      expect(corpo.campo).toBe('receita_mensal');
      expect(corpo.mensagem).toContain('R$ 0,01 a R$ 99.999.999,99');
    }
    const taxa = await gravar({ taxa_conversao: 5000 });
    expect(taxa.status).toBe(400);
    expect((await taxa.json()).mensagem).toBe('A meta deve ser um número de 0,1 a 100.');
    expect((await gravar({ taxa_conversao: 25, receita_mensal: 80000 })).status).toBe(200);
    expect((await gravar({ receita_mensal: 1 }, atendente)).status).toBe(403);
    expect((await (await ler()).json()).metas.receita_mensal).toBe(80000); // as recusas não gravaram nada
  });

  test('cada empresa lê a própria receita; as taxas seguem iguais; null remove @spec:AC-689', async () => {
    await gravar({ taxa_presenca: 80, taxa_cliques_email: 3.5, receita_mensal: 50000 });
    await gravar({ receita_mensal: 90000.5 }, gerenteB);
    const a = await (await ler()).json();
    expect(a.metas).toEqual({ taxa_conversao: 25, taxa_presenca: 80, taxa_cliques_email: 3.5, receita_mensal: 50000 });
    expect(a.detalhes.find((d: { chave: string }) => d.chave === 'receita_mensal').atualizadoPorNome).toBeTruthy();
    expect((await (await ler(gerenteB)).json()).metas).toEqual({ receita_mensal: 90000.5 });
    expect((await (await ler(atendente)).json()).metas.receita_mensal).toBe(50000); // qualquer papel lê
    await gravar({ receita_mensal: null });
    expect((await (await ler()).json()).metas.receita_mensal).toBeUndefined();
    expect((await (await ler(gerenteB)).json()).metas.receita_mensal).toBe(90000.5);
  });
});
