// Testes de T-027 (fase1-auth-rbac, US-014): login com e-mail e senha,
// contra um Postgres 15 efêmero real (harness de T-020) — mesmos moldes de
// test/auth/reset-senha.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { count, eq } from 'drizzle-orm';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { sessoes, usuarios } from '../../src/db/schema';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { login, ErroLoginInvalido } from '../../src/lib/auth/login';

const EMPRESA_X = 'a0a0a0a0-0000-0000-0000-000000000001';
const MASTER_X = 'a0a0a0a0-0000-0000-0000-000000000011';

const ATOR_MASTER: AtorConvite = {
  usuarioId: MASTER_X,
  empresaId: EMPRESA_X,
  papel: 'MASTER',
  isSuperAdmin: false,
};

describe('T-027: login com e-mail/senha', () => {
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
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-login');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de login: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  async function contarSessoes(usuarioId: string): Promise<number> {
    const [linha] = await db
      .select({ total: count() })
      .from(sessoes)
      .where(eq(sessoes.usuarioId, usuarioId));
    return linha.total;
  }

  async function criarUsuarioComCredencial(email: string, senha: string) {
    const convite = await convidarUsuario(db, ATOR_MASTER, { email, papel: 'ATENDENTE' });
    await definirSenhaComToken(db, convite.token, senha);
    return convite.usuarioId;
  }

  describe('AC-033: login com credenciais corretas cria sessão', () => {
    test('cria uma sessão em `sessoes` com token, expiração e cookie httpOnly/Secure/SameSite=Lax @spec:AC-033', async () => {
      const usuarioId = await criarUsuarioComCredencial('ac033@teste.com', 'senha-correta-123');

      const resultado = await login(auth, db, 'ac033@teste.com', 'senha-correta-123');

      expect(resultado.usuarioId).toBe(usuarioId);
      expect(resultado.token).toEqual(expect.any(String));
      expect(resultado.expiraEm.getTime()).toBeGreaterThan(Date.now());
      expect(await contarSessoes(usuarioId)).toBe(1);

      const resposta = await auth.api.signInEmail({
        body: { email: 'ac033@teste.com', password: 'senha-correta-123' },
        asResponse: true,
      });
      const setCookie = resposta.headers.get('set-cookie') ?? '';
      expect(setCookie.toLowerCase()).toContain('httponly');
      expect(setCookie.toLowerCase()).toContain('secure');
      expect(setCookie.toLowerCase()).toContain('samesite=lax');
    });
  });

  describe('AC-034: login com credenciais incorretas é recusado', () => {
    test('senha errada não cria sessão @spec:AC-034', async () => {
      const usuarioId = await criarUsuarioComCredencial('ac034@teste.com', 'senha-correta-456');

      await expect(login(auth, db, 'ac034@teste.com', 'senha-errada')).rejects.toBeInstanceOf(
        ErroLoginInvalido
      );

      expect(await contarSessoes(usuarioId)).toBe(0);
    });
  });

  describe('AC-035: login de usuário inativo é bloqueado', () => {
    test('usuário com ativo=false é recusado mesmo com senha correta @spec:AC-035', async () => {
      const usuarioId = await criarUsuarioComCredencial('ac035@teste.com', 'senha-correta-789');
      await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, usuarioId));

      await expect(login(auth, db, 'ac035@teste.com', 'senha-correta-789')).rejects.toBeInstanceOf(
        ErroLoginInvalido
      );

      expect(await contarSessoes(usuarioId)).toBe(0);
    });
  });
});
