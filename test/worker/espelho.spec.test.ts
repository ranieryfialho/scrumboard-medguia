// T-136 (fase3-espelho-sheets, US-096): prova de AC-336, AC-337 e AC-339
// para a ligação do job `espelho-sheets` no `crm-worker`
// (`src/worker/config.ts` + `src/worker/index.ts`). Contra Postgres real
// (mesmo harness de T-128/ciclo.spec.test.ts) para `cron_execucoes` e a
// trava advisory — o Sheets em si é um dublê injetado em
// `construirCicloEspelho`, igual ao padrão de T-134 (`gravar.spec.test.ts`).
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  carregarConfiguracaoWorker,
  INTERVALO_ESPELHO_MIN_PADRAO,
  INTERVALO_IMPORT_MIN_PADRAO,
} from '../../src/worker/config';
import { construirCicloEspelho, montarAgendadores } from '../../src/worker/index';
import { rodarCicloImportacao } from '../../src/worker/ciclo';
import { cronExecucoes } from '../../src/db/schema';
import type { CardEspelho } from '../../src/espelho/linhas';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ENV_COMPLETO: Record<string, string> = {
  DATABASE_URL: 'postgres://user:senha@host:5432/db',
  SUPABASE_LP_URL: 'https://lp.example.com',
  SUPABASE_LP_SERVICE_KEY: 'chave-secreta-lp',
  GOOGLE_CLIENT_EMAIL: 'conta@servico.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  GOOGLE_SHEET_ID_1: 'planilha-1',
  GOOGLE_SHEET_ID_2: 'planilha-2',
  GOOGLE_SHEET_ID_3: 'planilha-3',
};

const CARD_FALSO: CardEspelho = {
  nome: 'Lead de teste',
  telefone: '+5511999999999',
  email: 'lead@example.com',
  etapa: 'Entrada de leads',
  responsavel: null,
  valor: null,
  motivoPerda: null,
  criadoEm: new Date('2026-10-22T10:00:00Z'),
  atualizadoEm: new Date('2026-10-22T10:00:00Z'),
  cadencia: null,
};

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

describe('T-136: config do intervalo do espelho (WORKER_INTERVALO_ESPELHO_MIN)', () => {
  test('sem a variável, o espelho usa o padrão de 15 min, independente do intervalo de importação (@spec:AC-337)', () => {
    const config = carregarConfiguracaoWorker({ ...ENV_COMPLETO });
    expect(config.intervaloEspelhoMin).toBe(INTERVALO_ESPELHO_MIN_PADRAO);
    expect(config.intervaloEspelhoMin).toBe(15);
    expect(config.intervaloImportacaoMin).toBe(INTERVALO_IMPORT_MIN_PADRAO);
  });

  test('com WORKER_INTERVALO_ESPELHO_MIN configurado, o espelho usa esse valor sem afetar o das importações (@spec:AC-337)', () => {
    const config = carregarConfiguracaoWorker({
      ...ENV_COMPLETO,
      WORKER_INTERVALO_ESPELHO_MIN: '30',
      WORKER_INTERVALO_IMPORT_MIN: '5',
    });
    expect(config.intervaloEspelhoMin).toBe(30);
    expect(config.intervaloImportacaoMin).toBe(5);
  });

  test('com WORKER_INTERVALO_ESPELHO_MIN inválido, cai no padrão em vez de travar a subida (@spec:AC-337)', () => {
    const config = carregarConfiguracaoWorker({
      ...ENV_COMPLETO,
      WORKER_INTERVALO_ESPELHO_MIN: 'não-é-numero',
    });
    expect(config.intervaloEspelhoMin).toBe(INTERVALO_ESPELHO_MIN_PADRAO);
  });
});

describe('T-136: montarAgendadores separa o relógio do espelho do das importações', () => {
  test('o espelho tem seu próprio intervalo em ms, diferente do das importações (@spec:AC-337)', () => {
    const config = carregarConfiguracaoWorker({
      ...ENV_COMPLETO,
      WORKER_INTERVALO_ESPELHO_MIN: '15',
      WORKER_INTERVALO_IMPORT_MIN: '5',
    });
    const poolFalso = {} as Pool;
    const dbFalso = {} as NodePgDatabase;

    const { importacao, espelho } = montarAgendadores(poolFalso, dbFalso, config, ENV_COMPLETO);

    expect(espelho.intervaloMs).toBe(15 * 60_000);
    expect(importacao.intervaloMs).toBe(5 * 60_000);
    expect(espelho.intervaloMs).not.toBe(importacao.intervaloMs);
  });
});

