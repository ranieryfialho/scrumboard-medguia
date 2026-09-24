// Testes de T-026 (fase1-auth-rbac, US-014): sanity check de que o Better
// Auth está de fato instalado e configurado contra o schema Drizzle desta
// feature (adaptador, mapeamento de campos, hash de senha) — sem isso, T-027
// (login) e as demais tarefas não têm base para funcionar. Não tem um AC
// próprio (T-026 só referencia US-014); a prova de comportamento observável
// fica em test/auth/login.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import { criarAuth, type Auth } from '../../src/lib/auth/server';

const EMPRESA_X = 'fffffff0-0000-0000-0000-000000000001';
const MASTER_X = 'fffffff0-0000-0000-0000-000000000011';

const ATOR_MASTER: AtorConvite = {
  usuarioId: MASTER_X,
  empresaId: EMPRESA_X,
  papel: 'MASTER',
  isSuperAdmin: false,
};

describe('T-026: instala e configura o Better Auth sobre o schema existente', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-auth-config');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de config: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('adaptador Drizzle está mapeado para as tabelas em português (get-session sem sessão não quebra)', async () => {
    const resultado = await auth.api.getSession({ headers: new Headers() });
    expect(resultado).toBeNull();
  });

  test('signInEmail reconhece uma credencial criada por convidarUsuario + definirSenhaComToken (T-028/T-029)', async () => {
    const email = 'config.smoke@teste.com';
    const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });
    await definirSenhaComToken(db, convite.token, 'senha-valida-123');

    const resultado = await auth.api.signInEmail({
      body: { email, password: 'senha-valida-123' },
      asResponse: false,
    });

    expect(resultado.token).toEqual(expect.any(String));
    expect(resultado.user.email).toBe(email);
  });
});
