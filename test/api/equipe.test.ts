// T-209 (fase4-admin, US-137): a equipe da empresa — listar, trocar papel, desativar e
// reenviar convite, contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ID = (n: number) => `afafafaf-3010-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const ANA = ID(1); // ATENDENTE ativa, com senha e login
const BIA = ID(2); // ATENDENTE pendente
const CAIO = ID(3); // GERENTE desativado, com senha
const GIL = ID(4); // GERENTE pendente
const DUDA = ID(5); // outra empresa

describe('T-209: equipe da empresa', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/equipe/route');
  let rotaUsuario: typeof import('../../src/app/api/equipe/[usuarioId]/route');
  let rotaReenvio: typeof import('../../src/app/api/equipe/[usuarioId]/reenviar-convite/route');
  let master: string;
  let gerente: string;
  let atendente: string;
  let superAdmin: string;
  let masterId: string;

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
  const lista = (query = '', cookie: string | null = master) => rotaLista.GET(req(`/api/equipe${query}`, cookie));
  const patch = (id: string, corpo: unknown, cookie: string | null = master) =>
    rotaUsuario.PATCH(req(`/api/equipe/${id}`, cookie, 'PATCH', corpo), { params: Promise.resolve({ usuarioId: id }) });
  const reenviar = (id: string, cookie: string | null = master) =>
    rotaReenvio.POST(req(`/api/equipe/${id}/reenviar-convite`, cookie, 'POST'), { params: Promise.resolve({ usuarioId: id }) });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    master = await cookieDePapel(amb, 'master.f209@teste.com', 'MASTER');
    gerente = await cookieDePapel(amb, 'gerente.f209@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f209@teste.com', 'ATENDENTE');
    superAdmin = await cookieDePapel(amb, 'super.f209@teste.com', 'GERENTE');
    sql(`UPDATE usuarios SET is_super_admin = true WHERE email = 'super.f209@teste.com'`);
    masterId = sql(`SELECT id FROM usuarios WHERE email = 'master.f209@teste.com'`);
    sql(`INSERT INTO usuarios (id, email, nome) VALUES
           ('${ANA}', 'ana@f209.com', 'Ana Atendente'), ('${BIA}', 'bia@f209.com', 'Bia Pendente'),
           ('${CAIO}', 'caio@f209.com', 'Caio Desativado'), ('${GIL}', 'gil@f209.com', 'Gil Pendente'), ('${DUDA}', 'duda@f209.com', 'Duda Outra');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel, ativo) VALUES
           ('${empresaA}', '${ANA}', 'ATENDENTE', true), ('${empresaA}', '${BIA}', 'ATENDENTE', true),
           ('${empresaA}', '${CAIO}', 'GERENTE', false), ('${empresaA}', '${GIL}', 'GERENTE', true), ('${empresaB}', '${DUDA}', 'ATENDENTE', true);
         INSERT INTO contas (usuario_id, id_conta, id_provedor, senha) VALUES
           ('${ANA}', '${ANA}', 'credential', 'x'), ('${CAIO}', '${CAIO}', 'credential', 'x');
         INSERT INTO sessoes (usuario_id, token, expira_em, criado_em) VALUES
           ('${ANA}', 'tok-ana-1', now() + interval '1 day', '2026-10-20T12:00:00Z'), ('${ANA}', 'tok-ana-2', now() + interval '1 day', '2026-10-25T15:30:00Z');
         INSERT INTO tokens_verificacao (identificador, valor, expira_em) VALUES
           ('convite:bia@f209.com', 'token-antigo-da-bia', now() + interval '1 day');`);
    rotaLista = await import('../../src/app/api/equipe/route');
    rotaUsuario = await import('../../src/app/api/equipe/[usuarioId]/route');
    rotaReenvio = await import('../../src/app/api/equipe/[usuarioId]/reenviar-convite/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista só a equipe da empresa, com filtros, busca, paginação e resumo; atendente 403, sem sessão 401 @spec:AC-578', async () => {
    const r = await lista();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    const emails = corpo.colaboradores.map((c: { email: string }) => c.email);
    expect(emails).toContain('ana@f209.com');
    expect(emails).not.toContain('duda@f209.com');
    expect(corpo.total).toBe(corpo.colaboradores.length);
    expect(corpo.resumo).toEqual({ total: 9, ativos: 6, pendentes: 2, inativos: 1 });
    expect(corpo.colaboradores[0]).toHaveProperty('ultimoAcesso');

    expect((await (await lista('?papel=GERENTE')).json()).colaboradores.every((c: { papel: string }) => c.papel === 'GERENTE')).toBe(true);
    expect((await (await lista('?status=pendente')).json()).total).toBe(2);
    expect((await (await lista('?busca=ana%20atend')).json()).colaboradores.map((c: { email: string }) => c.email)).toEqual(['ana@f209.com']);
    const pagina = await (await lista('?pagina=2&porPagina=3')).json();
    expect(pagina.colaboradores).toHaveLength(3);
    expect(pagina.total).toBe(9);
    expect(pagina.resumo.total).toBe(9);

    expect((await lista('?papel=DONO')).status).toBe(400);
    expect((await lista('?status=x')).status).toBe(400);
    expect((await lista('?pagina=0&porPagina=5')).status).toBe(400);
    expect((await lista('', null)).status).toBe(401);
    expect((await lista('', atendente)).status).toBe(403);
    expect((await lista('', gerente)).status).toBe(200);
  });

  test('a situação é ativo, pendente ou inativo e o último acesso é o login mais recente @spec:AC-579', async () => {
    const { colaboradores } = await (await lista()).json();
    const por = Object.fromEntries(colaboradores.map((c: { email: string }) => [c.email, c]));
    expect(por['ana@f209.com']).toMatchObject({ status: 'ativo', papel: 'ATENDENTE', nome: 'Ana Atendente' });
    expect(por['ana@f209.com'].ultimoAcesso).toBe('2026-10-25T15:30:00.000Z');
    expect(por['bia@f209.com']).toMatchObject({ status: 'pendente', ultimoAcesso: null });
    expect(por['caio@f209.com']).toMatchObject({ status: 'inativo', papel: 'GERENTE' });
    expect(por['master.f209@teste.com'].status).toBe('ativo');
    expect(por['master.f209@teste.com'].ultimoAcesso).toBeTruthy();
  });

  test('só o master troca o papel; nunca o próprio, nunca o último master, nunca de outra empresa @spec:AC-582', async () => {
    expect((await patch(ANA, { papel: 'GERENTE' }, gerente)).status).toBe(403);
    expect((await patch(ANA, { papel: 'GERENTE' }, atendente)).status).toBe(403);
    expect((await patch(ANA, { papel: 'GERENTE' }, null)).status).toBe(401);

    const ok = await patch(ANA, { papel: 'GERENTE' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).papel).toBe('GERENTE');
    expect(sql(`SELECT papel FROM empresas_usuarios WHERE usuario_id = '${ANA}'`)).toBe('GERENTE');
    await patch(ANA, { papel: 'ATENDENTE' });

    const eu = await patch(masterId, { papel: 'GERENTE' });
    expect(eu.status).toBe(422);
    expect((await eu.json()).codigo).toBe('NAO_PODE_ALTERAR_A_SI');

    // o super admin (que não é o master) tenta rebaixar o único master
    const ultimo = await patch(masterId, { papel: 'GERENTE' }, superAdmin);
    expect(ultimo.status).toBe(422);
    expect((await ultimo.json()).codigo).toBe('ULTIMO_MASTER');
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ID(9)}', 'master2@f209.com', 'Segundo Master');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel, ativo) VALUES ('${amb.tenants.empresaA}', '${ID(9)}', 'MASTER', true);
         INSERT INTO contas (usuario_id, id_conta, id_provedor, senha) VALUES ('${ID(9)}', '${ID(9)}', 'credential', 'x');`);
    expect((await patch(masterId, { papel: 'GERENTE' }, superAdmin)).status).toBe(200);
    expect(sql(`SELECT papel FROM empresas_usuarios WHERE usuario_id = '${masterId}'`)).toBe('GERENTE');
    expect((await patch(masterId, { papel: 'MASTER' }, superAdmin)).status).toBe(200);

    expect((await patch(DUDA, { papel: 'GERENTE' })).status).toBe(404);
    expect((await patch('nao-uuid', { papel: 'GERENTE' })).status).toBe(404);
    expect((await patch(ANA, { papel: 'DONO' })).status).toBe(400);
    expect((await patch(ANA, {})).status).toBe(400);
  });

  test('desativar tira o acesso da pessoa, reativar devolve, e as mesmas recusas valem @spec:AC-583', async () => {
    const quem = await cookieDePapel(amb, 'quem.f209@teste.com', 'ATENDENTE');
    expect((await lista('', quem)).status).toBe(403); // sessão válida, sem papel para a lista
    const quemId = sql(`SELECT id FROM usuarios WHERE email = 'quem.f209@teste.com'`);

    const desativar = await patch(quemId, { ativo: false });
    expect(desativar.status).toBe(200);
    expect((await desativar.json()).status).toBe('inativo');
    expect((await lista('', quem)).status).toBe(401); // a sessão dele não vale mais nesta empresa

    expect((await (await patch(quemId, { ativo: true })).json()).status).toBe('ativo');
    expect((await lista('', quem)).status).toBe(403);

    expect((await patch(masterId, { ativo: false })).status).toBe(422);
    expect((await (await patch(masterId, { ativo: false })).json()).codigo).toBe('NAO_PODE_ALTERAR_A_SI');
    expect((await patch(DUDA, { ativo: false })).status).toBe(404);
    expect(sql(`SELECT count(*) FROM empresas_usuarios WHERE usuario_id = '${quemId}'`)).toBe('1'); // histórico intacto
  });

  test('reenviar convite gera token novo, invalida o antigo e só vale para quem está pendente @spec:AC-584', async () => {
    const r = await reenviar(BIA);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.emailEnviado).toBe(false); // sem RESEND_API_KEY no teste
    expect(corpo.linkConvite).toMatch(/\/convite\/[0-9a-f]{64}$/);
    expect(sql(`SELECT count(*) FROM tokens_verificacao WHERE valor = 'token-antigo-da-bia'`)).toBe('0');
    expect(sql(`SELECT count(*) FROM tokens_verificacao WHERE identificador = 'convite:bia@f209.com'`)).toBe('1');

    const jaAtiva = await reenviar(ANA);
    expect(jaAtiva.status).toBe(422);
    expect((await jaAtiva.json()).codigo).toBe('CONVITE_NAO_PENDENTE');
    expect((await reenviar(CAIO)).status).toBe(422);
    expect((await reenviar(GIL, gerente)).status).toBe(403); // gerente só reenvia para atendente
    expect((await reenviar(BIA, gerente)).status).toBe(200);
    expect((await reenviar(DUDA)).status).toBe(404);
    expect((await reenviar(BIA, atendente)).status).toBe(403);
    expect((await reenviar(BIA, null)).status).toBe(401);
  });
});