describe('T-136: ciclo do espelho (construirCicloEspelho) contra Postgres real', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let config: ReturnType<typeof carregarConfiguracaoWorker>;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    config = carregarConfiguracaoWorker({ ...ENV_COMPLETO });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(cronExecucoes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test(
    'ao rodar com sucesso, fica uma linha em cron_execucoes para "espelho-sheets" com início, fim, status e a quantidade de cards gravados (@spec:AC-336)',
    async () => {
      const gravar = vi.fn(async () => {});
      const ciclo = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => [CARD_FALSO, CARD_FALSO, CARD_FALSO],
        gravar,
      });

      const resultado = await rodarCicloImportacao(pool, db, ciclo.job, ciclo.executarImportacao);
      expect(resultado.status).toBe('sucesso');
      expect(gravar).toHaveBeenCalledTimes(1);

      const [linha] = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, 'espelho-sheets'));
      expect(linha.job).toBe('espelho-sheets');
      expect(linha.status).toBe('sucesso');
      expect(linha.iniciadoEm).toBeInstanceOf(Date);
      expect(linha.concluidoEm).toBeInstanceOf(Date);
      expect(linha.itensProcessados).toBe(3);
      expect(linha.erro).toBeNull();
    }
  );

  test(
    'a leitura do banco acontece antes de qualquer chamada ao Sheets (consulta antes de gravar) (@spec:AC-339)',
    async () => {
      const ordem: string[] = [];
      const ciclo = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => {
          ordem.push('consulta');
          return [CARD_FALSO];
        },
        gravar: async () => {
          ordem.push('grava');
        },
      });

      await rodarCicloImportacao(pool, db, ciclo.job, ciclo.executarImportacao);
      expect(ordem).toEqual(['consulta', 'grava']);
    }
  );

  test(
    'quando o Sheets falha (fora do ar ou sem permissão), a execução termina como falha registrada, sem lançar erro para quem chamou nem derrubar o worker (@spec:AC-339)',
    async () => {
      const erroDoSheets = new Error(
        'Sheets indisponível ao gravar postgres://crm_app:segredo-do-sheets@db:5432/crm_prod'
      );
      const ciclo = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => [CARD_FALSO],
        gravar: async () => {
          throw erroDoSheets;
        },
      });

      const resultado = await rodarCicloImportacao(pool, db, ciclo.job, ciclo.executarImportacao);

      expect(resultado.status).toBe('falha');
      expect(resultado.erro).toBeDefined();
      expect(resultado.erro).not.toContain('segredo-do-sheets');

      const [linha] = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, 'espelho-sheets'));
      expect(linha.status).toBe('falha');
      expect(linha.erro).not.toBeNull();
      expect(linha.erro).not.toContain('segredo-do-sheets');
      expect(linha.concluidoEm).toBeInstanceOf(Date);

      // O worker continua de pé: o mesmo pool/db ainda roda outro ciclo normalmente.
      const cicloSeguinte = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => [CARD_FALSO],
        gravar: async () => {},
      });
      const resultadoSeguinte = await rodarCicloImportacao(pool, db, cicloSeguinte.job, cicloSeguinte.executarImportacao);
      expect(resultadoSeguinte.status).toBe('sucesso');
    }
  );

  test(
    'um disparo do espelho que chega com a execução anterior ainda em andamento é pulado, sem gravar duas vezes (@spec:AC-337)',
    async () => {
      let lockAdquirido = false;
      const deferred = criarDeferred<void>();
      const gravarPrimeiro = vi.fn(async () => {
        lockAdquirido = true;
        await deferred.promise;
      });
      const gravarSegundo = vi.fn(async () => {});

      const cicloPrimeiro = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => [CARD_FALSO],
        gravar: gravarPrimeiro,
      });
      const cicloSegundo = construirCicloEspelho(db, config, ENV_COMPLETO, {
        consultarCards: async () => [CARD_FALSO, CARD_FALSO],
        gravar: gravarSegundo,
      });

      const primeiro = rodarCicloImportacao(pool, db, cicloPrimeiro.job, cicloPrimeiro.executarImportacao);
      await esperarAte(() => lockAdquirido);

      const segundo = await rodarCicloImportacao(pool, db, cicloSegundo.job, cicloSegundo.executarImportacao);
      expect(segundo.status).toBe('pulado');
      expect(gravarSegundo).not.toHaveBeenCalled();

      deferred.resolve();
      const resultadoPrimeiro = await primeiro;
      expect(resultadoPrimeiro.status).toBe('sucesso');

      const execucoes = await db.select().from(cronExecucoes).where(eq(cronExecucoes.job, 'espelho-sheets'));
      expect(execucoes).toHaveLength(1);
    }
  );
});
