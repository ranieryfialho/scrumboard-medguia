// T-129 (fase3-ingestao-continua): prova de AC-323 para
// `src/worker/saude.ts`. Contra Postgres real (mesmo harness de T-128)
// porque o que está sob teste é a consulta a `cron_execucoes`, não só a
// lógica de prazo.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { verificarSaudeOrigem, verificarSaudeWorker } from '../../src/worker/saude';
import { cronExecucoes } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const INTERVALO_MIN = 5;
const AGORA = new Date('2026-10-21T12:00:00Z');

function minutosAtras(minutos: number): Date {
  return new Date(AGORA.getTime() - minutos * 60_000);
}

async function inserirExecucao(
  db: NodePgDatabase,
  job: string,
  status: 'em_execucao' | 'sucesso' | 'falha',
  iniciadoEm: Date,
  concluidoEm: Date | null
) {
  await db.insert(cronExecucoes).values({ job, status, iniciadoEm, concluidoEm });
}

describe('T-129: verificação de saúde do worker contra Postgres real', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(cronExecucoes);
  });

  test(
    'diz "saudável" se houve sucesso dentro de duas vezes o intervalo (@spec:AC-323)',
    async () => {
      const job = 'import-sheets-323-ok';
      await inserirExecucao(db, job, 'sucesso', minutosAtras(9), minutosAtras(8));

      const origem = await verificarSaudeOrigem(db, job, INTERVALO_MIN, AGORA);
      expect(origem).toMatchObject({ job, status: 'saudavel', ultimoStatus: 'sucesso' });
    }
  );

  test(
    'diz "doente" se a última tentativa falhou, mesmo com sucesso antigo dentro do prazo (@spec:AC-323)',
    async () => {
      const job = 'import-lp-323-ultima-falhou';
      await inserirExecucao(db, job, 'sucesso', minutosAtras(9), minutosAtras(8));
      await inserirExecucao(db, job, 'falha', minutosAtras(2), minutosAtras(1));

      const origem = await verificarSaudeOrigem(db, job, INTERVALO_MIN, AGORA);
      expect(origem).toMatchObject({ job, status: 'doente', ultimoStatus: 'falha' });
    }
  );

  test(
    'diz "doente" se o último sucesso passou do prazo de duas vezes o intervalo (@spec:AC-323)',
    async () => {
      const job = 'import-sheets-323-atrasado';
      await inserirExecucao(db, job, 'sucesso', minutosAtras(30), minutosAtras(29));

      const origem = await verificarSaudeOrigem(db, job, INTERVALO_MIN, AGORA);
      expect(origem.status).toBe('doente');
      expect(origem.ultimoSucessoEm).toBeUndefined();
    }
  );

  test(
    'diz "doente" quando a origem nunca teve nenhuma execução registrada (@spec:AC-323)',
    async () => {
      const origem = await verificarSaudeOrigem(db, 'import-lp-323-sem-historico', INTERVALO_MIN, AGORA);
      expect(origem).toMatchObject({ status: 'doente', ultimoStatus: undefined });
    }
  );

  test(
    'o worker inteiro só é "saudável" se TODAS as origens estiverem em dia (@spec:AC-323)',
    async () => {
      await inserirExecucao(db, 'import-sheets-323-geral', 'sucesso', minutosAtras(9), minutosAtras(8));
      await inserirExecucao(db, 'import-lp-323-geral', 'falha', minutosAtras(2), minutosAtras(1));

      const resultado = await verificarSaudeWorker(
        db,
        ['import-sheets-323-geral', 'import-lp-323-geral'],
        INTERVALO_MIN,
        AGORA
      );

      expect(resultado.status).toBe('doente');
      expect(resultado.origens).toHaveLength(2);
      expect(resultado.origens.find((o) => o.job === 'import-sheets-323-geral')?.status).toBe(
        'saudavel'
      );
      expect(resultado.origens.find((o) => o.job === 'import-lp-323-geral')?.status).toBe('doente');
    }
  );

  test(
    'o worker fica "saudável" quando todas as origens têm sucesso recente (@spec:AC-323)',
    async () => {
      await inserirExecucao(db, 'import-sheets-323-ambos', 'sucesso', minutosAtras(9), minutosAtras(8));
      await inserirExecucao(db, 'import-lp-323-ambos', 'sucesso', minutosAtras(4), minutosAtras(3));

      const resultado = await verificarSaudeWorker(
        db,
        ['import-sheets-323-ambos', 'import-lp-323-ambos'],
        INTERVALO_MIN,
        AGORA
      );

      expect(resultado.status).toBe('saudavel');
    }
  );
});
