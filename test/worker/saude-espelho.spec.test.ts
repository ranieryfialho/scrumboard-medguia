// T-137 (fase3-espelho-sheets, US-096): prova de AC-338 para
// `src/worker/saude.ts`. Contra Postgres real (mesmo harness de T-129)
// porque o que está sob teste é a consulta a `cron_execucoes`.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  JOB_ESPELHO_SHEETS,
  verificarSaudeEspelho,
  verificarSaudeWorker,
} from '../../src/worker/saude';
import { cronExecucoes } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const AGORA = new Date('2026-10-22T12:00:00Z');

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

describe('T-137: saúde do worker acusa espelho atrasado', () => {
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
    'diz "doente" quando a última execução bem-sucedida do espelho tem mais de 45 min (@spec:AC-338)',
    async () => {
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'sucesso', minutosAtras(50), minutosAtras(46));

      const origem = await verificarSaudeEspelho(db, AGORA);

      expect(origem).toMatchObject({ job: JOB_ESPELHO_SHEETS, status: 'doente' });
      expect(origem.ultimoSucessoEm).toBeUndefined();
    }
  );

  test(
    'diz "doente" quando nunca houve execução do espelho (@spec:AC-338)',
    async () => {
      const origem = await verificarSaudeEspelho(db, AGORA);

      expect(origem).toMatchObject({ job: JOB_ESPELHO_SHEETS, status: 'doente' });
    }
  );

  test(
    'não reclama do espelho com sucesso há menos de 45 min (@spec:AC-338)',
    async () => {
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'sucesso', minutosAtras(40), minutosAtras(30));

      const origem = await verificarSaudeEspelho(db, AGORA);

      expect(origem).toMatchObject({ job: JOB_ESPELHO_SHEETS, status: 'saudavel' });
      expect(origem.ultimoSucessoEm).toEqual(minutosAtras(30));
    }
  );

  test(
    'ignora a última tentativa falhada do espelho: só o último sucesso dentro do prazo importa (@spec:AC-338)',
    async () => {
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'sucesso', minutosAtras(20), minutosAtras(19));
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'falha', minutosAtras(5), minutosAtras(4));

      const origem = await verificarSaudeEspelho(db, AGORA);

      expect(origem.status).toBe('saudavel');
    }
  );

  test(
    'o worker inteiro fica "doente" se só o espelho estiver atrasado, mesmo com importação saudável (@spec:AC-338)',
    async () => {
      await inserirExecucao(db, 'import-sheets-338', 'sucesso', minutosAtras(9), minutosAtras(8));
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'sucesso', minutosAtras(60), minutosAtras(50));

      const resultado = await verificarSaudeWorker(
        db,
        ['import-sheets-338', JOB_ESPELHO_SHEETS],
        5,
        AGORA
      );

      expect(resultado.status).toBe('doente');
      expect(resultado.origens.find((o) => o.job === JOB_ESPELHO_SHEETS)?.status).toBe('doente');
      expect(resultado.origens.find((o) => o.job === 'import-sheets-338')?.status).toBe('saudavel');
    }
  );

  test(
    'o worker fica "saudável" com o espelho em dia dentro do prazo fixo de 45 min, mesmo com intervalo de importação pequeno (@spec:AC-338)',
    async () => {
      await inserirExecucao(db, JOB_ESPELHO_SHEETS, 'sucesso', minutosAtras(30), minutosAtras(20));

      const resultado = await verificarSaudeWorker(db, [JOB_ESPELHO_SHEETS], 5, AGORA);

      expect(resultado.status).toBe('saudavel');
    }
  );
});
