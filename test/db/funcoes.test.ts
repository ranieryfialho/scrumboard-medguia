// Testes de T-024 (fase1-schema-drizzle, US-011): prova, contra um Postgres 15
// efêmero real (harness de T-020) com as migrations de T-017/T-018 aplicadas,
// que `mover_oportunidade` grava etapa+evento atomicamente com lock otimista
// por `version` (AC-026, AC-027) e que `concluir_atividade` grava o
// resultado do toque e o efeito em cadeia atomicamente (AC-028). As duas
// funções rodam sem SECURITY DEFINER, então os testes chamam como `crm_app`
// com `SET app.empresa_id` — o mesmo caminho da aplicação em produção.
//
// T-043 (fase2-kanban, US-031) estende esses testes: `mover_oportunidade`
// (0006_fn_mover_oportunidade_guards) ganhou 3 parâmetros novos (`p_valor`,
// `p_motivo_perda_id`, `p_proxima_acao_em`) que gravam os dados de guard da
// etapa de destino na mesma linha/transação da transição (AC-082).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;

const EMPRESA_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `bbbbbbbb-0000-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

describe('T-024: funções SQL transacionais', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste Funcoes', 'empresa-teste-funcoes');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de funções: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  function criarOportunidade(etapaId: number): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${EMPRESA_ID}', '${LEAD_ID}', ${etapaId})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  describe('AC-026: mover_oportunidade grava estado e evento juntos, ou nenhum dos dois', () => {
    test('etapa avança, version incrementa e o evento de transição é gravado na mesma chamada @spec:AC-026', () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);

      const mover = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT mover_oportunidade('${oportunidadeId}', 1, ${ETAPA_1_DIA}, NULL, 'sistema', NULL)`
      );
      expect(mover.status, `mover_oportunidade deveria ter sucesso: ${mover.stderr}`).toBe(0);

      const estado = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${oportunidadeId}'`
      );
      expect(estado.status).toBe(0);
      expect(estado.stdout.trim()).toBe(`${ETAPA_1_DIA}|2`);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos"
         WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'transicao_etapa'
           AND "etapa_origem_id" = ${ETAPA_ENTRADA} AND "etapa_destino_id" = ${ETAPA_1_DIA}`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim()).toBe('1');
    });
  });

  describe('AC-082: mover_oportunidade grava valor/motivo_perda/proxima_acao junto com a etapa, atomicamente', () => {
    test('valor e proxima_acao_em enviados na transição ficam gravados na mesma linha, junto com etapa/version/evento @spec:AC-082', () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);
      const proximaAcaoEm = '2026-10-01T12:00:00+00:00';

      const mover = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT mover_oportunidade('${oportunidadeId}', 1, ${ETAPA_1_DIA}, NULL, 'sistema', NULL, 1500.50, NULL, '${proximaAcaoEm}')`
      );
      expect(mover.status, `mover_oportunidade deveria ter sucesso: ${mover.stderr}`).toBe(0);

      const estado = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version", "valor", "proxima_acao_em" FROM "oportunidades" WHERE "id" = '${oportunidadeId}'`
      );
      expect(estado.status).toBe(0);
      expect(estado.stdout.trim()).toBe(`${ETAPA_1_DIA}|2|1500.50|2026-10-01 12:00:00+00`);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos"
         WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'transicao_etapa'
           AND "etapa_origem_id" = ${ETAPA_ENTRADA} AND "etapa_destino_id" = ${ETAPA_1_DIA}`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim()).toBe('1');
    });

    test('motivo_perda_id enviado é gravado, e valor/proxima_acao_em ausentes preservam o que já estava na linha @spec:AC-082', () => {
      const motivoId = proximoUuid();
      const criarMotivo = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO "motivos_perda" ("id", "nome") VALUES ('${motivoId}', 'Motivo Teste ${motivoId}')`
      );
      if (criarMotivo.status !== 0) {
        throw new Error(`Falha ao criar motivo_perda fixture: ${criarMotivo.stderr}`);
      }

      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);
      const preExistente = pg.psqlComo(
        'crm_migrator',
        `UPDATE "oportunidades" SET "valor" = 999.00 WHERE "id" = '${oportunidadeId}'`
      );
      if (preExistente.status !== 0) {
        throw new Error(`Falha ao preparar valor existente na fixture: ${preExistente.stderr}`);
      }

      const mover = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT mover_oportunidade('${oportunidadeId}', 1, ${ETAPA_1_DIA}, NULL, 'sistema', NULL, NULL, '${motivoId}', NULL)`
      );
      expect(mover.status, `mover_oportunidade deveria ter sucesso: ${mover.stderr}`).toBe(0);

      const estado = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version", "valor", "motivo_perda_id" FROM "oportunidades" WHERE "id" = '${oportunidadeId}'`
      );
      expect(estado.status).toBe(0);
      expect(
        estado.stdout.trim(),
        'valor pré-existente deveria ser preservado (não enviado nesta chamada)'
      ).toBe(`${ETAPA_1_DIA}|2|999.00|${motivoId}`);
    });
  });

  describe('AC-027: escrita com versão desatualizada é rejeitada (lock otimista)', () => {
    test('version diferente da atual é recusada sem alterar etapa, evento ou version @spec:AC-027', () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);

      const mover = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT mover_oportunidade('${oportunidadeId}', 99, ${ETAPA_1_DIA}, NULL, 'sistema', NULL)`
      );
      expect(mover.status, 'mover_oportunidade com version desatualizada deveria falhar').not.toBe(0);
      expect(mover.stderr).toMatch(/CONFLITO_DE_VERSAO/);

      const estado = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${oportunidadeId}'`
      );
      expect(estado.status).toBe(0);
      expect(estado.stdout.trim(), 'etapa e version não deveriam ter mudado').toBe(`${ETAPA_ENTRADA}|1`);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}'`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim(), 'nenhum evento deveria ter sido gravado').toBe('0');
    });
  });

  function criarAtividadePendente(oportunidadeId: string, sequencia: number): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "cadencia_atividades" ("id", "oportunidade_id", "empresa_id", "sequencia", "dia", "turno", "canal", "tipo")
       VALUES ('${id}', '${oportunidadeId}', '${EMPRESA_ID}', ${sequencia}, 1, 'manha', 'telefone', 'ligacao')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar atividade de cadência fixture: ${resultado.stderr}`);
    }
    return id;
  }

  describe('AC-028: concluir_atividade grava o resultado do toque e o efeito em cadeia, atomicamente', () => {
    test('resultado "conectou" cancela as demais atividades pendentes e grava o evento de conexão @spec:AC-028', () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);
      const atividadeConectou = criarAtividadePendente(oportunidadeId, 1);
      const atividadeDemais1 = criarAtividadePendente(oportunidadeId, 2);
      const atividadeDemais2 = criarAtividadePendente(oportunidadeId, 3);

      const concluir = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT concluir_atividade('${atividadeConectou}', 'conectou', NULL, 'sistema', NULL)`
      );
      expect(concluir.status, `concluir_atividade deveria ter sucesso: ${concluir.stderr}`).toBe(0);

      const resultados = pg.psqlComo(
        'crm_migrator',
        `SELECT "id", "resultado" FROM "cadencia_atividades" WHERE "oportunidade_id" = '${oportunidadeId}' ORDER BY "sequencia"`
      );
      expect(resultados.status).toBe(0);
      expect(resultados.stdout.trim()).toBe(
        [
          `${atividadeConectou}|conectou`,
          `${atividadeDemais1}|cancelada`,
          `${atividadeDemais2}|cancelada`,
        ].join('\n')
      );

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'cadencia_conectou'`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim()).toBe('1');
    });

    test('resultado "sem_resposta" grava só a própria atividade, sem tocar nas demais nem deixar estado parcial @spec:AC-028', () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);
      const atividadeAlvo = criarAtividadePendente(oportunidadeId, 1);
      const atividadeIntacta = criarAtividadePendente(oportunidadeId, 2);

      const concluir = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_ID}';
         SELECT concluir_atividade('${atividadeAlvo}', 'sem_resposta', NULL, 'sistema', NULL)`
      );
      expect(concluir.status, `concluir_atividade deveria ter sucesso: ${concluir.stderr}`).toBe(0);

      const resultados = pg.psqlComo(
        'crm_migrator',
        `SELECT "id", "resultado" FROM "cadencia_atividades" WHERE "oportunidade_id" = '${oportunidadeId}' ORDER BY "sequencia"`
      );
      expect(resultados.status).toBe(0);
      expect(resultados.stdout.trim()).toBe(
        [`${atividadeAlvo}|sem_resposta`, `${atividadeIntacta}|pendente`].join('\n')
      );

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${oportunidadeId}' AND "tipo" = 'cadencia_sem_resposta'`
      );
      expect(evento.status).toBe(0);
      expect(evento.stdout.trim()).toBe('1');
    });
  });
});
