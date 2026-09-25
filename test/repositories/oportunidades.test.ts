// Testes de T-042 (fase1-repositorios-isolamento, US-026/US-027/US-028):
// repositório de oportunidades, contra um Postgres 15 efêmero real com dois
// tenants seedados (test/support/seed-tenants.ts).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { ETAPA_SEM_EXIGENCIAS, seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import {
  atualizarOportunidade,
  buscarOportunidadePorId,
  listarOportunidades,
} from '../../src/repositories/oportunidades';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const ETAPA_ALTERNATIVA = 2; // "1º dia de contato" — também sem exigências (drizzle/0005_seeds.sql).
const RESPONSAVEL_1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const RESPONSAVEL_2 = 'bbbbbbbb-0000-0000-0000-000000000002';

// Oportunidades extras da empresa A, além da seedada por seedarDoisTenants,
// só para os testes de filtro/paginação (AC-072/AC-073) desta feature.
const OPORTUNIDADES_EXTRAS_A = [
  { id: 'cccccccc-0000-0000-0000-000000000001', etapaId: ETAPA_ALTERNATIVA, responsavelId: RESPONSAVEL_1 },
  { id: 'cccccccc-0000-0000-0000-000000000002', etapaId: ETAPA_SEM_EXIGENCIAS, responsavelId: RESPONSAVEL_2 },
  { id: 'cccccccc-0000-0000-0000-000000000003', etapaId: ETAPA_ALTERNATIVA, responsavelId: RESPONSAVEL_1 },
];

function contextoDe(empresaId: string): ContextoTenant {
  return {
    usuarioId: 'aaaaaaaa-0000-0000-0000-000000000002',
    empresaId,
    papel: 'GERENTE',
    isSuperAdmin: false,
  };
}

describe('T-042: repositório de oportunidades', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let tenants: TenantsSeedados;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const responsaveis = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESPONSAVEL_1}', 'resp1@teste.com', 'Responsável 1'),
         ('${RESPONSAVEL_2}', 'resp2@teste.com', 'Responsável 2');`
    );
    if (responsaveis.status !== 0) {
      throw new Error(`Falha ao preparar responsáveis: ${responsaveis.stderr}`);
    }

    const valores = OPORTUNIDADES_EXTRAS_A.map(
      (o, indice) =>
        `('${o.id}', '${tenants.empresaA}', '${tenants.leadA}', ${o.etapaId}, '${o.responsavelId}', now() + interval '${indice + 1} seconds')`
    ).join(',\n');
    const extras = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "criado_em") VALUES
         ${valores};`
    );
    if (extras.status !== 0) {
      throw new Error(`Falha ao preparar oportunidades extras: ${extras.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  describe('AC-068: listagem só retorna registros do tenant do contexto', () => {
    test('listarOportunidades da empresa B não traz nenhuma oportunidade da empresa A @spec:AC-068', async () => {
      const contextoB = contextoDe(tenants.empresaB);
      const resultado = await listarOportunidades(db, contextoB);

      expect(resultado.itens.map((o) => o.id)).toEqual([tenants.oportunidadeB]);
    });
  });

  describe('AC-069: busca por id de outro tenant não retorna nada (fail closed)', () => {
    test('empresa B buscando o id da oportunidade da empresa A recebe null @spec:AC-069', async () => {
      const contextoB = contextoDe(tenants.empresaB);
      const resultado = await buscarOportunidadePorId(db, contextoB, tenants.oportunidadeA);

      expect(resultado).toBeNull();
    });
  });

  describe('AC-070: atualização por id de outro tenant não altera nada', () => {
    test('empresa B tentando atualizar a oportunidade da empresa A: zero linhas afetadas @spec:AC-070', async () => {
      const contextoB = contextoDe(tenants.empresaB);
      const resultado = await atualizarOportunidade(db, contextoB, tenants.oportunidadeA, {
        valor: '999.00',
      });

      expect(resultado.linhasAfetadas).toBe(0);

      // A oportunidade em A permanece sem o valor forjado pela tentativa de B.
      const contextoA = contextoDe(tenants.empresaA);
      const oportunidadeA = await buscarOportunidadePorId(db, contextoA, tenants.oportunidadeA);
      expect(oportunidadeA?.valor).toBeNull();
    });

    test('empresa A atualizando a própria oportunidade: uma linha afetada e valor persistido @spec:AC-070', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await atualizarOportunidade(db, contextoA, tenants.oportunidadeA, {
        valor: '1500.00',
      });

      expect(resultado.linhasAfetadas).toBe(1);

      const oportunidadeA = await buscarOportunidadePorId(db, contextoA, tenants.oportunidadeA);
      expect(oportunidadeA?.valor).toBe('1500.00');
    });
  });

  describe('AC-072: filtro por etapa e por responsável restringe o resultado', () => {
    test('filtro por etapaId retorna só oportunidades dessa etapa @spec:AC-072', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await listarOportunidades(db, contextoA, { etapaId: ETAPA_ALTERNATIVA });

      expect(resultado.itens.every((o) => o.etapaId === ETAPA_ALTERNATIVA)).toBe(true);
      expect(resultado.itens.map((o) => o.id).sort()).toEqual(
        [OPORTUNIDADES_EXTRAS_A[0].id, OPORTUNIDADES_EXTRAS_A[2].id].sort()
      );
    });

    test('filtro por etapaId e responsavelId combina com E @spec:AC-072', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const resultado = await listarOportunidades(db, contextoA, {
        etapaId: ETAPA_SEM_EXIGENCIAS,
        responsavelId: RESPONSAVEL_2,
      });

      expect(resultado.itens.map((o) => o.id)).toEqual([OPORTUNIDADES_EXTRAS_A[1].id]);
    });
  });

  describe('AC-073: paginação limita o tamanho da página e permite avançar', () => {
    test('limite restringe o tamanho da página @spec:AC-073', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const pagina = await listarOportunidades(db, contextoA, { limite: 2 });

      expect(pagina.itens).toHaveLength(2);
      expect(pagina.limite).toBe(2);
    });

    test('deslocamento avança para a página seguinte sem repetir nem pular itens @spec:AC-073', async () => {
      const contextoA = contextoDe(tenants.empresaA);
      const limite = 2;

      const todasAsOportunidadesDeA = await listarOportunidades(db, contextoA, { limite: 100 });
      const totalDeA = todasAsOportunidadesDeA.itens.length;

      const paginas: string[][] = [];
      for (let deslocamento = 0; deslocamento < totalDeA; deslocamento += limite) {
        const pagina = await listarOportunidades(db, contextoA, { limite, deslocamento });
        paginas.push(pagina.itens.map((o) => o.id));
      }

      const idsConcatenados = paginas.flat();
      expect(idsConcatenados).toHaveLength(totalDeA);
      expect(new Set(idsConcatenados).size).toBe(totalDeA); // nenhum item repetido entre páginas
      expect(idsConcatenados.sort()).toEqual(todasAsOportunidadesDeA.itens.map((o) => o.id).sort());
    });
  });
});
