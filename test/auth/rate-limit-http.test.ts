// Teste do limite de requisições do Better Auth POR HTTP (`auth.handler`), contra um
// Postgres 15 efêmero real. Os testes de `rate-limit.test.ts` cobrem só o limitador do
// domínio (T-033); este cobre o que o navegador de fato encontra em `/api/auth/*`:
// o limite de 5 a cada 15 minutos (AC-047) vale para o login, mas NÃO pode valer para
// "Sair" — sem isso, quem clicava em "Sair" umas 5 vezes ficava bloqueado por 15 minutos.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('rate limit do Better Auth por HTTP', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;

  function post(caminho: string, ip: string, corpo: unknown) {
    return auth.handler(
      new Request(`http://localhost:3000/api/auth${caminho}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
        body: JSON.stringify(corpo),
      })
    );
  }

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = 'segredo-de-teste-do-limite-de-requisicoes-0123456789';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('"Sair" nunca é limitado: 12 pedidos seguidos do mesmo IP não geram 429 @spec:AC-357', async () => {
    const status: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      status.push((await post('/sign-out', '203.0.113.50', {})).status);
    }

    expect(status.filter((codigo) => codigo === 429)).toHaveLength(0);
  });

  test('o login continua limitado: depois de várias tentativas do mesmo IP vem 429 @spec:AC-047', async () => {
    const status: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      status.push((await post('/sign-in/email', '203.0.113.60', { email: 'ninguem@teste.com', password: 'senha-errada-123' })).status);
    }

    expect(status).toContain(429);
    expect(status[0]).not.toBe(429);
  });
});
