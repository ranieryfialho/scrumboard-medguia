// Testes de T-075 (fase2c-whatsapp-conversa): `localizarLeadPorNumero`
// (src/repositories/whatsapp.ts) passa a casar também pelos telefones
// extras do lead (`lead_telefones`, T-073/US-047), não só pelo principal
// (`leads.telefone_e164`) — contra um Postgres 15 efêmero real com a
// migration 0009 aplicada.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buscarLeadPorNumero, registrarMensagemRecebida } from '../../src/repositories/whatsapp';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'c0000000-0000-0000-0000-000000000001';
const EMPRESA_B = 'c0000000-0000-0000-0000-000000000002';

// AC-142: telefone principal de um lead e telefone extra de outro, ambos na empresa A.
const LEAD_PRINCIPAL_A = 'c0000000-0000-0000-0000-0000000000a1';
const LEAD_EXTRA_A = 'c0000000-0000-0000-0000-0000000000a2';
// Telefone que só existe como principal de um lead da empresa B — nunca liga a partir da empresa A.
const LEAD_SO_EM_B = 'c0000000-0000-0000-0000-0000000000b1';

// AC-165: lead em cadência (etapa 3) só com telefone extra cadastrado (sem telefone principal).
const LEAD_CADENCIA_EXTRA_A = 'c0000000-0000-0000-0000-0000000000a3';
const OPORTUNIDADE_CADENCIA_EXTRA_A = 'c0000000-0000-0000-0000-0000000000c3';

// AC-166a: o mesmo número é principal de um lead sem cadência e extra de outro lead em cadência — vence a cadência.
const LEAD_SEM_CADENCIA_PRINCIPAL_A = 'c0000000-0000-0000-0000-0000000000a4';
const LEAD_COM_CADENCIA_EXTRA_A = 'c0000000-0000-0000-0000-0000000000a5';
const OPORTUNIDADE_COM_CADENCIA_EXTRA_A = 'c0000000-0000-0000-0000-0000000000c5';

// AC-166b: o mesmo número é extra de dois leads, nenhum em cadência — vence o criado mais recentemente.
const LEAD_EXTRA_ANTIGO_A = 'c0000000-0000-0000-0000-0000000000a6';
const LEAD_EXTRA_RECENTE_A = 'c0000000-0000-0000-0000-0000000000a7';

