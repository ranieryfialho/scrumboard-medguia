// Testes de T-050 (fase2-kanban, US-032): rota `GET /api/motivos-perda` —
// lista os motivos ativos com o id real, pro select do modal de dado
// faltante (`MOTIVO_PERDA_OBRIGATORIO`). Mesmos moldes de
// test/api/oportunidades.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants } from '../support/seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-050: rota GET /api/motivos-perda', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let routeModule: typeof import('../../src/app/api/motivos-perda/route');
  let cookie: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const tenants = seedarDoisTenants(pg);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMaster: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000c1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const convite = await convidarUsuario(db, atorMaster, { email: 'gerente.motivos@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, convite.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/motivos-perda/route');

    cookie = await loginComoCookie(auth, 'gerente.motivos@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('sem sessão: 401', async () => {
    const request = new NextRequest('http://localhost/api/motivos-perda');
    const resposta = await routeModule.GET(request);

    expect(resposta.status).toBe(401);
  });

  test('com sessão: lista só os 7 motivos ativos (o 8º, "Legado — arquivado", está inativo), com id real', async () => {
    const request = new NextRequest('http://localhost/api/motivos-perda', { headers: { Cookie: cookie } });
    const resposta = await routeModule.GET(request);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.itens).toHaveLength(7);
    expect(corpo.itens.map((m: { nome: string }) => m.nome)).not.toContain('Legado — arquivado');
    for (const motivo of corpo.itens) {
      expect(motivo.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
