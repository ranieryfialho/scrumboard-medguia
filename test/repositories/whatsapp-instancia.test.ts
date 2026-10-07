// Testes de T-077 (fase2c-whatsapp-conversa, AC-144): nome da instância
// Evolution lido de `empresa_configuracoes` via `comTenant`, contra um
// Postgres 15 efêmero real com dois tenants seedados.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { buscarNomeInstancia } from '../../src/repositories/whatsapp-instancia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const USUARIO_A = 'aaaaaaaa-0000-0000-0000-0000000000e1';

function contextoDe(empresaId: string): ContextoTenant {
  return { usuarioId: USUARIO_A, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

describe('T-077: instância WhatsApp da empresa', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let tenants: TenantsSeedados;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO_A}', 'instancia.a@teste.com', 'Usuária A');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor")
         VALUES ('${tenants.empresaA}', 'evolution_instance_name', '"instancia-empresa-a"'::jsonb);`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de whatsapp-instancia: ${resultado.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('devolve o nome da instância cadastrada pela empresa @spec:AC-144', async () => {
    const nome = await buscarNomeInstancia(db, contextoDe(tenants.empresaA));
    expect(nome).toBe('instancia-empresa-a');
  });

  test('devolve null quando a empresa não cadastrou a instância @spec:AC-144', async () => {
    const nome = await buscarNomeInstancia(db, contextoDe(tenants.empresaB));
    expect(nome).toBeNull();
  });
});
