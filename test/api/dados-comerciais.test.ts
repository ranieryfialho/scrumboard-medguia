// T-289 (fase4-card-abas, US-114): os dados comerciais do card (proposta e qualificação técnica) contra um Postgres efêmero real
// com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('T-289: GET/PUT /api/oportunidades/:id/comercial', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/oportunidades/[id]/comercial/route');
  let atendente: string;
  let gerenteB: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const req = (id: string, cookie: string | null, metodo: 'GET' | 'PUT', corpo?: unknown) =>
    new NextRequest(`http://localhost/api/oportunidades/${id}/comercial`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  const ler = (id: string, cookie: string | null = atendente) => rota.GET(req(id, cookie, 'GET'), { params: Promise.resolve({ id }) });
  const gravar = (id: string, corpo: unknown, cookie: string | null = atendente) => rota.PUT(req(id, cookie, 'PUT', corpo), { params: Promise.resolve({ id }) });
  const cardA = () => amb.tenants.oportunidadeA;

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.comercial@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.comercial@teste.com', 'GERENTE', amb.tenants.empresaB);
    rota = await import('../../src/app/api/oportunidades/[id]/comercial/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('sem ninguém ter preenchido, devolve tudo vazio e o termo "não"; sem sessão é 401 @spec:AC-742', async () => {
    expect((await ler(cardA(), null)).status).toBe(401);
    expect(await (await ler(cardA())).json()).toEqual({
      previsaoFechamento: null,
      condicaoEspecial: null,
      plano: null,
      porteClinica: null,
      prontuarioLegado: null,
      faturamentoTiss: null,
      termoLgpdValidado: false,
    });
    expect(sql(`SELECT count(*) FROM oportunidade_comercial`)).toBe('0');
  });

  test('grava só o que foi enviado, mantém o resto, e o dado volta igual na leitura @spec:AC-742', async () => {
    const r = await gravar(cardA(), { previsaoFechamento: '2026-11-25', condicaoEspecial: '  60 Dias Carência ', plano: 'Enterprise' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ previsaoFechamento: '2026-11-25', condicaoEspecial: '60 Dias Carência', plano: 'Enterprise', porteClinica: null });

    const q = await gravar(cardA(), { porteClinica: '14 consultórios', termoLgpdValidado: true });
    expect(await q.json()).toMatchObject({ plano: 'Enterprise', porteClinica: '14 consultórios', termoLgpdValidado: true });
    expect(await (await ler(cardA())).json()).toMatchObject({ previsaoFechamento: '2026-11-25', porteClinica: '14 consultórios', termoLgpdValidado: true });
    expect(sql(`SELECT count(*) FROM oportunidade_comercial WHERE oportunidade_id = '${cardA()}'`)).toBe('1');

    const limpou = await gravar(cardA(), { condicaoEspecial: '', previsaoFechamento: null });
    expect(await limpou.json()).toMatchObject({ condicaoEspecial: null, previsaoFechamento: null, plano: 'Enterprise' });
  });

  test('registra na linha do tempo só o que mudou, com antes e depois; repetir não registra nada @spec:AC-743', async () => {
    const eventos = () => sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card'`);
    const antes = Number(eventos());
    const r = await gravar(cardA(), { plano: 'Enterprise', porteClinica: '14 consultórios', termoLgpdValidado: true });
    expect((await r.json()).alteracoes).toEqual([]);
    expect(eventos()).toBe(String(antes));

    const m = await gravar(cardA(), { plano: 'Starter', termoLgpdValidado: false });
    expect((await m.json()).alteracoes).toEqual([
      { campo: 'plano', de: 'Enterprise', para: 'Starter' },
      { campo: 'termo_lgpd', de: 'sim', para: 'não' },
    ]);
    expect(eventos()).toBe(String(antes + 1));
    expect(sql(`SELECT ator_tipo || '|' || (ator_id IS NOT NULL) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card' ORDER BY ocorrido_em DESC LIMIT 1`)).toBe('usuario|true');
  });

  test('recusa campo mal formado (400 com o campo) sem gravar nada @spec:AC-742', async () => {
    for (const [corpo, campo] of [
      [{ previsaoFechamento: '25/11/2026' }, 'previsaoFechamento'],
      [{ previsaoFechamento: '2026-02-31' }, 'previsaoFechamento'],
      [{ previsaoFechamento: 20261125 }, 'previsaoFechamento'],
      [{ plano: 'x'.repeat(201) }, 'plano'],
      [{ porteClinica: 5 }, 'porteClinica'],
      [{ termoLgpdValidado: 'sim' }, 'termoLgpdValidado'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await gravar(cardA(), corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(400);
      expect((await r.json()).campo).toBe(campo);
    }
    expect((await gravar(cardA(), [1])).status).toBe(400);
    expect(sql(`SELECT plano FROM oportunidade_comercial WHERE oportunidade_id = '${cardA()}'`)).toBe('Starter');
  });

  test('card de outra empresa ou inexistente é 404 e as linhas das empresas não se enxergam @spec:AC-742', async () => {
    expect((await gravar(amb.tenants.oportunidadeB, { plano: 'Invasor' })).status).toBe(404);
    expect((await ler(amb.tenants.oportunidadeB)).status).toBe(404);
    expect((await gravar('aaaaaaaa-1111-4111-8111-00000000ffff', { plano: 'X' })).status).toBe(404);
    expect((await gravar(cardA(), { plano: 'Da empresa B' }, gerenteB)).status).toBe(404);

    expect((await gravar(amb.tenants.oportunidadeB, { plano: 'Plano B' }, gerenteB)).status).toBe(200);
    expect((await (await ler(cardA())).json()).plano).toBe('Starter');
    expect((await (await ler(amb.tenants.oportunidadeB, gerenteB)).json()).plano).toBe('Plano B');
  });
});
