// Testes de T-041 (fase1-repositorios-isolamento, US-026/US-027): repositório
// de leads, contra um Postgres 15 efêmero real com dois tenants seedados
// (test/support/seed-tenants.ts).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { buscarLeadPorId, criarLead, listarLeads } from '../../src/repositories/leads';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

function contextoDe(empresaId: string): ContextoTenant {
  return {
    usuarioId: 'aaaaaaaa-0000-0000-0000-000000000001',
    empresaId,
    papel: 'GERENTE',
    isSuperAdmin: false,
  };
}

describe('T-041: repositório de leads', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let tenants: TenantsSeedados;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-068: listagem só retorna registros do tenant do contexto', () => {
    test('listarLeads da empresa A não traz o lead da empresa B @spec:AC-068', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await listarLeads(db, contextoA);

      expect(resultado.map((lead) => lead.id)).toEqual([tenants.leadA]);
    });

    test('listarLeads da empresa B não traz o lead da empresa A @spec:AC-068', async () => {
      const contextoB = contextoDe(tenants.empresaB);
      const resultado = await listarLeads(db, contextoB);

      expect(resultado.map((lead) => lead.id)).toEqual([tenants.leadB]);
    });
  });

  describe('AC-069: busca por id de outro tenant não retorna nada (fail closed)', () => {
    test('empresa A buscando o id do lead da empresa B recebe null @spec:AC-069', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await buscarLeadPorId(db, contextoA, tenants.leadB);

      expect(resultado).toBeNull();
    });

    test('empresa A buscando o próprio lead recebe o registro @spec:AC-069', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await buscarLeadPorId(db, contextoA, tenants.leadA);

      expect(resultado?.id).toBe(tenants.leadA);
    });
  });

  describe('AC-071: criação ignora empresaId vindo do chamador e usa o do contexto', () => {
    test('empresaId malicioso no payload é ignorado @spec:AC-071', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const lead = await criarLead(db, contextoA, {
        nome: 'Lead criado pelo teste',
        empresaId: tenants.empresaB,
      });

      expect(lead.empresaId).toBe(tenants.empresaA);
      expect(lead.empresaId).not.toBe(tenants.empresaB);

      // Confirma pelo caminho de leitura, não só pelo retorno da escrita.
      const encontrado = await buscarLeadPorId(db, contextoA, lead.id);
      expect(encontrado?.empresaId).toBe(tenants.empresaA);
    });

    test('lead criado sem empresaId no payload usa o do contexto @spec:AC-071', async () => {
      const contextoB = contextoDe(tenants.empresaB);
      const lead = await criarLead(db, contextoB, { nome: 'Outro lead' });

      expect(lead.empresaId).toBe(tenants.empresaB);
    });
  });
});
