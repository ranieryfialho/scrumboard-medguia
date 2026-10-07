// Testes de T-081 (fase2c-whatsapp-conexao, US-049): prova, contra um
// Postgres 15 efêmero real (harness de T-020), que o índice único parcial da
// migration 0010 impede duas empresas de gravarem o mesmo
// `evolution_instance_name` em `empresa_configuracoes`, mas não impede a
// própria empresa de regravar o nome que já usa (AC-173).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A_ID = 'cccccccc-0000-0000-0000-000000000001';
const EMPRESA_B_ID = 'cccccccc-0000-0000-0000-000000000002';

describe('T-081: índice único de evolution_instance_name entre empresas', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A_ID}', 'Empresa A Conexao', 'empresa-a-conexao'),
         ('${EMPRESA_B_ID}', 'Empresa B Conexao', 'empresa-b-conexao');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de conexão WhatsApp: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  test('empresa B grava o nome "clinica-b" com sucesso @spec:AC-173', () => {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor")
       VALUES ('${EMPRESA_B_ID}', 'evolution_instance_name', '"clinica-b"')`
    );
    expect(resultado.status, `insert do nome de instância da empresa B deveria ter sucesso: ${resultado.stderr}`).toBe(0);
  });

  test('empresa A não consegue gravar o mesmo nome "clinica-b" já usado pela empresa B @spec:AC-173', () => {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor")
       VALUES ('${EMPRESA_A_ID}', 'evolution_instance_name', '"clinica-b"')`
    );
    expect(resultado.status, 'insert do mesmo nome de instância pela empresa A deveria falhar').not.toBe(0);
    expect(resultado.stderr).toMatch(/empresa_configuracoes_instancia_whatsapp_unica/);
    expect(resultado.stderr).toMatch(/duplicate key|unique constraint/i);

    const conferencia = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_A_ID}' AND "chave" = 'evolution_instance_name'`
    );
    expect(conferencia.stdout.trim(), 'nada deveria ter sido gravado na empresa A').toBe('0');
  });

  test('empresa A continua podendo gravar e regravar o nome que ela própria usa @spec:AC-173', () => {
    const primeiraGravacao = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor")
       VALUES ('${EMPRESA_A_ID}', 'evolution_instance_name', '"clinica-a"')`
    );
    expect(primeiraGravacao.status, `insert do nome de instância da empresa A deveria ter sucesso: ${primeiraGravacao.stderr}`).toBe(0);

    const regravacao = pg.psqlComo(
      'crm_migrator',
      `UPDATE "empresa_configuracoes" SET "valor" = '"clinica-a"'
       WHERE "empresa_id" = '${EMPRESA_A_ID}' AND "chave" = 'evolution_instance_name'`
    );
    expect(regravacao.status, `a própria empresa A regravar o nome que já usa deveria ter sucesso: ${regravacao.stderr}`).toBe(0);
  });
});
