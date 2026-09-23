// Testes de T-021 (fase1-schema-drizzle, US-007/US-008): prova, contra um
// Postgres 15 efêmero real (harness de T-020), que as migrations aplicam o
// schema completo, incluem as tabelas do Better Auth, são reaplicáveis sem
// falhar nem duplicar, e que toda coluna de tenant listada no AC-018 é
// NOT NULL de fato no banco (não só no Drizzle).
import fs from 'node:fs';
import path from 'node:path';

import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const TABELAS_ESPERADAS = [
  'empresas',
  'empresa_configuracoes',
  'usuarios',
  'empresas_usuarios',
  'pipeline_etapas',
  'pipeline_transicoes',
  'motivos_perda',
  'leads',
  'oportunidades',
  'cadencia_atividades',
  'oportunidade_eventos',
  'tarefas_agendadas',
  'anexos',
  'reunioes',
  'whatsapp_mensagens',
  'campanhas',
  'envios_campanha',
  'cron_execucoes',
  'importacoes',
  'migracao_registros',
];

const TABELAS_BETTER_AUTH = ['contas', 'sessoes', 'tokens_verificacao'];

// Fixtures válidas (crm_migrator é dono das tabelas, então RLS não se aplica
// a ele — o objetivo aqui é isolar a violação de NOT NULL de empresa_id, não
// misturar com o comportamento de RLS, que é escopo do T-022).
const EMPRESA_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
const LEAD_ID = 'aaaaaaaa-0000-0000-0000-000000000003';
const OPORTUNIDADE_ID = 'aaaaaaaa-0000-0000-0000-000000000004';
const CAMPANHA_ID = 'aaaaaaaa-0000-0000-0000-000000000005';

const INSERCOES_SEM_TENANT: Array<{ tabela: string; sql: string }> = [
  {
    tabela: 'leads',
    sql: `INSERT INTO "leads" ("nome") VALUES ('Lead sem empresa')`,
  },
  {
    tabela: 'oportunidades',
    sql: `INSERT INTO "oportunidades" ("lead_id", "etapa_id") VALUES ('${LEAD_ID}', 1)`,
  },
  {
    tabela: 'cadencia_atividades',
    sql: `INSERT INTO "cadencia_atividades" ("oportunidade_id", "sequencia", "dia", "turno", "canal", "tipo")
          VALUES ('${OPORTUNIDADE_ID}', 1, 1, 'manha', 'telefone', 'ligacao')`,
  },
  {
    tabela: 'oportunidade_eventos',
    sql: `INSERT INTO "oportunidade_eventos" ("oportunidade_id", "tipo", "ator_tipo")
          VALUES ('${OPORTUNIDADE_ID}', 'teste', 'sistema')`,
  },
  {
    tabela: 'tarefas_agendadas',
    sql: `INSERT INTO "tarefas_agendadas" ("oportunidade_id", "tipo", "agendada_para")
          VALUES ('${OPORTUNIDADE_ID}', 'ligar', now())`,
  },
  {
    tabela: 'anexos',
    sql: `INSERT INTO "anexos" ("oportunidade_id", "caminho", "mime", "tamanho", "hash")
          VALUES ('${OPORTUNIDADE_ID}', '/tmp/arquivo.pdf', 'application/pdf', 10, 'hash123')`,
  },
  {
    tabela: 'reunioes',
    sql: `INSERT INTO "reunioes" ("oportunidade_id", "agendada_para") VALUES ('${OPORTUNIDADE_ID}', now())`,
  },
  {
    tabela: 'whatsapp_mensagens',
    sql: `INSERT INTO "whatsapp_mensagens" ("numero", "mensagem", "direcao")
          VALUES ('5511999999999', 'oi', 'enviada')`,
  },
  {
    tabela: 'campanhas',
    sql: `INSERT INTO "campanhas" ("nome", "assunto", "corpo_html")
          VALUES ('Campanha sem empresa', 'Assunto', '<p>corpo</p>')`,
  },
  {
    tabela: 'envios_campanha',
    sql: `INSERT INTO "envios_campanha" ("campanha_id", "nome_destinatario", "email_destinatario")
          VALUES ('${CAMPANHA_ID}', 'Fulano', 'fulano@teste.com')`,
  },
  {
    tabela: 'empresa_configuracoes',
    sql: `INSERT INTO "empresa_configuracoes" ("chave", "valor") VALUES ('chave_teste', '{}'::jsonb)`,
  },
];

