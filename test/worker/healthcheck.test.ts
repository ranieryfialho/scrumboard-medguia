// T-283 (fase3-ingestao-continua, AC-323, AC-732): o healthcheck do worker EXECUTADO de verdade, contra Postgres real. O teste
// antigo só conferia o texto do comando no compose, e por isso o script quebrado nunca foi pego.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { cronExecucoes } from '../../src/db/schema';
import { executarHealthcheckWorker, origensParaSaude } from '../../src/worker/healthcheck';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const AGORA = new Date('2026-11-03T12:00:00Z');
const SEM_LP = { intervaloImportacaoMin: 1 };
const COM_LP = { intervaloImportacaoMin: 1, supabaseLpUrl: 'https://lp.example.com', supabaseLpServiceKey: 'chave' };
const segundosAtras = (s: number) => new Date(AGORA.getTime() - s * 1000);

describe('T-283: healthcheck do worker executado de verdade', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  const execucao = (job: string, status: 'sucesso' | 'falha', concluidoHaSegundos: number) =>
    db.insert(cronExecucoes).values({ job, status, iniciadoEm: segundosAtras(concluidoHaSegundos + 2), concluidoEm: segundosAtras(concluidoHaSegundos) });

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

  test('a LP só entra na conta de saúde quando está configurada (@spec:AC-732)', () => {
    expect(origensParaSaude(SEM_LP)).toEqual(['import-sheets']);
    expect(origensParaSaude(COM_LP)).toEqual(['import-sheets', 'import-lp']);
  });

  test('sai com 0 quando o Sheets teve sucesso dentro do prazo, e traz o resultado por origem (@spec:AC-732)', async () => {
    await execucao('import-sheets', 'sucesso', 30);
    const { codigo, resultado } = await executarHealthcheckWorker(db, SEM_LP, AGORA);
    expect(codigo).toBe(0);
    expect(resultado.origens).toMatchObject([{ job: 'import-sheets', status: 'saudavel' }]);
  });

  test('sai com 1 sem nenhuma execução, ou com o último sucesso fora do prazo de 2 intervalos (@spec:AC-732)', async () => {
    expect((await executarHealthcheckWorker(db, SEM_LP, AGORA)).codigo).toBe(1);
    await execucao('import-sheets', 'sucesso', 600);
    expect((await executarHealthcheckWorker(db, SEM_LP, AGORA)).codigo).toBe(1);
  });

  test('a falha da LP derruba a saúde só quando a LP está configurada (@spec:AC-732)', async () => {
    await execucao('import-sheets', 'sucesso', 30);
    await execucao('import-lp', 'falha', 20);
    expect((await executarHealthcheckWorker(db, COM_LP, AGORA)).codigo).toBe(1);
    expect((await executarHealthcheckWorker(db, SEM_LP, AGORA)).codigo).toBe(0);
  });
});
