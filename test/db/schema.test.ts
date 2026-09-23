// Testes de T-021 (fase1-schema-drizzle, US-007/US-008): prova, contra um
// Postgres 15 efêmero real (harness de T-020), que as migrations aplicam o
// schema completo (AC-015), que as tabelas do Better Auth nascem junto
// (AC-016), que reaplicar a parte idempotente do pipeline (os seeds — a
// única migration desta feature que é literalmente reexecutável, ver
// comentário de drizzle/0005_seeds.sql) não falha nem duplica nada
// (AC-017), e que nenhuma tabela de negócio aceita linha sem empresa_id
// (AC-018).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-021: schema completo e tenant obrigatório', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  test('AC-015: migrations aplicam o schema completo num Postgres limpo @spec:AC-015', () => {
    const tabelasEsperadas = [
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

    const resultado = pg.psqlComo(
      'crm_migrator',
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    expect(resultado.status).toBe(0);

    const tabelas = resultado.stdout.trim().split('\n').filter(Boolean);
    for (const tabela of tabelasEsperadas) {
      expect(tabelas).toContain(tabela);
    }
  });

  test('AC-016: as tabelas do Better Auth existem no schema @spec:AC-016', () => {
    const resultado = pg.psqlComo(
      'crm_migrator',
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('contas', 'sessoes', 'tokens_verificacao') ORDER BY table_name"
    );
    expect(resultado.status).toBe(0);
    expect(resultado.stdout.trim().split('\n').filter(Boolean)).toEqual([
      'contas',
      'sessoes',
      'tokens_verificacao',
    ]);
  });

  test('AC-017: reaplicar os seeds não falha nem duplica etapa, transição ou motivo @spec:AC-017', () => {
    const contarAntes = () => ({
      etapas: pg.psqlComo('crm_migrator', 'SELECT count(*) FROM pipeline_etapas').stdout.trim(),
      transicoes: pg.psqlComo('crm_migrator', 'SELECT count(*) FROM pipeline_transicoes').stdout.trim(),
      motivos: pg.psqlComo('crm_migrator', 'SELECT count(*) FROM motivos_perda').stdout.trim(),
    });

    const antes = contarAntes();
    expect(antes.etapas).toBe('15');

    const seedsSql = fs.readFileSync(
      path.join(process.cwd(), 'drizzle', '0005_seeds.sql'),
      'utf8'
    );
    const reaplicacao = pg.psqlComo('crm_migrator', seedsSql);
    expect(reaplicacao.status).toBe(0);

    const depois = contarAntes();
    expect(depois).toEqual(antes);
  });

  test('AC-018: colunas de tenant são NOT NULL @spec:AC-018', () => {
    const insercoesSemEmpresaId: Record<string, string> = {
      leads: `INSERT INTO "leads" ("nome") VALUES ('teste ac-018')`,
      oportunidades: `INSERT INTO "oportunidades" ("lead_id", "etapa_id") VALUES (gen_random_uuid(), 1)`,
      cadencia_atividades: `INSERT INTO "cadencia_atividades" ("oportunidade_id", "sequencia", "dia", "turno", "canal", "tipo") VALUES (gen_random_uuid(), 1, 1, 'manha', 'telefone', 'ligacao')`,
      oportunidade_eventos: `INSERT INTO "oportunidade_eventos" ("oportunidade_id", "tipo", "ator_tipo") VALUES (gen_random_uuid(), 'teste', 'sistema')`,
      tarefas_agendadas: `INSERT INTO "tarefas_agendadas" ("oportunidade_id", "tipo", "agendada_para") VALUES (gen_random_uuid(), 'teste', now())`,
      anexos: `INSERT INTO "anexos" ("oportunidade_id", "caminho", "mime", "tamanho", "hash") VALUES (gen_random_uuid(), '/x', 'text/plain', 1, 'hash')`,
      reunioes: `INSERT INTO "reunioes" ("oportunidade_id", "agendada_para") VALUES (gen_random_uuid(), now())`,
      whatsapp_mensagens: `INSERT INTO "whatsapp_mensagens" ("numero", "mensagem", "direcao") VALUES ('5511999999999', 'oi', 'enviada')`,
      campanhas: `INSERT INTO "campanhas" ("nome", "assunto", "corpo_html") VALUES ('teste', 'assunto', '<p>x</p>')`,
      envios_campanha: `INSERT INTO "envios_campanha" ("campanha_id", "nome_destinatario", "email_destinatario") VALUES (gen_random_uuid(), 'teste', 'teste@exemplo.com')`,
      empresa_configuracoes: `INSERT INTO "empresa_configuracoes" ("chave", "valor") VALUES ('teste', '{}'::jsonb)`,
    };

    for (const [tabela, sql] of Object.entries(insercoesSemEmpresaId)) {
      const resultado = pg.psqlComo('crm_migrator', sql);
      expect(resultado.status, `INSERT em "${tabela}" sem empresa_id deveria falhar`).not.toBe(0);
      expect(
        resultado.stderr,
        `INSERT em "${tabela}" sem empresa_id deveria falhar por violação de NOT NULL em empresa_id`
      ).toMatch(/null value in column "empresa_id"|empresa_id.*not-null|viola.*not-null.*empresa_id/i);
    }
  });
});
