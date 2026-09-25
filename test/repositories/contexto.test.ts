// Testes de T-040 (fase1-repositorios-isolamento, US-026): `comTenant` contra
// um Postgres 15 efêmero real (harness de T-020), nos mesmos moldes de
// test/auth/tenant.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { comTenant, ErroContextoTenantAusente } from '../../src/repositories/contexto';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const EMPRESA_X = 'ffffffff-0000-0000-0000-000000000001';
const LEAD_X = 'ffffffff-0000-0000-0000-000000000002';

const CONTEXTO_X: ContextoTenant = {
  usuarioId: 'ffffffff-0000-0000-0000-000000000011',
  empresaId: EMPRESA_X,
  papel: 'GERENTE',
  isSuperAdmin: false,
};

describe('T-040: comTenant', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_X}', 'Empresa X', 'empresa-x-comtenant');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_X}', '${EMPRESA_X}', 'Lead da Empresa X');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-065: contexto de tenant define app.empresa_id antes de qualquer query', () => {
    test('set_config aplicado é visível dentro da própria transação @spec:AC-065', async () => {
      const valorVisto = await comTenant(db, CONTEXTO_X, async (tx) => {
        const linhas = await tx.execute(sql`select current_setting('app.empresa_id', true) as valor`);
        return (linhas.rows[0] as { valor: string }).valor;
      });

      expect(valorVisto).toBe(EMPRESA_X);
    });

    test('RLS filtra por esse valor: só enxerga leads da empresa do contexto @spec:AC-065', async () => {
      // `empresas` (tenant raiz) não tem RLS — usa `leads`, que tem
      // (drizzle/0001_rls.sql), para provar que o valor setado é
      // efetivamente o que o RLS filtra.
      const nomes = await comTenant(db, CONTEXTO_X, async (tx) => {
        const linhas = await tx.execute(sql`select nome from leads`);
        return linhas.rows.map((linha) => (linha as { nome: string }).nome);
      });

      expect(nomes).toEqual(['Lead da Empresa X']);
    });
  });

  describe('AC-066: repositório sem contexto de tenant não executa nenhuma query', () => {
    test('contexto ausente (undefined) recusa antes de abrir transação @spec:AC-066', async () => {
      let chamou = false;
      await expect(
        comTenant(db, undefined as unknown as ContextoTenant, async () => {
          chamou = true;
          return null;
        })
      ).rejects.toThrow(ErroContextoTenantAusente);

      expect(chamou).toBe(false);
    });

    test('contexto sem empresaId recusa antes de abrir transação @spec:AC-066', async () => {
      let chamou = false;
      const contextoInvalido = { ...CONTEXTO_X, empresaId: '' };
      await expect(
        comTenant(db, contextoInvalido, async () => {
          chamou = true;
          return null;
        })
      ).rejects.toThrow(ErroContextoTenantAusente);

      expect(chamou).toBe(false);
    });
  });

  describe('AC-067: conexão do repositório usa a role de aplicação, sem bypass de RLS', () => {
    test('current_user da conexão é crm_app @spec:AC-067', async () => {
      const usuarioAtual = await comTenant(db, CONTEXTO_X, async (tx) => {
        const linhas = await tx.execute(sql`select current_user as usuario`);
        return (linhas.rows[0] as { usuario: string }).usuario;
      });

      expect(usuarioAtual).toBe('crm_app');
    });

    test('sem SET LOCAL (fora de comTenant), crm_app não lê nenhuma linha @spec:AC-067', async () => {
      // `empresas` não tem RLS (não é o que se quer provar aqui) — usa
      // `leads`, coberta por RLS, mesma tabela do teste de AC-065 acima.
      //
      // Mesma ambiguidade documentada no AC-020 (fase1-schema-drizzle,
      // test/db/rls.test.ts): sem `app.empresa_id` na sessão,
      // `current_setting('app.empresa_id')::uuid` tanto pode lançar erro
      // (parâmetro nunca reconhecido nesta sessão) quanto — se um teste
      // anterior já "ensinou" o parâmetro nesta sessão via `set_config`,
      // como acontece aqui (AC-065 rodou antes) — resolver para string
      // vazia e falhar no cast para uuid. As duas são fail-closed: nenhuma
      // linha de nenhum tenant é retornada.
      try {
        const linhas = await db.execute(sql`select nome from leads`);
        expect(linhas.rows).toEqual([]);
      } catch (erro) {
        const causa = erro instanceof Error && erro.cause instanceof Error ? erro.cause.message : String(erro);
        expect(causa).toMatch(/app\.empresa_id|uuid/);
      }
    });
  });
});
