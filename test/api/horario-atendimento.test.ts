// fase6-atendimento-lead (US-182): `GET/PUT /api/configuracoes/horario-atendimento` contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { HORARIO_PADRAO } from '../../src/domain/atendimento/horario-comercial';
import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('fase6-atendimento-lead: API do horário de atendimento', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/configuracoes/horario-atendimento/route');
  let gerente: string;
  let atendente: string;
  let gerenteB: string;

  const req = (cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest('http://localhost/api/configuracoes/horario-atendimento', {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const ler = (cookie: string | null = gerente) => rota.GET(req(cookie));
  const gravar = (horario: unknown, cookie: string | null = gerente) => rota.PUT(req(cookie, 'PUT', { horario }));

  const sabadoTambem = { ...HORARIO_PADRAO, sab: { atende: true, abre: '08:00', fecha: '13:00' } };

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f6h@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f6h@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f6h@teste.com', 'GERENTE', amb.tenants.empresaB);
    rota = await import('../../src/app/api/configuracoes/horario-atendimento/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('sem horário salvo a leitura traz o padrão (seg a sex, 9h às 18h); salvar grava e devolve @spec:AC-809', async () => {
    const antes = await (await ler()).json();
    expect(antes.padrao).toBe(true);
    expect(antes.horario).toEqual(HORARIO_PADRAO);

    const r = await gravar(sabadoTambem);
    expect(r.status).toBe(200);
    const depois = await r.json();
    expect(depois.padrao).toBe(false);
    expect(depois.horario.sab).toEqual({ atende: true, abre: '08:00', fecha: '13:00' });
    expect((await (await ler()).json()).horario.sab.fecha).toBe('13:00');
  });

  test('o atendente lê mas não grava; sem sessão dá 401; a empresa B não vê nem altera a da A @spec:AC-810', async () => {
    expect((await gravar(HORARIO_PADRAO, atendente)).status).toBe(403);
    expect((await ler(atendente)).status).toBe(200);
    expect((await ler(null)).status).toBe(401);
    expect((await gravar(HORARIO_PADRAO, null)).status).toBe(401);

    // a empresa B ainda está no padrão e grava o próprio, sem mexer no da A
    expect((await (await ler(gerenteB)).json()).padrao).toBe(true);
    expect((await gravar({ ...HORARIO_PADRAO, seg: { atende: false, abre: '09:00', fecha: '18:00' } }, gerenteB)).status).toBe(200);
    expect((await (await ler(gerente)).json()).horario.seg.atende).toBe(true);
    expect((await (await ler(gerenteB)).json()).horario.seg.atende).toBe(false);
  });

  test('horário inválido dá 400 HORARIO_INVALIDO com o motivo, e o que valia continua valendo @spec:AC-811', async () => {
    const invertido = { ...HORARIO_PADRAO, ter: { atende: true, abre: '18:00', fecha: '09:00' } };
    const r = await gravar(invertido);
    expect(r.status).toBe(400);
    const corpo = await r.json();
    expect(corpo.codigo).toBe('HORARIO_INVALIDO');
    expect(corpo.mensagem).toContain('depois');

    const nenhum = Object.fromEntries(Object.entries(HORARIO_PADRAO).map(([dia, item]) => [dia, { ...item, atende: false }]));
    expect((await gravar(nenhum)).status).toBe(400);
    expect((await gravar(undefined)).status).toBe(400);
    expect((await (await ler()).json()).horario.sab.atende).toBe(true); // o salvo no primeiro teste segue valendo
  });
});