describe('T-075: localização de lead por telefone principal ou extra', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Telefones', 'empresa-a-telefones'),
         ('${EMPRESA_B}', 'Empresa B Telefones', 'empresa-b-telefones');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_PRINCIPAL_A}', '${EMPRESA_A}', 'Lead Principal A', '+5585999985587'),
         ('${LEAD_EXTRA_A}', '${EMPRESA_A}', 'Lead Extra A', NULL),
         ('${LEAD_SO_EM_B}', '${EMPRESA_B}', 'Lead Só em B', '+5585911112222'),
         ('${LEAD_CADENCIA_EXTRA_A}', '${EMPRESA_A}', 'Lead Cadência Extra A', NULL),
         ('${LEAD_SEM_CADENCIA_PRINCIPAL_A}', '${EMPRESA_A}', 'Lead Sem Cadência Principal A', '+5585933332222'),
         ('${LEAD_COM_CADENCIA_EXTRA_A}', '${EMPRESA_A}', 'Lead Com Cadência Extra A', NULL),
         ('${LEAD_EXTRA_ANTIGO_A}', '${EMPRESA_A}', 'Lead Extra Antigo A', NULL),
         ('${LEAD_EXTRA_RECENTE_A}', '${EMPRESA_A}', 'Lead Extra Recente A', NULL);

       UPDATE "leads" SET "criado_em" = '2026-01-01T00:00:00Z' WHERE "id" = '${LEAD_EXTRA_ANTIGO_A}';
       UPDATE "leads" SET "criado_em" = '2026-01-02T00:00:00Z' WHERE "id" = '${LEAD_EXTRA_RECENTE_A}';

       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo") VALUES
         ('c0000000-0000-0000-0000-0000000000e1', '${EMPRESA_A}', '${LEAD_EXTRA_A}', '5585988887777', 'Sócio'),
         ('c0000000-0000-0000-0000-0000000000e2', '${EMPRESA_A}', '${LEAD_CADENCIA_EXTRA_A}', '5585944443333', 'Recepção'),
         ('c0000000-0000-0000-0000-0000000000e3', '${EMPRESA_A}', '${LEAD_COM_CADENCIA_EXTRA_A}', '5585933332222', 'Financeiro'),
         ('c0000000-0000-0000-0000-0000000000e4', '${EMPRESA_A}', '${LEAD_EXTRA_ANTIGO_A}', '5585922221111', 'Recepção'),
         ('c0000000-0000-0000-0000-0000000000e5', '${EMPRESA_A}', '${LEAD_EXTRA_RECENTE_A}', '5585922221111', 'Recepção');

       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES
         ('${OPORTUNIDADE_CADENCIA_EXTRA_A}', '${EMPRESA_A}', '${LEAD_CADENCIA_EXTRA_A}', 3),
         ('${OPORTUNIDADE_COM_CADENCIA_EXTRA_A}', '${EMPRESA_A}', '${LEAD_COM_CADENCIA_EXTRA_A}', 3);`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  // `psqlComo` imprime a tag de status do comando junto com a linha de dado
  // mesmo com `-t -A`; descarta essas tags (mesmo padrão de test/repositories/whatsapp.test.ts).
  const TAG_DE_COMANDO = /^(SET|BEGIN|COMMIT|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/;
  function valorRetornado(stdout: string): string {
    return stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha !== '' && !TAG_DE_COMANDO.test(linha))
      .join('\n');
  }

  function estadoOportunidade(id: string): string {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT "etapa_id", "version", "cadencia_encerrada_em" IS NOT NULL FROM "oportunidades" WHERE "id" = '${id}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return valorRetornado(resultado.stdout);
  }

  function contarEventosConexao(oportunidadeId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'conexao_whatsapp'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  function contarMensagens(empresaId: string, evolutionMessageId: string): number {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "whatsapp_mensagens" WHERE "empresa_id" = '${empresaId}' AND "evolution_message_id" = '${evolutionMessageId}'`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
    return Number(valorRetornado(resultado.stdout));
  }

  let contadorEvolutionId = 0;
  function proximoEvolutionId(): string {
    contadorEvolutionId += 1;
    return `evo-t075-${contadorEvolutionId}`;
  }

  describe('AC-142: número avulso que é telefone (principal ou extra) de um lead da empresa liga a ele', () => {
    test('variação do nono dígito do telefone principal liga ao lead dono @spec:AC-142', async () => {
      const lead = await buscarLeadPorNumero(db, { empresaId: EMPRESA_A }, '558599985587');
      expect(lead?.id).toBe(LEAD_PRINCIPAL_A);
    });

    test('telefone extra cadastrado no lead liga a ele @spec:AC-142', async () => {
      const lead = await buscarLeadPorNumero(db, { empresaId: EMPRESA_A }, '5585988887777');
      expect(lead?.id).toBe(LEAD_EXTRA_A);
    });

    test('número de lead de outra empresa nunca liga @spec:AC-142', async () => {
      // '5585911112222' só existe como principal de LEAD_SO_EM_B (empresa B).
      const naPropriaEmpresa = await buscarLeadPorNumero(db, { empresaId: EMPRESA_B }, '5585911112222');
      expect(naPropriaEmpresa?.id).toBe(LEAD_SO_EM_B);

      const naOutraEmpresa = await buscarLeadPorNumero(db, { empresaId: EMPRESA_A }, '5585911112222');
      expect(naOutraEmpresa).toBeNull();

      // O telefone extra de LEAD_EXTRA_A (empresa A) também não liga sob o tenant da B.
      const extraSobOutroTenant = await buscarLeadPorNumero(db, { empresaId: EMPRESA_B }, '5585988887777');
      expect(extraSobOutroTenant).toBeNull();
    });
  });

  describe('AC-165: resposta pelo telefone extra liga ao lead e encerra a cadência', () => {
    test('mensagem recebida do telefone extra grava com o lead_id e move o card para Qualificando @spec:AC-165', async () => {
      const evolutionId = proximoEvolutionId();

      expect(estadoOportunidade(OPORTUNIDADE_CADENCIA_EXTRA_A)).toBe('3|1|f');
      expect(contarEventosConexao(OPORTUNIDADE_CADENCIA_EXTRA_A)).toBe(0);

      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585944443333', texto: 'oi, sou a recepção', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_CADENCIA_EXTRA_A);
      expect(contarMensagens(EMPRESA_A, evolutionId)).toBe(1);
      // Etapa 5 = Qualificando; cadência encerrada; um evento de conexão novo.
      expect(estadoOportunidade(OPORTUNIDADE_CADENCIA_EXTRA_A)).toBe('5|2|t');
      expect(contarEventosConexao(OPORTUNIDADE_CADENCIA_EXTRA_A)).toBe(1);
    });
  });

  describe('AC-166: desempate quando o mesmo número aparece em mais de um lead da empresa', () => {
    test('principal de um lead sem cadência vs. extra de outro em cadência: vence a cadência @spec:AC-166', async () => {
      const evolutionId = proximoEvolutionId();

      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585933332222', texto: 'oi', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_COM_CADENCIA_EXTRA_A);
      expect(contarMensagens(EMPRESA_A, evolutionId)).toBe(1);
      expect(estadoOportunidade(OPORTUNIDADE_COM_CADENCIA_EXTRA_A)).toBe('5|2|t');

      // O lead sem cadência (dono do principal) nunca conectou nem recebeu a mensagem.
      const resultadoDireto = await pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "whatsapp_mensagens" WHERE "lead_id" = '${LEAD_SEM_CADENCIA_PRINCIPAL_A}'`
      );
      expect(Number(valorRetornado(resultadoDireto.stdout))).toBe(0);
    });

    test('extra de dois leads sem cadência: vence o lead criado mais recentemente @spec:AC-166', async () => {
      const evolutionId = proximoEvolutionId();

      const resultado = await registrarMensagemRecebida(
        db,
        { empresaId: EMPRESA_A },
        { numero: '5585922221111', texto: 'oi', evolutionMessageId: evolutionId }
      );

      expect(resultado.leadId).toBe(LEAD_EXTRA_RECENTE_A);
      expect(contarMensagens(EMPRESA_A, evolutionId)).toBe(1);
    });
  });
});
