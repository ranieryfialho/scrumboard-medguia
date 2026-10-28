// T-212 (fase4-admin, US-140 a US-142): empresas da rede (só super admin) e o bloqueio de
// acesso de empresa suspensa, contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { criarAuth } from '../../src/lib/auth/server';
import { login } from '../../src/lib/auth/login';

describe('T-212: empresas da rede', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/admin/empresas/route');
  let rotaId: typeof import('../../src/app/api/admin/empresas/[id]/route');
  let rotaEquipe: typeof import('../../src/app/api/equipe/route');
  let superAdmin: string;
  let master: string;
  let gerente: string;

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
  const lista = (query = '', cookie: string | null = superAdmin) => rotaLista.GET(req(`/api/admin/empresas${query}`, cookie));
  const criar = (corpo: unknown, cookie: string | null = superAdmin) => rotaLista.POST(req('/api/admin/empresas', cookie, 'POST', corpo));
  const detalhe = (id: string, cookie: string | null = superAdmin) => rotaId.GET(req(`/api/admin/empresas/${id}`, cookie), { params: Promise.resolve({ id }) });
  const editar = (id: string, corpo: unknown, cookie: string | null = superAdmin) =>
    rotaId.PATCH(req(`/api/admin/empresas/${id}`, cookie, 'PATCH', corpo), { params: Promise.resolve({ id }) });
  const equipeDaB = () => rotaEquipe.GET(req('/api/equipe', amb.cookieB));
  const novaEmpresa = { nome: 'Hospital Santa Helena', slug: 'santa-helena', masterNome: 'Dr. Eduardo Sampaio', masterEmail: 'Eduardo@SantaHelena.com' };

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    superAdmin = await cookieDePapel(amb, 'super.f212@teste.com', 'GERENTE');
    sql(`UPDATE usuarios SET is_super_admin = true WHERE email = 'super.f212@teste.com'`);
    master = await cookieDePapel(amb, 'master.f212@teste.com', 'MASTER');
    gerente = await cookieDePapel(amb, 'gerente.f212@teste.com', 'GERENTE');
    rotaLista = await import('../../src/app/api/admin/empresas/route');
    rotaId = await import('../../src/app/api/admin/empresas/[id]/route');
    rotaEquipe = await import('../../src/app/api/equipe/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista as empresas com a quantidade de pessoas, filtros e resumo; só o super admin @spec:AC-599', async () => {
    const r = await lista();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    const a = corpo.empresas.find((e: { id: string }) => e.id === amb.tenants.empresaA);
    expect(a).toMatchObject({ nome: 'Empresa A', slug: 'empresa-a-repositorios', ativo: true });
    expect(a.usuariosAtivos).toBeGreaterThanOrEqual(4); // gerente.a, super, master e gerente do cenário
    expect(a.usuariosTotal).toBeGreaterThanOrEqual(a.usuariosAtivos);
    expect(corpo.resumo).toMatchObject({ total: 2, ativas: 2, inativas: 0 });
    expect(corpo.resumo.usuariosAtivos).toBeGreaterThanOrEqual(5);

    expect((await (await lista('?busca=empresa-b')).json()).empresas.map((e: { nome: string }) => e.nome)).toEqual(['Empresa B']);
    expect((await (await lista('?status=inativa')).json()).empresas).toEqual([]);
    expect((await lista('?status=x')).status).toBe(400);
    expect((await lista('', null)).status).toBe(401);
    expect((await lista('', master)).status).toBe(403);
    expect((await lista('', gerente)).status).toBe(403);
  });

  test('cria a empresa ativa e convida o master na mesma operação, com token de 24 h e link @spec:AC-604', async () => {
    const r = await criar(novaEmpresa);
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ slug: 'santa-helena', emailEnviado: false });
    expect(corpo.linkConvite).toMatch(/\/convite\/[0-9a-f]{64}$/);
    expect(sql(`SELECT nome || ' ' || ativo FROM empresas WHERE id = '${corpo.id}'`)).toBe('Hospital Santa Helena true');
    expect(sql(`SELECT papel || ' ' || ativo FROM empresas_usuarios WHERE empresa_id = '${corpo.id}' AND usuario_id = '${corpo.masterUsuarioId}'`)).toBe('MASTER true');
    expect(sql(`SELECT nome FROM usuarios WHERE id = '${corpo.masterUsuarioId}'`)).toBe('Dr. Eduardo Sampaio');
    expect(sql(`SELECT count(*) FROM tokens_verificacao WHERE identificador = 'convite:eduardo@santahelena.com'`)).toBe('1');
    expect((await (await lista('?busca=santa')).json()).empresas[0].usuariosTotal).toBe(1);
  });

  test('recusa nome, identificador e e-mail inválidos e identificador repetido sem criar nada @spec:AC-605', async () => {
    const antes = sql('SELECT count(*) FROM empresas');
    const com = (mudanca: Record<string, string>) => criar({ ...novaEmpresa, slug: 'outra-clinica', masterEmail: 'outro@x.com', ...mudanca });
    for (const [mudanca, campo] of [
      [{ nome: 'ab' }, 'nome'],
      [{ slug: 'AB' }, 'slug'],
      [{ slug: 'ab' }, 'slug'],
      [{ slug: '-clinica' }, 'slug'],
      [{ slug: 'clinica-' }, 'slug'],
      [{ slug: 'clínica' }, 'slug'],
      [{ slug: 'a'.repeat(41) }, 'slug'],
      [{ masterEmail: 'sem-arroba' }, 'masterEmail'],
      [{ masterNome: ' ' }, 'masterNome'],
    ] as [Record<string, string>, string][]) {
      const r = await com(mudanca);
      expect(r.status, JSON.stringify(mudanca)).toBe(400);
      expect((await r.json()).campo).toBe(campo);
    }
    const repetido = await com({ slug: 'santa-helena' });
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).codigo).toBe('SLUG_EM_USO');
    expect(sql('SELECT count(*) FROM empresas')).toBe(antes);
    expect((await criar(novaEmpresa, null)).status).toBe(401);
    expect((await criar({ ...novaEmpresa, slug: 'x-clinica' }, master)).status).toBe(403);
  });

  test('o detalhe traz a empresa e as pessoas; desconhecida ou fora do formato é 404 @spec:AC-608', async () => {
    const r = await detalhe(amb.tenants.empresaA);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.empresa).toMatchObject({ id: amb.tenants.empresaA, nome: 'Empresa A', slug: 'empresa-a-repositorios', ativo: true });
    expect(corpo.colaboradores.map((c: { email: string }) => c.email)).toContain('master.f212@teste.com');
    expect(corpo.resumo.total).toBe(corpo.colaboradores.length);
    expect((await detalhe('b2b2b2b2-0000-0000-0000-00000000ffff')).status).toBe(404);
    expect((await detalhe('nao-uuid')).status).toBe(404);
    expect((await detalhe(amb.tenants.empresaA, master)).status).toBe(403);
    expect((await detalhe(amb.tenants.empresaA, null)).status).toBe(401);
  });

  test('muda o nome e a situação, nunca o identificador, e não suspende a empresa atual do super admin @spec:AC-609', async () => {
    const ok = await editar(amb.tenants.empresaB, { nome: '  Empresa B Renomeada ', slug: 'tentativa-de-mudar' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ nome: 'Empresa B Renomeada', slug: 'empresa-b-repositorios' });
    expect(sql(`SELECT slug FROM empresas WHERE id = '${amb.tenants.empresaB}'`)).toBe('empresa-b-repositorios');

    expect((await editar(amb.tenants.empresaB, { nome: 'ab' })).status).toBe(400);
    expect((await editar(amb.tenants.empresaB, {})).status).toBe(400);
    expect((await editar(amb.tenants.empresaB, { ativo: 'sim' })).status).toBe(400);
    const atual = await editar(amb.tenants.empresaA, { ativo: false });
    expect(atual.status).toBe(422);
    expect((await atual.json()).codigo).toBe('EMPRESA_ATUAL');
    expect(sql(`SELECT ativo FROM empresas WHERE id = '${amb.tenants.empresaA}'`)).toBe('t');
    expect((await editar('b2b2b2b2-0000-0000-0000-00000000ffff', { nome: 'Qualquer' })).status).toBe(404);
    expect((await editar(amb.tenants.empresaB, { nome: 'Qualquer' }, master)).status).toBe(403);
  });

  test('empresa suspensa barra a sessão e a entrada dos usuários dela, e reativar devolve, sem afetar as outras @spec:AC-610', async () => {
    expect((await equipeDaB()).status).toBe(200);
    expect((await editar(amb.tenants.empresaB, { ativo: false })).status).toBe(200);

    expect((await equipeDaB()).status).toBe(401); // a sessão dele não vale mais
    await expect(login(criarAuth(amb.db), amb.db, 'gerente.b@teste.com', 'senha-correta-123')).rejects.toThrow();
    expect((await rotaEquipe.GET(req('/api/equipe', gerente))).status).toBe(200); // a empresa A segue normal
    expect((await lista()).status).toBe(200); // o super admin segue administrando
    expect(sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaB}'`)).toBe('1'); // dados intactos

    expect((await editar(amb.tenants.empresaB, { ativo: true })).status).toBe(200);
    expect((await equipeDaB()).status).toBe(200);
    const entrou = await login(criarAuth(amb.db), amb.db, 'gerente.b@teste.com', 'senha-correta-123');
    expect(entrou.token).toBeTruthy();
  });
});
