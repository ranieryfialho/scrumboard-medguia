// Testes de T-031 (fase1-auth-rbac, US-018): resolução de sessão e tenant no
// servidor, contra um Postgres 15 efêmero real (harness de T-020) com as
// migrations do schema aplicadas — os mesmos moldes de test/auth/convites.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { sessoes } from '../../src/db/schema';
import { ErroSessaoInvalida, resolverContextoTenant } from '../../src/lib/auth/tenant';

const EMPRESA_X = 'dddddddd-0000-0000-0000-000000000001';
const EMPRESA_Y = 'dddddddd-0000-0000-0000-000000000002';

const GERENTE_X = 'dddddddd-0000-0000-0000-000000000011';
const USUARIO_INATIVO = 'dddddddd-0000-0000-0000-000000000012';

const TOKEN_VALIDO = 'token-sessao-valido';
const TOKEN_EXPIRADO = 'token-sessao-expirado';
const TOKEN_USUARIO_INATIVO = 'token-sessao-usuario-inativo';

describe('T-031: resolução de sessão e tenant no servidor', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const agora = new Date();
    const expiraNoFuturo = new Date(agora.getTime() + 60 * 60 * 1000).toISOString();
    const expirouNoPassado = new Date(agora.getTime() - 60 * 60 * 1000).toISOString();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-tenant'),
         ('${EMPRESA_Y}', 'Empresa Y', 'empresa-y-tenant');
       INSERT INTO "usuarios" ("id", "email", "nome", "is_super_admin", "ativo") VALUES
         ('${GERENTE_X}', 'gerente.x@teste.com', 'Gerente X', false, true),
         ('${USUARIO_INATIVO}', 'inativo@teste.com', 'Usuário Inativo', false, false);
       INSERT INTO "empresas_usuarios" ("empresa_id", "usuario_id", "papel") VALUES
         ('${EMPRESA_X}', '${GERENTE_X}', 'GERENTE'),
         ('${EMPRESA_X}', '${USUARIO_INATIVO}', 'ATENDENTE');
       INSERT INTO "sessoes" ("usuario_id", "token", "expira_em") VALUES
         ('${GERENTE_X}', '${TOKEN_VALIDO}', '${expiraNoFuturo}'),
         ('${GERENTE_X}', '${TOKEN_EXPIRADO}', '${expirouNoPassado}'),
         ('${USUARIO_INATIVO}', '${TOKEN_USUARIO_INATIVO}', '${expiraNoFuturo}');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de tenant: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-043: empresa_id da sessão prevalece sobre o do corpo da requisição', () => {
    test('GERENTE autenticado na empresa X: empresa_id resolvido é X mesmo com outro valor no corpo @spec:AC-043', async () => {
      const contexto = await resolverContextoTenant(db, {
        token: TOKEN_VALIDO,
        empresaIdCorpo: EMPRESA_Y,
      });

      expect(contexto.empresaId).toBe(EMPRESA_X);
      expect(contexto.empresaId).not.toBe(EMPRESA_Y);
      expect(contexto.papel).toBe('GERENTE');
      expect(contexto.usuarioId).toBe(GERENTE_X);
    });

    test('resolução é idêntica sem nenhum empresa_id informado no corpo @spec:AC-043', async () => {
      const contexto = await resolverContextoTenant(db, { token: TOKEN_VALIDO });

      expect(contexto.empresaId).toBe(EMPRESA_X);
    });
  });

  describe('AC-044: requisição sem sessão válida é bloqueada', () => {
    test('sem token (ausente): recusado @spec:AC-044', async () => {
      await expect(resolverContextoTenant(db, { token: undefined })).rejects.toThrow(
        ErroSessaoInvalida
      );
      await expect(resolverContextoTenant(db, { token: null })).rejects.toThrow(
        ErroSessaoInvalida
      );
    });

    test('token de sessão expirado: recusado @spec:AC-044', async () => {
      await expect(resolverContextoTenant(db, { token: TOKEN_EXPIRADO })).rejects.toThrow(
        ErroSessaoInvalida
      );
    });

    test('token de sessão revogado (linha apagada): recusado @spec:AC-044', async () => {
      const tokenRevogado = 'token-sessao-revogado';
      await db.insert(sessoes).values({
        usuarioId: GERENTE_X,
        token: tokenRevogado,
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      });

      // Revogação (T-030 revoga apagando a linha de `sessoes`).
      await db.delete(sessoes).where(eq(sessoes.token, tokenRevogado));

      await expect(resolverContextoTenant(db, { token: tokenRevogado })).rejects.toThrow(
        ErroSessaoInvalida
      );
    });

    test('token inexistente: recusado @spec:AC-044', async () => {
      await expect(
        resolverContextoTenant(db, { token: 'token-que-nunca-existiu' })
      ).rejects.toThrow(ErroSessaoInvalida);
    });

    test('sessão válida mas usuário inativo: recusado e nenhum dado é retornado @spec:AC-044', async () => {
      await expect(resolverContextoTenant(db, { token: TOKEN_USUARIO_INATIVO })).rejects.toThrow(
        ErroSessaoInvalida
      );
    });
  });
});
