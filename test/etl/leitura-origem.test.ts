// Testes de T-139 (fase3-etl-supabase, US-074): leitores da origem contra o
// SCHEMA REAL do Supabase do CRM legado (test/etl/fixtures/legado-supabase.sql,
// colunas conferidas no `information_schema` em 22/10). Os testes antigos do
// ETL criavam uma versão inventada das tabelas da origem e por isso não
// pegaram que `envios_campanha` não tem `empresa_id` nem `whatsapp_mensagens`
// tem `lida_em`/`criado_em`.
import fs from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  lerCampanhas,
  lerConfiguracoes,
  lerEmpresas,
  lerEnvios,
  lerLeads,
  lerMensagens,
} from '../../src/etl/supabase/leitura-origem';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';
const CAMPANHA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPANHA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DATA_MENSAGEM = '2026-03-10T14:30:00.000Z';

describe('T-139: leitores da origem contra o schema real do legado', () => {
  let pg: PostgresEfemero;
  let pool: Pool;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    const ddl = fs.readFileSync(
      path.join(process.cwd(), 'test', 'etl', 'fixtures', 'legado-supabase.sql'),
      'utf8'
    );
    const criado = pg.psqlComo('crm_migrator', ddl);
    if (criado.status !== 0) throw new Error(`Falha ao criar o schema do legado: ${criado.stderr}`);

    pool = new Pool({ connectionString: pg.migratorUrl, options: '-c search_path=legado' });
    await pool.query(
      `INSERT INTO empresas (id, nome, slug, usa_sheets) VALUES
         ($1, 'Medguia', 'medguia', true), ($2, 'Outra', 'outra', false)`,
      [EMPRESA_A, EMPRESA_B]
    );
    await pool.query(
      `INSERT INTO leads (id, empresa_id, nome, email, whatsapp, situacao, origem, observacoes)
       VALUES (gen_random_uuid(), $1, 'Lead A', 'a@exemplo.com', '+5511999990001', 'Novos Leads', 'Meta', 'obs')`,
      [EMPRESA_A]
    );
    await pool.query(
      `INSERT INTO campanhas (id, empresa_id, nome, assunto, corpo_html, status, criado_por)
       VALUES ($1, $3, 'Camp A', 'Assunto A', '<p>a</p>', 'FINALIZADA', NULL),
              ($2, $4, 'Camp B', 'Assunto B', '<p>b</p>', 'PROCESSANDO', NULL)`,
      [CAMPANHA_A, CAMPANHA_B, EMPRESA_A, EMPRESA_B]
    );
    await pool.query(
      `INSERT INTO envios_campanha (id, campanha_id, nome_destinatario, email_destinatario, status, aberto_em, log_erro)
       VALUES (gen_random_uuid(), $1, 'Dest A', 'da@exemplo.com', 'ENVIADO', now(), NULL),
              (gen_random_uuid(), $2, 'Dest B', 'db@exemplo.com', 'ERRO', NULL, 'falhou')`,
      [CAMPANHA_A, CAMPANHA_B]
    );
    await pool.query(
      `INSERT INTO whatsapp_mensagens (id, empresa_id, lead_id, numero, mensagem, direcao, status, evolution_message_id, created_at)
       VALUES (gen_random_uuid(), $1, NULL, '5511999990001', 'oi', 'recebida', 'entregue', 'ev-1', $2)`,
      [EMPRESA_A, DATA_MENSAGEM]
    );
    await pool.query(
      `INSERT INTO empresa_configuracoes (id, empresa_id, chave, valor)
       VALUES (gen_random_uuid(), $1, 'evolution_instance_name', 'instancia-a')`,
      [EMPRESA_A]
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('cada envio é lido com a empresa da sua campanha e 0 tentativas (@spec:AC-342)', async () => {
    const envios = await lerEnvios(pool);

    expect(envios).toHaveLength(2);
    const porEmail = new Map(envios.map((envio) => [envio.emailDestinatario, envio]));
    expect(porEmail.get('da@exemplo.com')).toMatchObject({
      empresaId: EMPRESA_A,
      campanhaId: CAMPANHA_A,
      status: 'ENVIADO',
      tentativas: 0,
    });
    expect(porEmail.get('db@exemplo.com')).toMatchObject({
      empresaId: EMPRESA_B,
      campanhaId: CAMPANHA_B,
      status: 'ERRO',
      tentativas: 0,
    });
  });

  test('a mensagem é lida com a data original e como lida nessa mesma data (@spec:AC-343)', async () => {
    const mensagens = await lerMensagens(pool);

    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].criadoEm.toISOString()).toBe(DATA_MENSAGEM);
    expect(mensagens[0].lidaEm?.toISOString()).toBe(DATA_MENSAGEM);
    expect(mensagens[0]).toMatchObject({
      empresaId: EMPRESA_A,
      leadId: null,
      direcao: 'recebida',
      evolutionMessageId: 'ev-1',
    });
  });

  test('as seis leituras funcionam contra o schema real e devolvem as linhas da origem (@spec:AC-344)', async () => {
    const [empresas, leads, campanhas, envios, mensagens, configuracoes] = await Promise.all([
      lerEmpresas(pool),
      lerLeads(pool),
      lerCampanhas(pool),
      lerEnvios(pool),
      lerMensagens(pool),
      lerConfiguracoes(pool),
    ]);

    expect(empresas.map((empresa) => empresa.slug).sort()).toEqual(['medguia', 'outra']);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ empresaId: EMPRESA_A, nome: 'Lead A', situacao: 'Novos Leads' });
    expect(campanhas).toHaveLength(2);
    expect(envios).toHaveLength(2);
    expect(mensagens).toHaveLength(1);
    expect(configuracoes).toEqual([
      expect.objectContaining({ empresaId: EMPRESA_A, chave: 'evolution_instance_name', valor: 'instancia-a' }),
    ]);
  });
});
