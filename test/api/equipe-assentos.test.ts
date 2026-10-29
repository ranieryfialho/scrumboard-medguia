// T-239 (fase5-empresa-dados, US-154): a cota de assentos no convite e na reativação, contra um
// Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const CAIO = 'b0b0b0b0-6550-0000-0000-0000000000a3';

describe('T-239: cota de assentos', () => {
  let amb: AmbienteAnexos;
  let convites: typeof import('../../src/app/api/equipe/convites/route');
  let equipe: typeof import('../../src/app/api/equipe/route');
  let colaborador: typeof import('../../src/app/api/equipe/[usuarioId]/route');
  let master: string;
  let gerente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const emUso = () => Number(sql(`SELECT count(*) FROM empresas_usuarios WHERE empresa_id = '${amb.tenants.empresaA}' AND ativo`));
  const convidar = (email: string, cookie = master) =>
    convites.POST(new NextRequest('http://localhost/api/equipe/convites', { method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email, nome: 'Fulano', papel: 'ATENDENTE' }) }));
  const alterar = (usuarioId: string, corpo: unknown) =>
    colaborador.PATCH(new NextRequest(`http://localhost/api/equipe/${usuarioId}`, { method: 'PATCH', headers: { Cookie: master, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }), { params: Promise.resolve({ usuarioId }) });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    master = await cookieDePapel(amb, 'master.f655@teste.com', 'MASTER');
    gerente = await cookieDePapel(amb, 'gerente.f655@teste.com', 'GERENTE');
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${CAIO}', 'caio@f655.com', 'Caio Desativado');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel, ativo) VALUES ('${amb.tenants.empresaA}', '${CAIO}', 'ATENDENTE', false);
         INSERT INTO contas (usuario_id, id_conta, id_provedor, senha) VALUES ('${CAIO}', '${CAIO}', 'credential', 'x');`);
    convites = await import('../../src/app/api/equipe/convites/route');
    equipe = await import('../../src/app/api/equipe/route');
    colaborador = await import('../../src/app/api/equipe/[usuarioId]/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('sem cota o convite passa; com a cota cheia dá 409 SEM_ASSENTOS sem criar nada; desativar libera um assento @spec:AC-655', async () => {
    expect((await convidar('livre@f655.com')).status).toBe(201); // assentos vazio = sem limite

    sql(`UPDATE empresas SET assentos = ${emUso()} WHERE id = '${amb.tenants.empresaA}'`); // lotada
    const antes = sql('SELECT count(*) FROM empresas_usuarios');
    const r = await convidar('lotada@f655.com');
    expect(r.status).toBe(409);
    expect((await r.json()).codigo).toBe('SEM_ASSENTOS');
    expect(sql('SELECT count(*) FROM empresas_usuarios')).toBe(antes);
    expect(sql(`SELECT count(*) FROM usuarios WHERE email = 'lotada@f655.com'`)).toBe('0');

    // o convite pendente reservou o assento; desativar alguém libera
    const livre = sql(`SELECT id FROM usuarios WHERE email = 'livre@f655.com'`);
    expect((await alterar(livre, { ativo: false })).status).toBe(200);
    expect((await convidar('depois@f655.com')).status).toBe(201);
    expect(emUso()).toBe(Number(sql(`SELECT assentos FROM empresas WHERE id = '${amb.tenants.empresaA}'`)));
  });

  test('reativar com a cota cheia dá 409 SEM_ASSENTOS e a pessoa continua desativada, pela troca de situação e pelo convite @spec:AC-656', async () => {
    const porSituacao = await alterar(CAIO, { ativo: true });
    expect(porSituacao.status).toBe(409);
    expect((await porSituacao.json()).codigo).toBe('SEM_ASSENTOS');
    const porConvite = await convidar('caio@f655.com');
    expect(porConvite.status).toBe(409);
    expect((await porConvite.json()).codigo).toBe('SEM_ASSENTOS');
    expect(sql(`SELECT ativo::text FROM empresas_usuarios WHERE usuario_id = '${CAIO}'`)).toBe('false');

    sql(`UPDATE empresas SET assentos = assentos + 1 WHERE id = '${amb.tenants.empresaA}'`);
    expect((await alterar(CAIO, { ativo: true })).status).toBe(200);
  });

  test('a equipe devolve os assentos em uso e o limite @spec:AC-659', async () => {
    const corpo = await (await equipe.GET(new NextRequest('http://localhost/api/equipe', { headers: { Cookie: gerente } }))).json();
    expect(corpo.assentos).toEqual({ emUso: emUso(), limite: Number(sql(`SELECT assentos FROM empresas WHERE id = '${amb.tenants.empresaA}'`)) });
    sql(`UPDATE empresas SET assentos = NULL WHERE id = '${amb.tenants.empresaA}'`);
    expect((await (await equipe.GET(new NextRequest('http://localhost/api/equipe', { headers: { Cookie: gerente } }))).json()).assentos.limite).toBeNull();
  });
});
