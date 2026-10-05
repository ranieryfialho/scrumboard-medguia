// Testes de T-054 (fase2c-anexos): repositório de anexos contra um Postgres
// 15 efêmero real com dois tenants seedados.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import {
  anexoValidoParaOportunidade,
  buscarAnexoPorId,
  criarAnexo,
  ErroOportunidadeNaoEncontrada,
} from '../../src/repositories/anexos';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const USUARIO_A = 'aaaaaaaa-0000-0000-0000-0000000000c1';
const OPORTUNIDADE_A2 = 'cccccccc-0000-0000-0000-0000000000a2';

function contextoDe(empresaId: string, usuarioId = USUARIO_A): ContextoTenant {
  return { usuarioId, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

describe('T-054: repositório de anexos', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let tenants: TenantsSeedados;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const extras = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO_A}', 'anexos.a@teste.com', 'Usuária A');
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id")
         VALUES ('${OPORTUNIDADE_A2}', '${tenants.empresaA}', '${tenants.leadA}', 1);`
    );
    if (extras.status !== 0) throw new Error(`Falha ao preparar fixtures de anexos: ${extras.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  const NOVO = (oportunidadeId: string) => ({
    oportunidadeId,
    caminho: 'abc.png',
    mime: 'image/png',
    tamanho: 1234,
    hash: 'a'.repeat(64),
  });

  test('cria o anexo com a empresa e o usuário do contexto @spec:AC-095', async () => {
    const anexo = await criarAnexo(db, contextoDe(tenants.empresaA), {
      ...NOVO(tenants.oportunidadeA),
      // Payload malicioso: campos que o repositório nunca deve ler.
      ...({ empresaId: tenants.empresaB, enviadoPor: 'x' } as object),
    });

    expect(anexo.empresaId).toBe(tenants.empresaA);
    expect(anexo.enviadoPor).toBe(USUARIO_A);
    expect(anexo.oportunidadeId).toBe(tenants.oportunidadeA);
    expect(anexo).toMatchObject({ mime: 'image/png', tamanho: 1234, hash: 'a'.repeat(64) });
  });

  test('não grava anexo em oportunidade de outro tenant @spec:AC-099', async () => {
    // O RLS só confere a empresa do anexo; o repositório confere a do card.
    await expect(
      criarAnexo(db, contextoDe(tenants.empresaB), NOVO(tenants.oportunidadeA))
    ).rejects.toBeInstanceOf(ErroOportunidadeNaoEncontrada);
  });

  test('anexo de outro tenant não é encontrado @spec:AC-102', async () => {
    const anexo = await criarAnexo(db, contextoDe(tenants.empresaA), NOVO(tenants.oportunidadeA));

    expect((await buscarAnexoPorId(db, contextoDe(tenants.empresaA), anexo.id))?.id).toBe(anexo.id);
    expect(await buscarAnexoPorId(db, contextoDe(tenants.empresaB), anexo.id)).toBeNull();
    expect(
      await buscarAnexoPorId(db, contextoDe(tenants.empresaA), 'ffffffff-ffff-ffff-ffff-ffffffffffff')
    ).toBeNull();
  });

  test('só vale como evidência o anexo do próprio card e do próprio tenant @spec:AC-106', async () => {
    const ctxA = contextoDe(tenants.empresaA);
    const anexo = await criarAnexo(db, ctxA, NOVO(tenants.oportunidadeA));

    expect(await anexoValidoParaOportunidade(db, ctxA, anexo.id, tenants.oportunidadeA)).toBe(true);
    // Mesmo tenant, outra oportunidade.
    expect(await anexoValidoParaOportunidade(db, ctxA, anexo.id, OPORTUNIDADE_A2)).toBe(false);
    // Outro tenant.
    expect(
      await anexoValidoParaOportunidade(db, contextoDe(tenants.empresaB), anexo.id, tenants.oportunidadeA)
    ).toBe(false);
    // Inexistente e lixo que nem é uuid.
    expect(
      await anexoValidoParaOportunidade(db, ctxA, 'ffffffff-ffff-ffff-ffff-ffffffffffff', tenants.oportunidadeA)
    ).toBe(false);
    expect(await anexoValidoParaOportunidade(db, ctxA, 'nao-e-uuid', tenants.oportunidadeA)).toBe(false);
  });
});
