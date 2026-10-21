// T-128 (fase3-ingestao-continua): prova de AC-318, AC-319, AC-321,
// AC-322, AC-324 e AC-325 para `src/worker/ciclo.ts`. Contra Postgres real
// (mesmo harness de T-108/T-120/T-123) porque a trava consultiva
// (`pg_try_advisory_lock`, AC-324/AC-325) só se prova com sessões de
// verdade — um mock não prova exclusão mútua entre conexões.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  rodarCicloImportacao,
  rodarCiclosImportacao,
  type ResultadoImportacao,
} from '../../src/worker/ciclo';
import { cronExecucoes, importacoes } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

function criarDeferred<T>() {
  let resolve!: (valor: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function esperarAte(condicao: () => boolean, timeoutMs = 5000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('Timeout esperando condição no teste.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('T-128: ciclo de importação contra Postgres real', () => {
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
    await db.delete(importacoes);
    await db.delete(cronExecucoes);
  });

  test(
    'um lead novo vira card no próximo ciclo — o ciclo repassa lidos/criados/ignorados do executor (@spec:AC-318)',
    async () => {
      const resultado = await rodarCicloImportacao(pool, db, 'import-sheets-318', async () => ({
        linhasLidas: 1,
        linhasCriadas: 1,
        linhasIgnoradas: 0,
      }));

      expect(resultado).toMatchObject({
        job: 'import-sheets-318',
        status: 'sucesso',
        linhasLidas: 1,
        linhasCriadas: 1,
        linhasIgnoradas: 0,
      });
    }
  );

  test(
    'repetir o ciclo sem cadastro novo não duplica ninguém — criados fica em zero na segunda vez (@spec:AC-319)',
    async () => {
      const job = 'import-sheets-319';
      const executorComLead: ResultadoImportacao = { linhasLidas: 1, linhasCriadas: 1, linhasIgnoradas: 0 };
      const executorSemNovidade: ResultadoImportacao = { linhasLidas: 1, linhasCriadas: 0, linhasIgnoradas: 1 };

      const primeira = await rodarCicloImportacao(pool, db, job, async () => executorComLead);
      expect(primeira.linhasCriadas).toBe(1);

      const segunda = await rodarCicloImportacao(pool, db, job, async () => executorSemNovidade);
      expect(segunda).toMatchObject({ status: 'sucesso', linhasCriadas: 0, linhasIgnoradas: 1 });

      const execucoes = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, job));
      expect(execucoes).toHaveLength(2);
    }
  );

  test('cada execução fica registrada com início, fim e resultado (@spec:AC-321)', async () => {
    const job = 'import-sheets-321';
    const resultado = await rodarCicloImportacao(pool, db, job, async () => ({
      linhasLidas: 10,
      linhasCriadas: 4,
      linhasIgnoradas: 6,
    }));
    expect(resultado.status).toBe('sucesso');

    const [linha] = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, job));
    expect(linha.status).toBe('sucesso');
    expect(linha.iniciadoEm).toBeInstanceOf(Date);
    expect(linha.concluidoEm).toBeInstanceOf(Date);
    expect(linha.itensProcessados).toBe(10);

    const [importacao] = await db.select().from(importacoes).where(eq(importacoes.origem, job));
    expect(importacao).toMatchObject({ linhasLidas: 10, linhasCriadas: 4, linhasIgnoradas: 6 });
  });

  test('em caso de erro, a linha guarda o texto do erro sem chaves nem senhas (@spec:AC-321)', async () => {
    const job = 'import-lp-321-erro';
    const erroComCredencial = new Error(
      'falha ao conectar em postgres://crm_app:segredo123@db:5432/crm_prod'
    );

    const resultado = await rodarCicloImportacao(pool, db, job, async () => {
      throw erroComCredencial;
    });

    expect(resultado.status).toBe('falha');
    expect(resultado.erro).toBeDefined();
    expect(resultado.erro).not.toContain('segredo123');

    const [linha] = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, job));
    expect(linha.status).toBe('falha');
    expect(linha.erro).not.toBeNull();
    expect(linha.erro).not.toContain('segredo123');
    expect(linha.concluidoEm).toBeInstanceOf(Date);

    const semImportacao = await db.select().from(importacoes).where(eq(importacoes.origem, job));
    expect(semImportacao).toHaveLength(0);
  });

  test(
    'uma origem fora do ar não derruba o worker nem a outra origem (@spec:AC-322)',
    async () => {
      const resultados = await rodarCiclosImportacao(pool, db, [
        {
          job: 'import-lp-322',
          executarImportacao: async () => {
            throw new Error('ECONNREFUSED: lp fora do ar');
          },
        },
        {
          job: 'import-sheets-322',
          executarImportacao: async () => ({ linhasLidas: 4, linhasCriadas: 1, linhasIgnoradas: 3 }),
        },
      ]);

      const lp = resultados.find((resultado) => resultado.job === 'import-lp-322');
      const sheets = resultados.find((resultado) => resultado.job === 'import-sheets-322');

      expect(lp?.status).toBe('falha');
      expect(lp?.erro).toContain('fora do ar');
      expect(sheets).toMatchObject({ status: 'sucesso', linhasCriadas: 1 });
    }
  );

  test(
    'ciclo atrasado não começa por cima do anterior ainda em andamento (@spec:AC-324)',
    async () => {
      const job = 'import-sheets-324';
      let lockAdquirido = false;
      const deferred = criarDeferred<ResultadoImportacao>();

      const primeiro = rodarCicloImportacao(pool, db, job, async () => {
        lockAdquirido = true;
        return deferred.promise;
      });

      await esperarAte(() => lockAdquirido);

      const segundo = await rodarCicloImportacao(pool, db, job, async () => ({
        linhasLidas: 99,
        linhasCriadas: 99,
        linhasIgnoradas: 0,
      }));
      expect(segundo.status).toBe('pulado');

      deferred.resolve({ linhasLidas: 2, linhasCriadas: 1, linhasIgnoradas: 1 });
      const resultadoPrimeiro = await primeiro;
      expect(resultadoPrimeiro.status).toBe('sucesso');

      const execucoes = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, job));
      expect(execucoes).toHaveLength(1);
      expect(execucoes[0].itensProcessados).toBe(2);
    }
  );

  test(
    'dois workers não importam a mesma origem juntos — só um importa, o outro desiste sem erro (@spec:AC-325)',
    async () => {
      const job = 'import-lp-325';
      const poolSegundoWorker = new Pool({ connectionString: pg.migratorUrl });

      try {
        let lockAdquirido = false;
        const deferred = criarDeferred<ResultadoImportacao>();

        const primeiro = rodarCicloImportacao(pool, db, job, async () => {
          lockAdquirido = true;
          return deferred.promise;
        });

        await esperarAte(() => lockAdquirido);

        const segundo = await rodarCicloImportacao(poolSegundoWorker, db, job, async () => ({
          linhasLidas: 5,
          linhasCriadas: 5,
          linhasIgnoradas: 0,
        }));
        expect(segundo.status).toBe('pulado');
        expect(segundo.erro).toBeUndefined();

        deferred.resolve({ linhasLidas: 3, linhasCriadas: 2, linhasIgnoradas: 1 });
        const resultadoPrimeiro = await primeiro;
        expect(resultadoPrimeiro.status).toBe('sucesso');

        const execucoes = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, job));
        expect(execucoes).toHaveLength(1);
      } finally {
        await poolSegundoWorker.end();
      }
    }
  );
});
