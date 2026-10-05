// T-060 (fase2c-sse, US-037): prova, contra um Postgres 15 efêmero real (o
// mesmo harness de test/db/funcoes.test.ts) com a migration 0007 aplicada,
// que `mover_oportunidade` emite `pg_notify('oportunidade', ...)` com o
// contrato do TDD (AC-108), que não emite nada quando a transição é
// recusada (AC-110), e que a notificação só é entregue depois do commit —
// nunca depois de um rollback (AC-111).
//
// `psqlComo` (docker exec + psql síncrono) não serve para este teste: ele
// roda um `-c` por chamada e não há como manter uma sessão ouvindo
// `LISTEN` enquanto outra sessão faz BEGIN/.../COMMIT|ROLLBACK no meio. Por
// isso aqui usamos o driver `pg` direto contra a porta publicada do
// container (`pg.appUrl`), com uma conexão dedicada a `LISTEN oportunidade`
// e conexões avulsas para cada transação de teste.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;

const EMPRESA_ID = 'cccccccc-0000-0000-0000-000000000001';
const LEAD_ID = 'cccccccc-0000-0000-0000-000000000002';
const ATOR_ID = 'cccccccc-0000-0000-0000-000000000003';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `cccccccc-0000-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

interface Notificacao {
  channel: string;
  payload: string;
}

describe('T-060: NOTIFY dentro de mover_oportunidade', () => {
  let pg: PostgresEfemero;
  let ouvinte: Client;
  let notificacoes: Notificacao[];

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA_ID}', 'Empresa Teste SSE', 'empresa-teste-sse');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD_ID}', '${EMPRESA_ID}', 'Lead Teste SSE');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${ATOR_ID}', 'ator-sse@teste.local', 'Ator Teste SSE');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de NOTIFY: ${setup.stderr}`);
    }

    ouvinte = new Client({ connectionString: pg.appUrl });
    await ouvinte.connect();
    ouvinte.on('notification', (msg) => {
      notificacoes.push({ channel: msg.channel, payload: msg.payload ?? '' });
    });
    await ouvinte.query('LISTEN oportunidade');
  }, 120_000);

  afterAll(async () => {
    await ouvinte?.end();
    pg?.parar();
  });

  beforeEach(() => {
    notificacoes = [];
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

  async function aguardarNotificacoes(ms = 500): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function abrirSessaoApp(): Promise<Client> {
    const cliente = new Client({ connectionString: pg.appUrl });
    await cliente.connect();
    await cliente.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
    return cliente;
  }

  describe('AC-108: mover um card emite oportunidade.movida com o contrato do TDD', () => {
    test('commit entrega exatamente um evento com empresaId/oportunidadeId/etapaOrigemId/etapaDestinoId/atorId/ocorridoEm reais @spec:AC-108', async () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);

      const sessao = await abrirSessaoApp();
      try {
        await sessao.query('BEGIN');
        await sessao.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
        await sessao.query(
          `SELECT mover_oportunidade($1, 1, $2, $3, 'usuario', NULL)`,
          [oportunidadeId, ETAPA_1_DIA, ATOR_ID]
        );
        await sessao.query('COMMIT');
      } finally {
        await sessao.end();
      }

      await aguardarNotificacoes();

      expect(notificacoes).toHaveLength(1);
      expect(notificacoes[0].channel).toBe('oportunidade');

      const payload = JSON.parse(notificacoes[0].payload) as Record<string, unknown>;
      expect(payload.empresaId).toBe(EMPRESA_ID);
      expect(payload.oportunidadeId).toBe(oportunidadeId);
      expect(payload.etapaOrigemId).toBe(ETAPA_ENTRADA);
      expect(payload.etapaDestinoId).toBe(ETAPA_1_DIA);
      expect(payload.atorId).toBe(ATOR_ID);
      expect(payload.ocorridoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('AC-110: transição recusada não emite evento', () => {
    test('CONFLITO_DE_VERSAO (version desatualizada) não gera notificação, nem antes nem depois do rollback @spec:AC-110', async () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);

      const sessao = await abrirSessaoApp();
      try {
        await sessao.query('BEGIN');
        await sessao.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
        await expect(
          sessao.query(`SELECT mover_oportunidade($1, 99, $2, $3, 'usuario', NULL)`, [
            oportunidadeId,
            ETAPA_1_DIA,
            ATOR_ID,
          ])
        ).rejects.toThrow(/CONFLITO_DE_VERSAO/);
        await sessao.query('ROLLBACK');
      } finally {
        await sessao.end();
      }

      await aguardarNotificacoes();
      expect(notificacoes).toHaveLength(0);
    });
  });

  describe('AC-111: o evento nasce na mesma transação da escrita', () => {
    test('rollback depois de chamar mover_oportunidade não entrega notificação; só o commit entrega @spec:AC-111', async () => {
      const oportunidadeId = criarOportunidade(ETAPA_ENTRADA);

      const sessaoRollback = await abrirSessaoApp();
      try {
        await sessaoRollback.query('BEGIN');
        await sessaoRollback.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
        await sessaoRollback.query(
          `SELECT mover_oportunidade($1, 1, $2, $3, 'usuario', NULL)`,
          [oportunidadeId, ETAPA_1_DIA, ATOR_ID]
        );
        await sessaoRollback.query('ROLLBACK');
      } finally {
        await sessaoRollback.end();
      }

      await aguardarNotificacoes();
      expect(notificacoes, 'rollback não deveria entregar notificação').toHaveLength(0);

      const sessaoCommit = await abrirSessaoApp();
      try {
        await sessaoCommit.query('BEGIN');
        await sessaoCommit.query(`SET app.empresa_id = '${EMPRESA_ID}'`);
        await sessaoCommit.query(
          `SELECT mover_oportunidade($1, 1, $2, $3, 'usuario', NULL)`,
          [oportunidadeId, ETAPA_1_DIA, ATOR_ID]
        );
        await sessaoCommit.query('COMMIT');
      } finally {
        await sessaoCommit.end();
      }

      await aguardarNotificacoes();
      expect(notificacoes, 'commit deveria entregar exatamente uma notificação').toHaveLength(1);
    });
  });
});
