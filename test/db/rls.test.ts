// Testes de T-022 (fase1-schema-drizzle, US-009): prova, contra um Postgres 15
// efêmero real (harness de T-020) com as migrations de T-015 aplicadas, que
// toda tabela de negócio com `empresa_id` tem RLS habilitado com policy de
// isolamento por tenant (AC-019), e que a role de runtime `crm_app`, sem
// `SET LOCAL app.empresa_id` na transação, não lê nem grava linha nenhuma —
// o RLS falha fechado, nunca aberto (AC-020).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

// Mesma lista de tabelas de negócio com `empresa_id` do AC-018 — é sobre elas
// que a migration 0001_rls.sql (T-015) habilita RLS.
const TABELAS_RLS = [
  'empresa_configuracoes',
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
];

const EMPRESA_A = 'bbbbbbbb-0000-0000-0000-000000000001';
const EMPRESA_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const LEAD_A = 'bbbbbbbb-0000-0000-0000-000000000011';
const LEAD_B = 'bbbbbbbb-0000-0000-0000-000000000012';
const OPORTUNIDADE_A = 'bbbbbbbb-0000-0000-0000-000000000021';
const OPORTUNIDADE_B = 'bbbbbbbb-0000-0000-0000-000000000022';
const CAMPANHA_A = 'bbbbbbbb-0000-0000-0000-000000000031';
const CAMPANHA_B = 'bbbbbbbb-0000-0000-0000-000000000032';

// Um insert válido por tabela, parametrizado por empresa/lead/oportunidade/
// campanha — usado tanto para semear as duas empresas (fixtures, via
// crm_migrator, que é dono das tabelas e não sofre RLS) quanto para a
// tentativa de escrita da AC-020 (como crm_app, sem `SET LOCAL`).
function insertsPorEmpresa(empresaId: string, leadId: string, oportunidadeId: string, campanhaId: string) {
  const porTabela: Record<string, string> = {
    empresa_configuracoes: `INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES ('${empresaId}', 'chave_rls', '{}'::jsonb)`,
    leads: `INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadId}', '${empresaId}', 'Lead RLS')`,
    oportunidades: `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${oportunidadeId}', '${empresaId}', '${leadId}', 1)`,
    cadencia_atividades: `INSERT INTO "cadencia_atividades" ("oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
          VALUES ('${oportunidadeId}', '${empresaId}', 1, 1, 'manha', 'telefone', 'ligacao')`,
    oportunidade_eventos: `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "ator_tipo")
          VALUES ('${empresaId}', '${oportunidadeId}', 'teste', 'sistema')`,
    tarefas_agendadas: `INSERT INTO "tarefas_agendadas" ("empresa_id", "oportunidade_id", "tipo", "agendada_para")
          VALUES ('${empresaId}', '${oportunidadeId}', 'ligar', now())`,
    anexos: `INSERT INTO "anexos" ("empresa_id", "oportunidade_id", "caminho", "mime", "tamanho", "hash")
          VALUES ('${empresaId}', '${oportunidadeId}', '/tmp/arquivo.pdf', 'application/pdf', 10, 'hash123')`,
    reunioes: `INSERT INTO "reunioes" ("empresa_id", "oportunidade_id", "agendada_para") VALUES ('${empresaId}', '${oportunidadeId}', now())`,
    whatsapp_mensagens: `INSERT INTO "whatsapp_mensagens" ("empresa_id", "numero", "mensagem", "direcao")
          VALUES ('${empresaId}', '5511999999999', 'oi', 'enviada')`,
    campanhas: `INSERT INTO "campanhas" ("id", "empresa_id", "nome", "assunto", "corpo_html")
          VALUES ('${campanhaId}', '${empresaId}', 'Campanha RLS', 'Assunto', '<p>corpo</p>')`,
    envios_campanha: `INSERT INTO "envios_campanha" ("empresa_id", "campanha_id", "nome_destinatario", "email_destinatario")
          VALUES ('${empresaId}', '${campanhaId}', 'Fulano', 'fulano@teste.com')`,
  };
  return porTabela;
}

const INSERTS_EMPRESA_A = insertsPorEmpresa(EMPRESA_A, LEAD_A, OPORTUNIDADE_A, CAMPANHA_A);
const INSERTS_EMPRESA_B = insertsPorEmpresa(EMPRESA_B, LEAD_B, OPORTUNIDADE_B, CAMPANHA_B);