describe('T-021: schema completo aplicado num Postgres limpo', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  test('AC-015: migrations aplicam o schema completo (todas as tabelas de negócio existem, exit 0) @spec:AC-015', () => {
    const resultado = pg.psqlComo(
      'crm_migrator',
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    expect(resultado.status).toBe(0);

    const tabelasExistentes = new Set(resultado.stdout.trim().split('\n').filter(Boolean));
    for (const tabela of TABELAS_ESPERADAS) {
      expect(tabelasExistentes.has(tabela), `tabela "${tabela}" deveria existir após as migrations`).toBe(true);
    }
  });

  test('AC-016: as tabelas do adaptador Drizzle do Better Auth existem @spec:AC-016', () => {
    const resultado = pg.psqlComo(
      'crm_migrator',
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('contas','sessoes','tokens_verificacao') ORDER BY table_name"
    );
    expect(resultado.status).toBe(0);
    expect(resultado.stdout.trim().split('\n').filter(Boolean)).toEqual(TABELAS_BETTER_AUTH);
  });

  describe('AC-017: migrations reaplicadas no mesmo banco não falham nem duplicam nada', () => {
    // `0000_schema_inicial.sql` é a única migration gerada por `drizzle-kit
    // generate` e rastreada pelo journal (drizzle/meta/_journal.json) — é ela
    // que o "comando de migração" do projeto (`npm run db:migrate`, i.e.
    // `drizzle-kit migrate`) de fato controla e sabe pular quando já
    // aplicada. Provamos a idempotência desse comando contra um database
    // novo (dentro do mesmo cluster efêmero) aplicado só por ele, sem passar
    // pelo `aplicarMigrations()` do harness — que roda as demais migrations
    // hand-written (0001-0005) por fora do journal.
    //
    // Chamamos o migrator programático do drizzle-orm (o mesmo motor que
    // `drizzle-kit migrate` usa por baixo, lendo o mesmo journal) em vez de
    // invocar o binário via subprocesso: a CLI desenha um spinner que exige
    // TTY e engole a mensagem de erro real quando roda com stdio em pipe
    // (como faz `spawnSync`), tornando qualquer falha ilegível no teste.
    const freshDatabase = 'crm_ac017_migrate_test';
    let freshDatabaseUrl: string;

    beforeAll(() => {
      const criarDb = pg.psqlComo('postgres', `CREATE DATABASE "${freshDatabase}"`, 'postgres');
      if (criarDb.status !== 0) {
        throw new Error(`Falha ao criar database para o teste do AC-017: ${criarDb.stderr}`);
      }

      const concederPrivilegios = pg.psqlComo(
        'postgres',
        'GRANT CONNECT, CREATE ON DATABASE "' +
          freshDatabase +
          '" TO crm_migrator; GRANT USAGE, CREATE ON SCHEMA public TO crm_migrator;',
        freshDatabase
      );
      if (concederPrivilegios.status !== 0) {
        throw new Error(`Falha ao conceder privilégios a crm_migrator no database novo: ${concederPrivilegios.stderr}`);
      }

      freshDatabaseUrl = pg.migratorUrl.slice(0, pg.migratorUrl.lastIndexOf('/') + 1) + freshDatabase;
    });

    test('drizzle-kit migrate roda de novo sem falhar nem duplicar tabela @spec:AC-017', async () => {
      const pool = new Pool({ connectionString: freshDatabaseUrl });
      try {
        const db = drizzleNodePostgres(pool);
        const migrationsFolder = path.join(process.cwd(), 'drizzle');

        await migrate(db, { migrationsFolder });
        // Reaplicação: o journal do drizzle-orm já sabe que 0000 foi
        // aplicada e pula — se isso não fosse idempotente, rejeitaria a
        // promise (tabela/tipo já existe) e o `await` abaixo lançaria.
        await migrate(db, { migrationsFolder });
      } finally {
        await pool.end();
      }

      const contagem = pg.psqlComo(
        'crm_migrator',
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empresas'",
        freshDatabase
      );
      expect(contagem.status).toBe(0);
      expect(contagem.stdout.trim()).toBe('1');
    }, 60_000);

    test('seeds (0005) reaplicados diretamente não duplicam etapas, transições nem motivos de perda @spec:AC-017', () => {
      const seedSql = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0005_seeds.sql'), 'utf8');

      const contar = (tabela: string) => {
        const resultado = pg.psqlComo('crm_migrator', `SELECT count(*) FROM "${tabela}"`);
        expect(resultado.status, `contagem de "${tabela}" falhou: ${resultado.stderr}`).toBe(0);
        return resultado.stdout.trim();
      };

      const etapasAntes = contar('pipeline_etapas');
      const transicoesAntes = contar('pipeline_transicoes');
      const motivosAntes = contar('motivos_perda');
      expect(etapasAntes).toBe('15');
      expect(motivosAntes).toBe('4');

      const reaplicarSeeds = pg.psqlComo('crm_migrator', seedSql);
      expect(reaplicarSeeds.status, `reaplicar o seed deveria terminar com sucesso: ${reaplicarSeeds.stderr}`).toBe(0);

      expect(contar('pipeline_etapas')).toBe(etapasAntes);
      expect(contar('pipeline_transicoes')).toBe(transicoesAntes);
      expect(contar('motivos_perda')).toBe(motivosAntes);
    });
  });

  describe('AC-018: colunas de tenant são NOT NULL', () => {
    beforeAll(() => {
      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste', 'empresa-teste-ac018');
         INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO_ID}', 'ac018@teste.com', 'Usuario Teste');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste');
         INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${OPORTUNIDADE_ID}', '${EMPRESA_ID}', '${LEAD_ID}', 1);
         INSERT INTO "campanhas" ("id", "empresa_id", "nome", "assunto", "corpo_html") VALUES ('${CAMPANHA_ID}', '${EMPRESA_ID}', 'Campanha Teste', 'Assunto', '<p>corpo</p>');`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures válidas para o AC-018: ${setup.stderr}`);
      }
    });

    for (const { tabela, sql } of INSERCOES_SEM_TENANT) {
      test(`inserir em "${tabela}" sem empresa_id é rejeitado por violação de NOT NULL @spec:AC-018`, () => {
        const resultado = pg.psqlComo('crm_migrator', sql);
        expect(resultado.status, `insert em "${tabela}" sem empresa_id deveria falhar`).not.toBe(0);
        expect(resultado.stderr).toMatch(/empresa_id/);
        expect(resultado.stderr).toMatch(/not-null|null value/i);
      });
    }
  });
});
