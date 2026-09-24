// Testes de T-023 (fase1-schema-drizzle, US-010/US-013): prova, contra um
// Postgres 15 efêmero real (harness de T-020), que as invariantes do
// Playbook (valor/motivo/próxima ação obrigatórios por etapa, sequência de
// cadência única e limitada) são rejeitadas pelo banco via CHECK/UNIQUE, que
// `oportunidade_eventos` é append-only para `crm_app` (sem UPDATE/DELETE), e
// que `crm_app` não tem privilégio nenhum de DDL no schema `public`.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

// IDs das etapas do seed imutável de `pipeline_etapas` (T-019, ver comentário
// de drizzle/0002_constraints.sql): 1 = Entrada de leads (sem exigência —
// etapa neutra usada como âncora de FK), 7 = Follow de longo prazo,
// 11 = Proposta, 12 = Teste (Trial), 13 = Negociação, 14 = Perdido.
const ETAPA_NEUTRA = 1;
const ETAPA_FOLLOW = 7;
const ETAPA_PROPOSTA = 11;
const ETAPA_TESTE = 12;
const ETAPA_NEGOCIACAO = 13;
const ETAPA_PERDIDO = 14;

const EMPRESA_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const MOTIVO_ID = 'bbbbbbbb-0000-0000-0000-000000000003';
const OPORTUNIDADE_ANCORA_ID = 'bbbbbbbb-0000-0000-0000-000000000004';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `bbbbbbbb-0000-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

describe('T-023: invariantes do pipeline (constraints) e privilégios de DDL', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste Constraints', 'empresa-teste-constraints');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste');
       INSERT INTO "motivos_perda" ("id", "nome") VALUES ('${MOTIVO_ID}', 'Motivo Teste Constraints');
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id")
         VALUES ('${OPORTUNIDADE_ANCORA_ID}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_NEUTRA});`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de constraints: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  describe('AC-021: card não entra em Proposta sem valor > 0', () => {
    // Proposta também é etapa de acompanhamento (AC-023) e exige
    // `proxima_acao_em` — fixamos uma data futura válida aqui para isolar só
    // a exigência de valor (AC-021).
    test('etapa Proposta com valor nulo é rejeitada por CHECK @spec:AC-021', () => {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "valor", "proxima_acao_em")
         VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_PROPOSTA}, NULL, now() + interval '1 day')`
      );
      expect(resultado.status, 'insert em Proposta sem valor deveria falhar').not.toBe(0);
      expect(resultado.stderr).toMatch(/oportunidades_proposta_exige_valor/);
      expect(resultado.stderr).toMatch(/check constraint/i);
    });

    test('etapa Proposta com valor <= 0 é rejeitada por CHECK @spec:AC-021', () => {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "valor", "proxima_acao_em")
         VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_PROPOSTA}, 0, now() + interval '1 day')`
      );
      expect(resultado.status, 'insert em Proposta com valor 0 deveria falhar').not.toBe(0);
      expect(resultado.stderr).toMatch(/oportunidades_proposta_exige_valor/);
    });
  });

  describe('AC-022: card não entra em Perdido sem motivo', () => {
    test('etapa Perdido sem motivo_perda_id é rejeitada por CHECK @spec:AC-022', () => {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "motivo_perda_id")
         VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_PERDIDO}, NULL)`
      );
      expect(resultado.status, 'insert em Perdido sem motivo deveria falhar').not.toBe(0);
      expect(resultado.stderr).toMatch(/oportunidades_perdido_exige_motivo/);
    });

    test('etapa Perdido com motivo_perda_id preenchido é aceita @spec:AC-022', () => {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "motivo_perda_id")
         VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_PERDIDO}, '${MOTIVO_ID}')`
      );
      expect(resultado.status, `insert em Perdido com motivo deveria ter sucesso: ${resultado.stderr}`).toBe(0);
    });
  });

  describe('AC-023: card não entra em etapas de acompanhamento sem próxima ação', () => {
    const etapasDeAcompanhamento: Array<{ nome: string; etapaId: number; extraColunas: string; extraValores: string }> = [
      { nome: 'Follow de longo prazo', etapaId: ETAPA_FOLLOW, extraColunas: '', extraValores: '' },
      { nome: 'Teste (Trial)', etapaId: ETAPA_TESTE, extraColunas: '', extraValores: '' },
      { nome: 'Negociação', etapaId: ETAPA_NEGOCIACAO, extraColunas: '', extraValores: '' },
      // Proposta também exige valor > 0 (AC-021) — fixamos um valor válido
      // aqui para isolar só a exigência de próxima ação (AC-023).
      { nome: 'Proposta', etapaId: ETAPA_PROPOSTA, extraColunas: ', "valor"', extraValores: ', 100' },
    ];

    for (const { nome, etapaId, extraColunas, extraValores } of etapasDeAcompanhamento) {
      test(`etapa "${nome}" com próxima ação nula é rejeitada por CHECK @spec:AC-023`, () => {
        const id = proximoUuid();
        const resultado = pg.psqlComo(
          'crm_migrator',
          `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "proxima_acao_em"${extraColunas})
           VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${etapaId}, NULL${extraValores})`
        );
        expect(resultado.status, `insert em "${nome}" sem próxima ação deveria falhar`).not.toBe(0);
        expect(resultado.stderr).toMatch(/oportunidades_acompanhamento_exige_proxima_acao/);
      });

      test(`etapa "${nome}" com próxima ação no passado é rejeitada por CHECK @spec:AC-023`, () => {
        const id = proximoUuid();
        const resultado = pg.psqlComo(
          'crm_migrator',
          `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "proxima_acao_em"${extraColunas})
           VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${etapaId}, now() - interval '1 day'${extraValores})`
        );
        expect(resultado.status, `insert em "${nome}" com próxima ação no passado deveria falhar`).not.toBe(0);
        expect(resultado.stderr).toMatch(/oportunidades_acompanhamento_exige_proxima_acao/);
      });
    }

    test('etapa "Follow de longo prazo" com próxima ação futura é aceita @spec:AC-023', () => {
      const id = proximoUuid();
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "proxima_acao_em")
         VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${ETAPA_FOLLOW}, now() + interval '1 day')`
      );
      expect(resultado.status, `insert com próxima ação futura deveria ter sucesso: ${resultado.stderr}`).toBe(0);
    });
  });

  describe('AC-024: sequência de cadência é única e limitada por oportunidade', () => {
    test('duas atividades com a mesma sequência para a mesma oportunidade violam UNIQUE @spec:AC-024', () => {
      const primeira = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
         VALUES ('${proximoUuid()}', '${OPORTUNIDADE_ANCORA_ID}', '${EMPRESA_ID}', 1, 1, 'manha', 'telefone', 'ligacao')`
      );
      expect(primeira.status, `primeira atividade de cadência deveria ter sucesso: ${primeira.stderr}`).toBe(0);

      const segunda = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
         VALUES ('${proximoUuid()}', '${OPORTUNIDADE_ANCORA_ID}', '${EMPRESA_ID}', 1, 1, 'tarde', 'whatsapp', 'mensagem')`
      );
      expect(segunda.status, 'segunda atividade com a mesma sequência deveria falhar').not.toBe(0);
      expect(segunda.stderr).toMatch(/cadencia_atividades_oportunidade_sequencia_unica/);
    });

    test.each([0, 19])('sequência fora do intervalo 1-18 (%i) é rejeitada por CHECK @spec:AC-024', (sequenciaInvalida) => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
         VALUES ('${proximoUuid()}', '${OPORTUNIDADE_ANCORA_ID}', '${EMPRESA_ID}', ${sequenciaInvalida}, 1, 'manha', 'telefone', 'ligacao')`
      );
      expect(resultado.status, `sequência ${sequenciaInvalida} deveria ser rejeitada`).not.toBe(0);
      expect(resultado.stderr).toMatch(/cadencia_atividades_sequencia_intervalo/);
    });

    test.each([0, 4])('dia fora do intervalo 1-3 (%i) é rejeitado por CHECK @spec:AC-024', (diaInvalido) => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
         VALUES ('${proximoUuid()}', '${OPORTUNIDADE_ANCORA_ID}', '${EMPRESA_ID}', 2, ${diaInvalido}, 'manha', 'telefone', 'ligacao')`
      );
      expect(resultado.status, `dia ${diaInvalido} deveria ser rejeitado`).not.toBe(0);
      expect(resultado.stderr).toMatch(/cadencia_atividades_dia_intervalo/);
    });
  });

  describe('AC-025: log de eventos é imutável para a aplicação', () => {
    const EVENTO_ID = 'bbbbbbbb-0000-0000-0000-0000000000e1';

    beforeAll(() => {
      const inserirEvento = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "oportunidade_eventos" ("id", "empresa_id", "oportunidade_id", "tipo", "ator_tipo")
         VALUES ('${EVENTO_ID}', '${EMPRESA_ID}', '${OPORTUNIDADE_ANCORA_ID}', 'teste_ac025', 'sistema')`
      );
      if (inserirEvento.status !== 0) {
        throw new Error(`Falha ao preparar evento fixture para o AC-025: ${inserirEvento.stderr}`);
      }
    });

    // `SET app.empresa_id` antes do UPDATE/DELETE satisfaz a policy de RLS
    // (que também é avaliada em UPDATE/DELETE) para isolar só a ausência de
    // privilégio de DDL/DML — sem isso, o Postgres levanta
    // "unrecognized configuration parameter" durante o planning, antes de
    // chegar no check de privilégio (ACL) que o AC-025 quer provar.
    test('crm_app tentando UPDATE em oportunidade_eventos é recusado por falta de privilégio @spec:AC-025', () => {
      const resultado = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}'; UPDATE "oportunidade_eventos" SET "tipo" = 'alterado' WHERE "id" = '${EVENTO_ID}'`
      );
      expect(resultado.status, 'UPDATE de crm_app em oportunidade_eventos deveria ser recusado').not.toBe(0);
      expect(resultado.stderr).toMatch(/permission denied/i);
    });

    test('crm_app tentando DELETE em oportunidade_eventos é recusado por falta de privilégio @spec:AC-025', () => {
      const resultado = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}'; DELETE FROM "oportunidade_eventos" WHERE "id" = '${EVENTO_ID}'`
      );
      expect(resultado.status, 'DELETE de crm_app em oportunidade_eventos deveria ser recusado').not.toBe(0);
      expect(resultado.stderr).toMatch(/permission denied/i);
    });
  });

  describe('AC-032: crm_app não executa DDL', () => {
    test('crm_app tentando CREATE TABLE é recusado por falta de privilégio @spec:AC-032', () => {
      const resultado = pg.psqlComo('crm_app', `CREATE TABLE "tabela_intrusa_${Date.now()}" ("id" int)`);
      expect(resultado.status, 'CREATE TABLE de crm_app deveria ser recusado').not.toBe(0);
      expect(resultado.stderr).toMatch(/permission denied/i);
    });

    test('crm_app tentando ALTER TABLE é recusado por falta de privilégio @spec:AC-032', () => {
      const resultado = pg.psqlComo('crm_app', `ALTER TABLE "oportunidades" ADD COLUMN "coluna_intrusa" text`);
      expect(resultado.status, 'ALTER TABLE de crm_app deveria ser recusado').not.toBe(0);
      // Postgres nega ALTER/DROP em objeto de outro dono via checagem de
      // ownership ("must be owner of ..."), não via "permission denied" —
      // ambas as mensagens provam a ausência do privilégio de DDL.
      expect(resultado.stderr).toMatch(/permission denied|must be owner/i);
    });

    test('crm_app tentando DROP TABLE é recusado por falta de privilégio @spec:AC-032', () => {
      const resultado = pg.psqlComo('crm_app', `DROP TABLE "leads"`);
      expect(resultado.status, 'DROP TABLE de crm_app deveria ser recusado').not.toBe(0);
      expect(resultado.stderr).toMatch(/permission denied|must be owner/i);
    });
  });
});
