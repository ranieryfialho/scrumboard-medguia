// Testes de T-086 (fase2c-whatsapp-conexao, US-050): rota GET
// /api/whatsapp/status contra um Postgres 15 efêmero real e uma Evolution
// falsa local (test/support/evolution-falsa.ts). Mesmo molde de
// test/api/whatsapp-send.test.ts e test/api/whatsapp-config.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { subirEvolutionFalsa, type EvolutionFalsa } from '../support/evolution-falsa';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'f2000000-0000-0000-0000-00000000000a';
const EMPRESA_B = 'f2000000-0000-0000-0000-00000000000b';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-086: GET /api/whatsapp/status', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let evolution: EvolutionFalsa;
  let rota: typeof import('../../src/app/api/whatsapp/status/route');
  let cookieMasterA: string;
  let cookieAtendenteA: string;
  let cookieGerenteB: string;

  function getStatus(cookie: string | null) {
    const request = new NextRequest('http://localhost/api/whatsapp/status', {
      method: 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rota.GET(request);
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    evolution = await subirEvolutionFalsa();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Status', 'empresa-a-whatsapp-status'),
         ('${EMPRESA_B}', 'Empresa B Status', 'empresa-b-whatsapp-status');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_A}', 'evolution_instance_name', '"instancia-a-status"'::jsonb),
         ('${EMPRESA_A}', 'evolution_webhook_secret', '"segredo-super-secreto-da-empresa-a"'::jsonb);`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-status: ${setup.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000002f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000002f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a.status@teste.com', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, {
      email: 'atendente.a.status@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, {
      email: 'gerente.b.status@teste.com',
      papel: 'GERENTE',
    });
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    process.env.EVOLUTION_API_URL = evolution.url;
    process.env.EVOLUTION_API_KEY = evolution.apiKey;
    rota = await import('../../src/app/api/whatsapp/status/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a.status@teste.com', SENHA);
    cookieAtendenteA = await loginComoCookie(auth, 'atendente.a.status@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie(auth, 'gerente.b.status@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    await evolution?.fechar();
    pg?.parar();
  });

  beforeEach(() => {
    evolution.definirComportamentoEstado({ tipo: 'estado', state: 'close' });
    process.env.EVOLUTION_API_URL = evolution.url;
  });

  test('sem sessão: 401, a Evolution não é chamada @spec:AC-167', async () => {
    const antesChamadas = evolution.chamadasEstado.length;

    const resposta = await getStatus(null);

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    expect(evolution.chamadasEstado.length).toBe(antesChamadas);
  });

  test('sem instância cadastrada: not_configured, a Evolution não é chamada @spec:AC-175', async () => {
    const antesChamadas = evolution.chamadasEstado.length;

    const resposta = await getStatus(cookieGerenteB);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({ state: 'not_configured', instance: null });
    expect(evolution.chamadasEstado.length).toBe(antesChamadas);
  });

  test('com instância cadastrada, o estado vem da Evolution (inclusive para o atendente) @spec:AC-176', async () => {
    evolution.definirComportamentoEstado({ tipo: 'estado', state: 'open' });

    for (const cookie of [cookieMasterA, cookieAtendenteA]) {
      const resposta = await getStatus(cookie);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo).toEqual({ state: 'open', instance: 'instancia-a-status' });
    }

    const ultimaChamada = evolution.chamadasEstado[evolution.chamadasEstado.length - 1];
    expect(ultimaChamada.instance).toBe('instancia-a-status');
  });

  test('Evolution fora do ar: state "close", nada quebra @spec:AC-177', async () => {
    const urlOriginal = process.env.EVOLUTION_API_URL;
    process.env.EVOLUTION_API_URL = 'http://127.0.0.1:1';

    const resposta = await getStatus(cookieMasterA);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo).toEqual({ state: 'close', instance: 'instancia-a-status' });

    process.env.EVOLUTION_API_URL = urlOriginal;
  });

  test('o segredo do webhook nunca sai na resposta @spec:AC-183', async () => {
    const resposta = await getStatus(cookieMasterA);
    const texto = JSON.stringify(await resposta.json());

    expect(texto).not.toContain('segredo-super-secreto-da-empresa-a');
    expect(texto.toLowerCase()).not.toContain('webhook_secret');
    expect(texto.toLowerCase()).not.toContain(evolution.apiKey.toLowerCase());
  });
});
