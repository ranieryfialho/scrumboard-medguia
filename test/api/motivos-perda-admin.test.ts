// T-211 (fase4-admin, US-139): catálogo de motivos de perda para a administração, contra um
// Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const MOTIVO_A = 'b1b1b1b1-3030-0000-0000-0000000000a1';
const MOTIVO_B = 'b1b1b1b1-3030-0000-0000-0000000000a2';
const MOTIVO_INATIVO = 'b1b1b1b1-3030-0000-0000-0000000000a3';
const ID = (n: number) => `b1b1b1b1-3031-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-211: motivos de perda (administração)', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/configuracoes/motivos-perda/route');
  let rotaId: typeof import('../../src/app/api/configuracoes/motivos-perda/[id]/route');
  let gerente: string;
  let atendente: string;
  let superAdmin: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const req = (url: string, cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const lista = (query = '', cookie: string | null = gerente) => rota.GET(req(`/api/configuracoes/motivos-perda${query}`, cookie));
  const criar = (corpo: unknown, cookie: string | null = superAdmin) => rota.POST(req('/api/configuracoes/motivos-perda', cookie, 'POST', corpo));
  const alterar = (id: string, corpo: unknown, cookie: string | null = superAdmin) =>
    rotaId.PATCH(req(`/api/configuracoes/motivos-perda/${id}`, cookie, 'PATCH', corpo), { params: Promise.resolve({ id }) });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB, leadA, leadB } = amb.tenants;
    gerente = await cookieDePapel(amb, 'gerente.f211@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f211@teste.com', 'ATENDENTE');
    superAdmin = await cookieDePapel(amb, 'super.f211@teste.com', 'GERENTE');
    sql(`UPDATE usuarios SET is_super_admin = true WHERE email = 'super.f211@teste.com'`);
    sql(`INSERT INTO motivos_perda (id, nome, ativo, e_sistemico) VALUES
           ('${MOTIVO_A}', 'Zz Preço do teste', true, true), ('${MOTIVO_B}', 'Zz Concorrente do teste', true, false), ('${MOTIVO_INATIVO}', 'Zz Antigo do teste', false, false);
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, motivo_perda_id) VALUES
           ('${ID(1)}', '${empresaA}', '${leadA}', 14, '${MOTIVO_A}'), ('${ID(2)}', '${empresaA}', '${leadA}', 14, '${MOTIVO_A}'),
           ('${ID(3)}', '${empresaA}', '${leadA}', 14, '${MOTIVO_B}'), ('${ID(4)}', '${empresaA}', '${leadA}', 14, '${MOTIVO_B}'),
           ('${ID(5)}', '${empresaB}', '${leadB}', 14, '${MOTIVO_A}');
         INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo, ocorrido_em) VALUES
           ('${empresaA}', '${ID(1)}', 'transicao_etapa', 14, 'sistema', now()),
           ('${empresaA}', '${ID(2)}', 'transicao_etapa', 14, 'sistema', now()),
           ('${empresaA}', '${ID(3)}', 'transicao_etapa', 14, 'sistema', now() - interval '90 days'),
           ('${empresaB}', '${ID(5)}', 'transicao_etapa', 14, 'sistema', now());`);
    rota = await import('../../src/app/api/configuracoes/motivos-perda/route');
    rotaId = await import('../../src/app/api/configuracoes/motivos-perda/[id]/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista todos os motivos, inclusive inativos, com o uso na empresa da sessão e os totais do catálogo @spec:AC-593', async () => {
    const r = await lista();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    const por = Object.fromEntries(corpo.motivos.map((m: { id: string }) => [m.id, m]));
    expect(por[MOTIVO_A]).toMatchObject({ nome: 'Zz Preço do teste', sistemico: true, ativo: true, usadoTotal: 2, usadoNoMes: 2, podeEditar: false });
    expect(por[MOTIVO_B]).toMatchObject({ sistemico: false, usadoTotal: 2, usadoNoMes: 0, podeEditar: false });
    expect(por[MOTIVO_INATIVO]).toMatchObject({ ativo: false, usadoTotal: 0 });
    expect(corpo.totais.total).toBe(corpo.motivos.length);
    expect(corpo.totais.sistemicos + corpo.totais.personalizados).toBe(corpo.totais.total);

    const daB = await (await lista('', await cookieDePapel(amb, 'gerente.b.f211@teste.com', 'GERENTE', amb.tenants.empresaB))).json();
    expect(daB.motivos.find((m: { id: string }) => m.id === MOTIVO_A)).toMatchObject({ usadoTotal: 1, usadoNoMes: 1 });

    expect((await (await lista('?tipo=personalizado&busca=zz')).json()).motivos.map((m: { id: string }) => m.id).sort()).toEqual([MOTIVO_B, MOTIVO_INATIVO].sort());
    expect((await (await lista('?status=inativo&busca=zz')).json()).motivos.map((m: { id: string }) => m.id)).toEqual([MOTIVO_INATIVO]);
    expect((await (await lista('?tipo=sistemico&busca=zz')).json()).motivos.map((m: { id: string }) => m.id)).toEqual([MOTIVO_A]);
    expect((await lista('?tipo=x')).status).toBe(400);
    expect((await lista('?status=x')).status).toBe(400);
    expect((await lista('', null)).status).toBe(401);
    expect((await lista('', atendente)).status).toBe(403);

    const doSuper = await (await lista('?busca=zz', superAdmin)).json();
    expect(doSuper.motivos.find((m: { id: string }) => m.id === MOTIVO_B).podeEditar).toBe(true);
    expect(doSuper.motivos.find((m: { id: string }) => m.id === MOTIVO_A).podeEditar).toBe(false);
  });

  test('o resumo traz as perdas do mês e o principal motivo com a porcentagem @spec:AC-593', async () => {
    const { resumo } = await (await lista()).json();
    expect(resumo.perdasNoMes).toBe(2);
    expect(resumo.principal).toEqual({ nome: 'Zz Preço do teste', quantidade: 2, percentual: 100 });
  });

  test('gerente cria e (des)ativa motivo da empresa; o atendente não; o global e o sistêmico não mudam para ele @spec:AC-596', async () => {
    expect((await criar({ nome: 'Motivo novo' }, atendente)).status).toBe(403);
    expect((await criar({ nome: 'Motivo novo' }, null)).status).toBe(401);
    expect((await alterar(MOTIVO_B, { ativo: false }, atendente)).status).toBe(403);
    // fase5: o global não sistêmico é "da rede" — só o super admin altera
    const daRede = await alterar(MOTIVO_B, { ativo: false }, gerente);
    expect(daRede.status).toBe(422);
    expect((await daRede.json()).codigo).toBe('MOTIVO_DA_REDE');

    const r = await criar({ nome: '  Motivo novo do teste  ' });
    expect(r.status).toBe(201);
    const novo = await r.json();
    expect(novo).toMatchObject({ nome: 'Motivo novo do teste', sistemico: false, ativo: true });
    const repetido = await criar({ nome: 'motivo NOVO do teste' });
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).codigo).toBe('MOTIVO_JA_EXISTE');
    expect((await criar({ nome: 'ab' })).status).toBe(400);
    expect((await criar({ nome: 'x'.repeat(81) })).status).toBe(400);
    expect((await criar({})).status).toBe(400);

    expect(await (await alterar(novo.id, { ativo: false })).json()).toMatchObject({ ativo: false });
    expect(sql(`SELECT ativo FROM motivos_perda WHERE id = '${novo.id}'`)).toBe('f');
    expect(await (await alterar(novo.id, { ativo: true })).json()).toMatchObject({ ativo: true });

    const sistemico = await alterar(MOTIVO_A, { ativo: false });
    expect(sistemico.status).toBe(422);
    expect((await sistemico.json()).codigo).toBe('MOTIVO_SISTEMICO');
    expect(sql(`SELECT ativo FROM motivos_perda WHERE id = '${MOTIVO_A}'`)).toBe('t');
    expect((await alterar('b1b1b1b1-3030-0000-0000-00000000ffff', { ativo: false })).status).toBe(404);
    expect((await alterar(novo.id, { ativo: 'sim' })).status).toBe(400);
  });
});