describe('T-022: RLS garante isolamento por tenant', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const criarEmpresas = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A', 'empresa-a-rls'),
         ('${EMPRESA_B}', 'Empresa B', 'empresa-b-rls')`
    );
    if (criarEmpresas.status !== 0) {
      throw new Error(`Falha ao preparar empresas fixture: ${criarEmpresas.stderr}`);
    }

    // Semeia uma linha por tabela para cada empresa, como crm_migrator (dono
    // das tabelas — RLS não se aplica ao dono, então isso não testa RLS, só
    // prepara dados que o RLS deveria esconder/mostrar seletivamente).
    for (const tabela of TABELAS_RLS) {
      for (const inserts of [INSERTS_EMPRESA_A, INSERTS_EMPRESA_B]) {
        const resultado = pg.psqlComo('crm_migrator', inserts[tabela]);
        if (resultado.status !== 0) {
          throw new Error(`Falha ao semear fixture de "${tabela}": ${resultado.stderr}`);
        }
      }
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  describe('AC-019: RLS ativo em toda tabela com empresa_id', () => {
    test('todas as tabelas de negócio têm rowsecurity habilitado @spec:AC-019', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true ORDER BY tablename`
      );
      expect(resultado.status).toBe(0);

      const tabelasComRls = new Set(resultado.stdout.trim().split('\n').filter(Boolean));
      for (const tabela of TABELAS_RLS) {
        expect(tabelasComRls.has(tabela), `tabela "${tabela}" deveria ter RLS habilitado`).toBe(true);
      }
    });

    for (const tabela of TABELAS_RLS) {
      test(`"${tabela}" tem policy filtrando por empresa_id/app.empresa_id @spec:AC-019`, () => {
        const resultado = pg.psqlComo(
          'crm_migrator',
          `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = '${tabela}'`
        );
        expect(resultado.status).toBe(0);

        const qual = resultado.stdout.trim();
        expect(qual, `"${tabela}" deveria ter ao menos uma policy`).not.toBe('');
        expect(qual).toMatch(/empresa_id/);
        expect(qual).toMatch(/current_setting\('app\.empresa_id'/);
      });
    }
  });

  describe('AC-020: sem app.empresa_id definido, crm_app não lê nem escreve linha nenhuma', () => {
    for (const tabela of TABELAS_RLS) {
      test(`SELECT em "${tabela}" como crm_app sem SET LOCAL não retorna nenhuma linha @spec:AC-020`, () => {
        const resultado = pg.psqlComo('crm_app', `SELECT count(*) FROM "${tabela}"`);
        if (resultado.status === 0) {
          // current_setting sem default poderia, em tese, resolver para uma
          // string vazia em vez de lançar erro — mesmo nesse caso, o RLS
          // fail-closed exige que a policy não case com empresa_id nenhum.
          expect(resultado.stdout.trim()).toBe('0');
        } else {
          // Comportamento real do Postgres: current_setting('app.empresa_id')
          // sem `SET` na sessão lança "unrecognized configuration parameter"
          // antes mesmo de a policy ser avaliada — a operação não retorna
          // nenhuma linha de nenhum tenant.
          expect(resultado.stderr).toMatch(/app\.empresa_id/);
        }
      });

      test(`INSERT em "${tabela}" como crm_app sem SET LOCAL é rejeitado e não grava nenhuma linha @spec:AC-020`, () => {
        // Índice da tabela na lista (2 dígitos hex) como sufixo — garante um
        // UUID válido e único por tabela, diferente do hash usado nas
        // fixtures semeadas no beforeAll.
        const sufixo = TABELAS_RLS.indexOf(tabela).toString(16).padStart(2, '0');
        const novoId = `cccccccc-0000-0000-0000-0000000000${sufixo}`;
        const inserts = insertsPorEmpresa(EMPRESA_A, LEAD_A, OPORTUNIDADE_A, CAMPANHA_A);
        // Troca o id gerado (quando a tabela tem um) por um valor novo, para
        // que uma eventual falha do isolamento (bug) não colida com a
        // fixture já semeada e mascare o resultado do teste.
        const sql = inserts[tabela].replace(/VALUES \('([0-9a-f-]{36})'/, `VALUES ('${novoId}'`);

        const contarAntes = pg.psqlComo('crm_migrator', `SELECT count(*) FROM "${tabela}"`);
        expect(contarAntes.status).toBe(0);

        const resultado = pg.psqlComo('crm_app', sql);
        expect(resultado.status, `insert em "${tabela}" como crm_app sem SET LOCAL deveria falhar`).not.toBe(0);
        expect(resultado.stderr).toMatch(/app\.empresa_id|row-level security|new row violates/i);

        const contarDepois = pg.psqlComo('crm_migrator', `SELECT count(*) FROM "${tabela}"`);
        expect(contarDepois.status).toBe(0);
        expect(contarDepois.stdout.trim()).toBe(contarAntes.stdout.trim());
      });
    }
  });
});
