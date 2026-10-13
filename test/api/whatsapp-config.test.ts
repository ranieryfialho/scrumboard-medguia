// Testes de T-085 (fase2c-whatsapp-conexao, US-048/US-049): rota GET e POST
// /api/whatsapp/config contra um Postgres 15 efêmero real. Mesmo molde de
// test/api/whatsapp-send.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'f1000000-0000-0000-0000-00000000000a';
const EMPRESA_B = 'f1000000-0000-0000-0000-00000000000b';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-085: GET e POST /api/whatsapp/config', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rota: typeof import('../../src/app/api/whatsapp/config/route');
  let cookieMasterA: string;
  let cookieGerenteA: string;
  let cookieAtendenteA: string;
  let cookieGerenteB: string;

  function getConfig(cookie: string | null) {
    const request = new NextRequest('http://localhost/api/whatsapp/config', {
      method: 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rota.GET(request);
  }

  function postConfig(cookie: string | null, body: unknown) {
    const request = new NextRequest('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return rota.POST(request);
  }

  function valorGravado(empresaId: string, chave: string): string | null {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "valor" FROM "empresa_configuracoes" WHERE "empresa_id" = '${empresaId}' AND "chave" = '${chave}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    const linha = resultado.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !/^(SET|BEGIN|COMMIT|ROLLBACK|SELECT \d+)$/.test(l));
    return linha[0] ?? null;
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Config Rota', 'empresa-a-whatsapp-config-rota'),
         ('${EMPRESA_B}', 'Empresa B Config Rota', 'empresa-b-whatsapp-config-rota');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_A}', 'evolution_instance_name', '"instancia-a-rota"'::jsonb),
         ('${EMPRESA_A}', 'evolution_auto_msg_em_contato', '"Olá!"'::jsonb),
         ('${EMPRESA_A}', 'evolution_webhook_secret', '"segredo-super-secreto-da-empresa-a"'::jsonb),
         ('${EMPRESA_B}', 'evolution_instance_name', '"instancia-b-rota"'::jsonb);`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-config: ${setup.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000001f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000001f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a@teste.com', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, {
      email: 'atendente.a@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rota = await import('../../src/app/api/whatsapp/config/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a@teste.com', SENHA);
    cookieGerenteA = await loginComoCookie(auth, 'gerente.a@teste.com', SENHA);
    cookieAtendenteA = await loginComoCookie(auth, 'atendente.a@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie(auth, 'gerente.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('sem sessão: GET e POST em /api/whatsapp/config são recusados com 401 @spec:AC-167', async () => {
    const respostaGet = await getConfig(null);
    expect(respostaGet.status).toBe(401);
    expect((await respostaGet.json()).codigo).toBe('NAO_AUTENTICADO');

    const respostaPost = await postConfig(null, { evolution_instance_name: 'tentativa' });
    expect(respostaPost.status).toBe(401);
    expect((await respostaPost.json()).codigo).toBe('NAO_AUTENTICADO');
    expect(valorGravado(EMPRESA_A, 'evolution_instance_name')).toBe('"instancia-a-rota"');
  });

  test('a configuração devolvida (inclusive para o atendente) traz só as chaves permitidas, nunca o segredo @spec:AC-168', async () => {
    for (const cookie of [cookieMasterA, cookieGerenteA, cookieAtendenteA]) {
      const resposta = await getConfig(cookie);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.empresaId).toBe(EMPRESA_A);
      expect(corpo.config.evolution_instance_name).toBe('instancia-a-rota');
      expect(corpo.config.evolution_auto_msg_em_contato).toBe('Olá!');
      expect(corpo.config).not.toHaveProperty('evolution_webhook_secret');
      expect(JSON.stringify(corpo)).not.toContain('segredo-super-secreto-da-empresa-a');
    }
  });

  test('a configuração de outra empresa não aparece @spec:AC-169', async () => {
    const respostaA = await getConfig(cookieGerenteA);
    const respostaB = await getConfig(cookieGerenteB);
    const corpoA = await respostaA.json();
    const corpoB = await respostaB.json();

    expect(corpoA.empresaId).toBe(EMPRESA_A);
    expect(corpoB.empresaId).toBe(EMPRESA_B);
    expect(corpoA.config.evolution_instance_name).toBe('instancia-a-rota');
    expect(corpoB.config.evolution_instance_name).toBe('instancia-b-rota');
    expect(JSON.stringify(corpoA)).not.toContain('instancia-b-rota');
    expect(JSON.stringify(corpoB)).not.toContain('instancia-a-rota');
  });

  test('MASTER e GERENTE salvam a configuração; um GET seguinte devolve os valores salvos @spec:AC-170', async () => {
    const respostaMaster = await postConfig(cookieMasterA, {
      evolution_auto_msg_recontato: 'Mensagem do MASTER',
    });
    expect(respostaMaster.status).toBe(200);
    expect(await respostaMaster.json()).toEqual({ success: true });

    let config = (await (await getConfig(cookieMasterA)).json()).config;
    expect(config.evolution_auto_msg_recontato).toBe('Mensagem do MASTER');

    const respostaGerente = await postConfig(cookieGerenteA, {
      evolution_auto_msg_recontato: 'Mensagem do GERENTE',
    });
    expect(respostaGerente.status).toBe(200);
    expect(await respostaGerente.json()).toEqual({ success: true });

    config = (await (await getConfig(cookieGerenteA)).json()).config;
    expect(config.evolution_auto_msg_recontato).toBe('Mensagem do GERENTE');

    const linhas = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_A}' AND "chave" = 'evolution_auto_msg_recontato'`
    );
    expect(linhas.stdout.trim()).toBe('1');
  });

  test('atendente não altera a configuração: 403, nada é gravado @spec:AC-171', async () => {
    const antes = valorGravado(EMPRESA_A, 'evolution_auto_msg_reuniao_agendada');

    const resposta = await postConfig(cookieAtendenteA, {
      evolution_auto_msg_reuniao_agendada: 'não deveria gravar',
    });

    expect(resposta.status).toBe(403);
    expect((await resposta.json()).codigo).toBe('SEM_PERMISSAO');
    expect(valorGravado(EMPRESA_A, 'evolution_auto_msg_reuniao_agendada')).toBe(antes);
  });

  test('só as chaves permitidas são gravadas: segredo, chave qualquer e empresa_id do corpo são ignorados @spec:AC-172', async () => {
    const segredoAntes = valorGravado(EMPRESA_A, 'evolution_webhook_secret');

    const resposta = await postConfig(cookieGerenteA, {
      evolution_auto_msg_logins_ativados: 'Atualizado',
      evolution_webhook_secret: 'segredo-tentando-trocar',
      chave_qualquer: 'ignorar',
      empresa_id: EMPRESA_B,
    });

    expect(resposta.status).toBe(200);
    expect(valorGravado(EMPRESA_A, 'evolution_auto_msg_logins_ativados')).toBe('"Atualizado"');
    expect(valorGravado(EMPRESA_A, 'evolution_webhook_secret')).toBe(segredoAntes);
    expect(valorGravado(EMPRESA_A, 'chave_qualquer')).toBeNull();
    expect(valorGravado(EMPRESA_B, 'evolution_auto_msg_logins_ativados')).toBeNull();
  });

  test('nome de instância já usado por outra empresa é recusado (409); o próprio nome continua salvável @spec:AC-173', async () => {
    const antes = valorGravado(EMPRESA_A, 'evolution_instance_name');

    const conflito = await postConfig(cookieGerenteA, { evolution_instance_name: 'instancia-b-rota' });
    expect(conflito.status).toBe(409);
    expect((await conflito.json()).codigo).toBe('INSTANCIA_EM_USO');
    expect(valorGravado(EMPRESA_A, 'evolution_instance_name')).toBe(antes);

    const proprio = await postConfig(cookieGerenteA, { evolution_instance_name: 'instancia-a-rota' });
    expect(proprio.status).toBe(200);
    expect(valorGravado(EMPRESA_A, 'evolution_instance_name')).toBe('"instancia-a-rota"');
  });

  test('corpo ou nome de instância inválido: 400, nada é gravado (nem as outras chaves do pedido) @spec:AC-174', async () => {
    const antesNome = valorGravado(EMPRESA_A, 'evolution_instance_name');
    const antesMsg = valorGravado(EMPRESA_A, 'evolution_auto_msg_aguardando_ativacao');

    const corpoNaoObjeto = await postConfig(cookieGerenteA, 'não é objeto');
    const valorNaoTexto = await postConfig(cookieGerenteA, { evolution_instance_name: 123 });
    const nomeVazio = await postConfig(cookieGerenteA, { evolution_instance_name: '' });
    const nomeGrande = await postConfig(cookieGerenteA, { evolution_instance_name: 'x'.repeat(65) });
    const nomeComCaracterInvalido = await postConfig(cookieGerenteA, {
      evolution_instance_name: 'tem espaço',
      evolution_auto_msg_aguardando_ativacao: 'não deveria gravar',
    });
    const nomeComBarra = await postConfig(cookieGerenteA, { evolution_instance_name: 'a/b' });

    for (const resposta of [
      corpoNaoObjeto,
      valorNaoTexto,
      nomeVazio,
      nomeGrande,
      nomeComCaracterInvalido,
      nomeComBarra,
    ]) {
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('REQUISICAO_INVALIDA');
    }
    expect(valorGravado(EMPRESA_A, 'evolution_instance_name')).toBe(antesNome);
    expect(valorGravado(EMPRESA_A, 'evolution_auto_msg_aguardando_ativacao')).toBe(antesMsg);
  });

  test('o segredo do webhook nunca sai nas respostas, mesmo em erro @spec:AC-183', async () => {
    const respostas = await Promise.all([
      getConfig(cookieGerenteA),
      postConfig(cookieAtendenteA, { evolution_instance_name: 'instancia-a-rota' }),
      postConfig(cookieGerenteA, { evolution_instance_name: 'instancia-b-rota' }),
      postConfig(cookieGerenteA, 'corpo invalido'),
    ]);

    for (const resposta of respostas) {
      const texto = JSON.stringify(await resposta.json());
      expect(texto).not.toContain('segredo-super-secreto-da-empresa-a');
      expect(texto.toLowerCase()).not.toContain('webhook_secret');
    }
  });
});
