// T-039 (fase1-repositorios-isolamento, US-027): dois tenants seedados
// (empresa A e empresa B), cada um com um lead e uma oportunidade próprios —
// fixture compartilhada pelos testes de isolamento de
// test/repositories/leads.test.ts e test/repositories/oportunidades.test.ts.
// Insere via `crm_migrator` (sem RLS) diretamente pelo harness de
// test/support/postgres-efemero.ts — não passa pelos repositórios sob teste.
import type { PostgresEfemero } from './postgres-efemero';

export const EMPRESA_A = 'eeeeeeee-0000-0000-0000-00000000000a';
export const EMPRESA_B = 'eeeeeeee-0000-0000-0000-00000000000b';

export const LEAD_A = 'eeeeeeee-0000-0000-0000-0000000000a1';
export const LEAD_B = 'eeeeeeee-0000-0000-0000-0000000000b1';

export const OPORTUNIDADE_A = 'eeeeeeee-0000-0000-0000-0000000000a2';
export const OPORTUNIDADE_B = 'eeeeeeee-0000-0000-0000-0000000000b2';

// Etapa 1 ("Entrada de leads", seed de drizzle/0005_seeds.sql) não exige
// valor/motivo/próxima ação — evita CHECKs condicionais nas fixtures.
export const ETAPA_SEM_EXIGENCIAS = 1;

export interface TenantsSeedados {
  empresaA: string;
  empresaB: string;
  leadA: string;
  leadB: string;
  oportunidadeA: string;
  oportunidadeB: string;
  etapaId: number;
}

/**
 * Popula duas empresas com um lead e uma oportunidade cada, para provar
 * isolamento entre tenants pela camada de repositório (AC-068/AC-069/AC-070).
 */
export function seedarDoisTenants(pg: PostgresEfemero): TenantsSeedados {
  const resultado = pg.psqlComo(
    'crm_migrator',
    `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
       ('${EMPRESA_A}', 'Empresa A', 'empresa-a-repositorios'),
       ('${EMPRESA_B}', 'Empresa B', 'empresa-b-repositorios');
     INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
       ('${LEAD_A}', '${EMPRESA_A}', 'Lead da Empresa A'),
       ('${LEAD_B}', '${EMPRESA_B}', 'Lead da Empresa B');
     INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES
       ('${OPORTUNIDADE_A}', '${EMPRESA_A}', '${LEAD_A}', ${ETAPA_SEM_EXIGENCIAS}),
       ('${OPORTUNIDADE_B}', '${EMPRESA_B}', '${LEAD_B}', ${ETAPA_SEM_EXIGENCIAS});`
  );
  if (resultado.status !== 0) {
    throw new Error(`Falha ao seedar os dois tenants de teste: ${resultado.stderr}`);
  }

  return {
    empresaA: EMPRESA_A,
    empresaB: EMPRESA_B,
    leadA: LEAD_A,
    leadB: LEAD_B,
    oportunidadeA: OPORTUNIDADE_A,
    oportunidadeB: OPORTUNIDADE_B,
    etapaId: ETAPA_SEM_EXIGENCIAS,
  };
}
