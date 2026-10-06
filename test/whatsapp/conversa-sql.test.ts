// T-071 (fase2c-whatsapp-conversa, US-046/US-047): prova, contra um Postgres
// 15 efêmero real, a migration 0009 — o backfill de `lida_em` nas mensagens
// `recebida` já existentes antes da virada (AC-153) e o isolamento por
// tenant da tabela nova `lead_telefones` (AC-164).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const DRIZZLE_DIR = path.join(process.cwd(), 'drizzle');
const MIGRATION_0009 = '0009_whatsapp_conversa.sql';

// `pg.aplicarMigrations()` aplica todo `drizzle/*.sql` de uma vez — para
// provar o backfill da AC-153 precisamos de um ponto de parada no meio
// (estado "antes da 0009") com dados já gravados, por isso este teste
// reimplementa a aplicação migration-a-migration (mesmo mecanismo do
// harness: `docker exec -i ... psql -U crm_migrator`, sem passar pela
// função pronta, que não permite parar no meio).
function aplicarArquivoDeMigration(pg: PostgresEfemero, nomeArquivo: string): void {
  const sql = fs.readFileSync(path.join(DRIZZLE_DIR, nomeArquivo), 'utf8');
  const resultado = spawnSync(
    'docker',
    ['exec', '-i', pg.containerName, 'psql', '-U', 'crm_migrator', '-d', pg.database, '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql }
  );
  if (resultado.status !== 0) {
    throw new Error(`Falha ao aplicar migration "${nomeArquivo}": ${resultado.stderr}`);
  }
}

function migrationsAnterioresA0009(): string[] {
  return fs
    .readdirSync(DRIZZLE_DIR)
    .filter((nome) => nome.endsWith('.sql') && nome !== MIGRATION_0009)
    .sort();
}

// `psql -t -A` suprime cabeçalho/rodapé de SELECT, mas não a tag de status
// de SET/BEGIN/COMMIT/ROLLBACK/INSERT/UPDATE/DELETE — mesmo filtro de
// test/whatsapp/conexao-sql.test.ts, necessário aqui porque várias consultas
// combinam `SET app.empresa_id = ...;` com a query de interesse na mesma
// chamada.
const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
function valorRetornado(stdout: string): string {
  return stdout
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
    .join('\n');
}

describe('T-071: migration 0009 — telefones do lead e estado de leitura', () => {
  describe('AC-153: mensagens antigas não viram "não lidas" na virada', () => {
    let pg: PostgresEfemero;
    const EMPRESA_ID = 'eeeeeeee-0000-0000-0000-000000000001';
    const LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000002';
    let mensagemRecebidaId: string;
    let mensagemEnviadaId: string;

    beforeAll(async () => {
      pg = await subirPostgresEfemero();

      for (const arquivo of migrationsAnterioresA0009()) {
        aplicarArquivoDeMigration(pg, arquivo);
      }

      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste Conversa', 'empresa-teste-conversa');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste Conversa');`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
      }

      // Antes da 0009 a coluna `lida_em` não existe — esta é exatamente a
      // mensagem "já existente antes da migration" do enunciado da AC-153.
      const recebida = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao")
         VALUES ('${EMPRESA_ID}', '${LEAD_ID}', '558599991001', 'oi, preciso de ajuda', 'recebida')
         RETURNING "id"`
      );
      if (recebida.status !== 0) {
        throw new Error(`Falha ao inserir mensagem recebida fixture: ${recebida.stderr}`);
      }
      mensagemRecebidaId = valorRetornado(recebida.stdout);

      const enviada = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao")
         VALUES ('${EMPRESA_ID}', '${LEAD_ID}', '558599991001', 'já te retorno', 'enviada')
         RETURNING "id"`
      );
      if (enviada.status !== 0) {
        throw new Error(`Falha ao inserir mensagem enviada fixture: ${enviada.stderr}`);
      }
      mensagemEnviadaId = valorRetornado(enviada.stdout);

      aplicarArquivoDeMigration(pg, MIGRATION_0009);
    }, 120_000);

    afterAll(() => {
      pg?.parar();
    });

    test('mensagem recebida já existente fica com lida_em preenchida igual a criado_em @spec:AC-153', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT ("lida_em" IS NOT NULL), ("lida_em" = "criado_em") FROM "whatsapp_mensagens" WHERE "id" = '${mensagemRecebidaId}'`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim()).toBe('t|t');
    });

    test('mensagem enviada já existente não recebe lida_em (coluna só tem sentido para recebida) @spec:AC-153', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT "lida_em" FROM "whatsapp_mensagens" WHERE "id" = '${mensagemEnviadaId}'`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim()).toBe('');
    });

    test('nenhuma mensagem recebida fica sem lida_em após a virada — a consulta de não lidas não acha nenhuma delas @spec:AC-153', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "whatsapp_mensagens" WHERE "empresa_id" = '${EMPRESA_ID}' AND "direcao" = 'recebida' AND "lida_em" IS NULL`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim()).toBe('0');
    });
  });

  describe('AC-164: telefones de uma empresa não aparecem para outra', () => {
    let pg: PostgresEfemero;
    const EMPRESA_A = 'eeeeeeee-0000-0000-0000-00000000a001';
    const EMPRESA_B = 'eeeeeeee-0000-0000-0000-00000000b001';
    const LEAD_A = 'eeeeeeee-0000-0000-0000-00000000a002';
    const LEAD_B = 'eeeeeeee-0000-0000-0000-00000000b002';
    const NUMERO_COMPARTILHADO = '5585988887777';

    beforeAll(async () => {
      pg = await subirPostgresEfemero();
      pg.aplicarMigrations();

      const setup = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
           ('${EMPRESA_A}', 'Empresa A Telefones', 'empresa-a-telefones'),
           ('${EMPRESA_B}', 'Empresa B Telefones', 'empresa-b-telefones');
         INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
           ('${LEAD_A}', '${EMPRESA_A}', 'Lead A'),
           ('${LEAD_B}', '${EMPRESA_B}', 'Lead B');`
      );
      if (setup.status !== 0) {
        throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
      }
    }, 120_000);

    afterAll(() => {
      pg?.parar();
    });

    function inserirTelefone(empresaId: string, leadId: string, numero: string, rotulo = 'recepção') {
      return pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${empresaId}';
         INSERT INTO "lead_telefones" ("empresa_id", "lead_id", "numero", "rotulo")
         VALUES ('${empresaId}', '${leadId}', '${numero}', '${rotulo}')`
      );
    }

    test('o mesmo número cadastrado como extra em duas empresas nunca acusa duplicidade entre elas @spec:AC-164', () => {
      const naEmpresaA = inserirTelefone(EMPRESA_A, LEAD_A, NUMERO_COMPARTILHADO);
      expect(naEmpresaA.status, `inserção na empresa A deveria ter sucesso: ${naEmpresaA.stderr}`).toBe(0);

      const naEmpresaB = inserirTelefone(EMPRESA_B, LEAD_B, NUMERO_COMPARTILHADO);
      expect(
        naEmpresaB.status,
        `inserção do mesmo número na empresa B não deveria colidir com a A: ${naEmpresaB.stderr}`
      ).toBe(0);
    });

    test('cada empresa só lista os próprios telefones (RLS), mesmo consultando pela role de runtime @spec:AC-164', () => {
      const vistosPelaA = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}'; SELECT count(*) FROM "lead_telefones"`
      );
      expect(vistosPelaA.status).toBe(0);
      expect(valorRetornado(vistosPelaA.stdout)).toBe('1');

      const vistosPelaB = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_B}'; SELECT count(*) FROM "lead_telefones"`
      );
      expect(vistosPelaB.status).toBe(0);
      expect(valorRetornado(vistosPelaB.stdout)).toBe('1');
    });

    test('filtrar explicitamente pelo empresa_id da outra empresa não revela a linha dela @spec:AC-164', () => {
      const resultado = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}'; SELECT count(*) FROM "lead_telefones" WHERE "empresa_id" = '${EMPRESA_B}'`
      );
      expect(resultado.status).toBe(0);
      expect(valorRetornado(resultado.stdout)).toBe('0');
    });

    test('remover telefone de outra empresa não apaga nada @spec:AC-164', () => {
      const idDoTelefoneB = pg.psqlComo(
        'crm_migrator',
        `SELECT "id" FROM "lead_telefones" WHERE "empresa_id" = '${EMPRESA_B}'`
      );
      expect(idDoTelefoneB.status).toBe(0);
      const telefoneId = idDoTelefoneB.stdout.trim();

      const tentativaDeA = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}'; DELETE FROM "lead_telefones" WHERE "id" = '${telefoneId}'`
      );
      expect(tentativaDeA.status).toBe(0);
      expect(tentativaDeA.stdout).toMatch(/DELETE 0/);

      const aindaExiste = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "lead_telefones" WHERE "id" = '${telefoneId}'`
      );
      expect(aindaExiste.stdout.trim()).toBe('1');
    });

    test('não é possível cadastrar telefone ligando empresa de um tenant a lead de outro @spec:AC-164', () => {
      const resultado = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         INSERT INTO "lead_telefones" ("empresa_id", "lead_id", "numero", "rotulo")
         VALUES ('${EMPRESA_A}', '${LEAD_B}', '5585977776666', 'financeiro')`
      );
      expect(resultado.status, 'lead de outra empresa não deveria aceitar telefone').not.toBe(0);
      expect(resultado.stderr).toMatch(/LEAD_EMPRESA_DIVERGENTE|row-level security/i);
    });
  });
});
