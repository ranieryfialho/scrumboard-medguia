// Testes de T-084 (fase2c-whatsapp-conexao, US-048/US-049): repositório da
// configuração do WhatsApp e do segredo do webhook, contra um Postgres 15
// efêmero real com empresas seedadas diretamente (sem leads/oportunidades,
// que esta feature não usa).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import {
  ErroInstanciaEmUso,
  lerConfiguracao,
  obterOuCriarSegredoWebhook,
  salvarConfiguracao,
} from '../../src/repositories/whatsapp-config';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const EMPRESA_A = 'fffffff0-0000-0000-0000-00000000000a';
const EMPRESA_B = 'fffffff0-0000-0000-0000-00000000000b';
const EMPRESA_C = 'fffffff0-0000-0000-0000-00000000000c';
const EMPRESA_D = 'fffffff0-0000-0000-0000-00000000000d';
const EMPRESA_E = 'fffffff0-0000-0000-0000-00000000000e';

function contextoDe(empresaId: string, papel: ContextoTenant['papel'] = 'GERENTE'): ContextoTenant {
  return { usuarioId: 'fffffff1-0000-0000-0000-000000000001', empresaId, papel, isSuperAdmin: false };
}

describe('T-084: repositório da configuração de WhatsApp e do segredo do webhook', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Config', 'empresa-a-whatsapp-config'),
         ('${EMPRESA_B}', 'Empresa B Config', 'empresa-b-whatsapp-config'),
         ('${EMPRESA_C}', 'Empresa C Config', 'empresa-c-whatsapp-config'),
         ('${EMPRESA_D}', 'Empresa D Config', 'empresa-d-whatsapp-config'),
         ('${EMPRESA_E}', 'Empresa E Config', 'empresa-e-whatsapp-config');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA_A}', 'evolution_instance_name', '"instancia-a"'::jsonb),
         ('${EMPRESA_A}', 'evolution_auto_msg_em_contato', '"Olá, em contato!"'::jsonb),
         ('${EMPRESA_A}', 'evolution_auto_msg_recontato', '"Recontato"'::jsonb),
         ('${EMPRESA_A}', 'evolution_webhook_secret', '"segredo-ja-cadastrado-da-empresa-a"'::jsonb),
         ('${EMPRESA_B}', 'evolution_instance_name', '"instancia-b"'::jsonb),
         ('${EMPRESA_D}', 'evolution_instance_name', '"clinica-d"'::jsonb);`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de whatsapp-config: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('lerConfiguracao devolve só as chaves permitidas, nunca o segredo do webhook @spec:AC-168', async () => {
    const config = await lerConfiguracao(db, contextoDe(EMPRESA_A));

    expect(config.evolution_instance_name).toBe('instancia-a');
    expect(config.evolution_auto_msg_em_contato).toBe('Olá, em contato!');
    expect(config.evolution_auto_msg_recontato).toBe('Recontato');
    expect(config).not.toHaveProperty('evolution_webhook_secret');
    expect(Object.keys(config).sort()).toEqual(
      ['evolution_auto_msg_em_contato', 'evolution_auto_msg_recontato', 'evolution_instance_name'].sort()
    );
  });

  test('a configuração de outra empresa não aparece @spec:AC-169', async () => {
    const configA = await lerConfiguracao(db, contextoDe(EMPRESA_A));
    const configB = await lerConfiguracao(db, contextoDe(EMPRESA_B));

    expect(configA.evolution_instance_name).toBe('instancia-a');
    expect(configB.evolution_instance_name).toBe('instancia-b');
    expect(JSON.stringify(configA)).not.toContain('instancia-b');
    expect(JSON.stringify(configB)).not.toContain('instancia-a');
  });

  test('MASTER e GERENTE salvam a configuração, e salvar de novo a mesma chave atualiza em vez de duplicar @spec:AC-170', async () => {
    await salvarConfiguracao(db, contextoDe(EMPRESA_C, 'MASTER'), {
      evolution_instance_name: 'instancia-c',
      evolution_auto_msg_recontato: 'Primeira versão',
    });

    let config = await lerConfiguracao(db, contextoDe(EMPRESA_C));
    expect(config.evolution_instance_name).toBe('instancia-c');
    expect(config.evolution_auto_msg_recontato).toBe('Primeira versão');

    await salvarConfiguracao(db, contextoDe(EMPRESA_C, 'GERENTE'), {
      evolution_auto_msg_recontato: 'Segunda versão',
    });

    config = await lerConfiguracao(db, contextoDe(EMPRESA_C));
    expect(config.evolution_auto_msg_recontato).toBe('Segunda versão');

    const linhas = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_C}' AND "chave" = 'evolution_auto_msg_recontato'`
    );
    expect(linhas.stdout.trim()).toBe('1');
  });

  test('só as chaves permitidas são gravadas; o segredo existente não muda e chaves desconhecidas são ignoradas @spec:AC-172', async () => {
    const segredoAntes = pg.psqlComo(
      'crm_migrator',
      `SELECT "valor" FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_A}' AND "chave" = 'evolution_webhook_secret'`
    );
    expect(segredoAntes.stdout).toContain('segredo-ja-cadastrado-da-empresa-a');

    // Simula um chamador descuidado que ignora o tipo em tempo de execução e
    // repassa chaves que nunca deveriam chegar ao repositório (o segredo do
    // webhook e uma chave qualquer) — a validação de entrada de T-083 já
    // bloquearia isso na rota, mas o repositório não confia só nela.
    const valoresComChavesIndevidas = {
      evolution_auto_msg_em_contato: 'Atualizado pelo GERENTE',
      evolution_webhook_secret: 'segredo-tentando-trocar',
      chave_qualquer: 'ignorar isso',
    } as unknown as Parameters<typeof salvarConfiguracao>[2];

    await salvarConfiguracao(db, contextoDe(EMPRESA_A), valoresComChavesIndevidas);

    const config = await lerConfiguracao(db, contextoDe(EMPRESA_A));
    expect(config.evolution_auto_msg_em_contato).toBe('Atualizado pelo GERENTE');

    const segredoDepois = pg.psqlComo(
      'crm_migrator',
      `SELECT "valor" FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_A}' AND "chave" = 'evolution_webhook_secret'`
    );
    expect(segredoDepois.stdout).toContain('segredo-ja-cadastrado-da-empresa-a');
    expect(segredoDepois.stdout).not.toContain('segredo-tentando-trocar');

    const chaveQualquer = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_A}' AND "chave" = 'chave_qualquer'`
    );
    expect(chaveQualquer.stdout.trim()).toBe('0');
  });

  test('nome de instância já usado por outra empresa é recusado, sem gravar nada (nem as outras chaves do pedido) @spec:AC-173', async () => {
    await expect(
      salvarConfiguracao(db, contextoDe(EMPRESA_E), {
        evolution_instance_name: 'clinica-d',
        evolution_auto_msg_em_contato: 'Não deveria gravar',
      })
    ).rejects.toBeInstanceOf(ErroInstanciaEmUso);

    const configE = await lerConfiguracao(db, contextoDe(EMPRESA_E));
    expect(configE.evolution_instance_name).toBeUndefined();
    expect(configE.evolution_auto_msg_em_contato).toBeUndefined();
  });

  test('salvar o nome de instância que a própria empresa já usa continua funcionando @spec:AC-173', async () => {
    await salvarConfiguracao(db, contextoDe(EMPRESA_D), { evolution_instance_name: 'clinica-d' });

    const config = await lerConfiguracao(db, contextoDe(EMPRESA_D));
    expect(config.evolution_instance_name).toBe('clinica-d');
  });

  test('empresa sem segredo recebe um gerado pelo servidor, com pelo menos 32 bytes, e reutiliza em pedidos seguintes @spec:AC-182', async () => {
    const primeiro = await obterOuCriarSegredoWebhook(db, contextoDe(EMPRESA_B));
    expect(Buffer.from(primeiro, 'hex').length).toBeGreaterThanOrEqual(32);

    const segundo = await obterOuCriarSegredoWebhook(db, contextoDe(EMPRESA_B));
    expect(segundo).toBe(primeiro);

    const linhas = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_B}' AND "chave" = 'evolution_webhook_secret'`
    );
    expect(linhas.stdout.trim()).toBe('1');
  });

  test('empresa que já tinha segredo cadastrado continua recebendo o mesmo valor @spec:AC-182', async () => {
    const segredo = await obterOuCriarSegredoWebhook(db, contextoDe(EMPRESA_A));
    expect(segredo).toBe('segredo-ja-cadastrado-da-empresa-a');
  });

  test('duas chamadas simultâneas não geram segredos diferentes nem gravam duas linhas @spec:AC-182', async () => {
    const [resultado1, resultado2] = await Promise.all([
      obterOuCriarSegredoWebhook(db, contextoDe(EMPRESA_C)),
      obterOuCriarSegredoWebhook(db, contextoDe(EMPRESA_C)),
    ]);

    expect(resultado1).toBe(resultado2);

    const linhas = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "empresa_configuracoes" WHERE "empresa_id" = '${EMPRESA_C}' AND "chave" = 'evolution_webhook_secret'`
    );
    expect(linhas.stdout.trim()).toBe('1');
  });
});
