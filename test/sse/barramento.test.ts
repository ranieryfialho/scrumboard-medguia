// T-061 (fase2c-sse, US-038): prova, contra um Postgres 15 efêmero real
// (mesmo harness de test/sse/notify-sql.test.ts), que o barramento mantém
// exatamente UMA conexão de LISTEN por instância mesmo com muitas
// inscrições (AC-115), entrega `oportunidade.movida` só para quem é do
// mesmo tenant (AC-109), libera o ouvinte quando o cliente cancela a
// inscrição sem afetar os demais (AC-116) e, se a conexão de LISTEN cair
// (simulado com `pg_terminate_backend` no backend dela), reconecta sozinho
// e avisa os inscritos com `stream.reconectado` (AC-117).
//
// `pg_notify` é disparado direto via `psqlComo` (sem passar por
// `mover_oportunidade`) porque o contrato do payload em si já tem prova
// própria em test/sse/notify-sql.test.ts (T-060); aqui o que se prova é o
// comportamento do barramento como consumidor de LISTEN/NOTIFY.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  criarBarramento,
  type Barramento,
  type EventoBarramento,
} from '../../src/lib/sse/barramento';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA_A = 'dddddddd-0000-0000-0000-00000000000a';
const EMPRESA_B = 'dddddddd-0000-0000-0000-00000000000b';

function payloadMovimentacao(empresaId: string, oportunidadeId: string): string {
  const payload = {
    empresaId,
    oportunidadeId,
    etapaOrigemId: 1,
    etapaDestinoId: 2,
    atorId: 'dddddddd-0000-0000-0000-0000000000f1',
    ocorridoEm: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

async function aguardar(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function aguardarCondicao(
  condicao: () => boolean | Promise<boolean>,
  { tentativas = 50, intervaloMs = 100 }: { tentativas?: number; intervaloMs?: number } = {}
): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await aguardar(intervaloMs);
  }
  if (!(await condicao())) {
    throw new Error('Condição não satisfeita dentro do tempo esperado.');
  }
}

async function contarConexoesListen(pg: PostgresEfemero): Promise<number> {
  const resultado = pg.psqlComo(
    'postgres',
    `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`,
    'postgres'
  );
  if (resultado.status !== 0) {
    throw new Error(`Falha ao consultar pg_stat_activity: ${resultado.stderr}`);
  }
  return Number(resultado.stdout.trim());
}

async function pidDaConexaoListen(pg: PostgresEfemero): Promise<number> {
  const resultado = pg.psqlComo(
    'postgres',
    `SELECT pid FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %' LIMIT 1`,
    'postgres'
  );
  if (resultado.status !== 0 || !resultado.stdout.trim()) {
    throw new Error(`Falha ao localizar o pid da conexão de LISTEN: ${resultado.stderr}`);
  }
  return Number(resultado.stdout.trim());
}

function dispararNotify(pg: PostgresEfemero, payloadJson: string): void {
  const resultado = pg.psqlComo('crm_app', `SELECT pg_notify('oportunidade', $$${payloadJson}$$)`);
  if (resultado.status !== 0) {
    throw new Error(`Falha ao disparar NOTIFY de teste: ${resultado.stderr}`);
  }
}

describe('T-061: Barramento de eventos — um LISTEN por instância', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  describe('AC-109: evento só chega a quem é do mesmo tenant', () => {
    let barramento: Barramento;
    const eventosA: EventoBarramento[] = [];
    const eventosB: EventoBarramento[] = [];

    beforeAll(async () => {
      barramento = criarBarramento({ connectionString: pg.appUrl });
      barramento.inscrever(EMPRESA_A, (evento) => eventosA.push(evento));
      barramento.inscrever(EMPRESA_B, (evento) => eventosB.push(evento));
      await aguardarCondicao(() => barramento.contarInscricoes() === 2);
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
    }, 30_000);

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('usuário da empresa A recebe o evento e o da empresa B não recebe nada @spec:AC-109', async () => {
      const oportunidadeId = 'dddddddd-0000-0000-0000-0000000000c1';
      dispararNotify(pg, payloadMovimentacao(EMPRESA_A, oportunidadeId));

      await aguardarCondicao(() => eventosA.length === 1);
      await aguardar(300);

      expect(eventosA).toHaveLength(1);
      expect(eventosA[0]).toMatchObject({
        tipo: 'oportunidade.movida',
        empresaId: EMPRESA_A,
        oportunidadeId,
      });
      expect(eventosB).toHaveLength(0);
    });
  });

  describe('AC-115: todas as conexões compartilham um único LISTEN', () => {
    let barramento: Barramento;
    const cancelamentos: Array<() => void> = [];

    beforeAll(async () => {
      barramento = criarBarramento({ connectionString: pg.appUrl });
      for (let i = 0; i < 50; i += 1) {
        cancelamentos.push(barramento.inscrever(EMPRESA_A, () => {}));
      }
      await aguardarCondicao(() => barramento.contarInscricoes() === 50);
    }, 30_000);

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('50 inscrições na mesma instância resultam em exatamente 1 conexão de LISTEN no banco @spec:AC-115', async () => {
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
      expect(await contarConexoesListen(pg)).toBe(1);
      expect(barramento.contarInscricoes()).toBe(50);
    });

    test('fechar uma inscrição não derruba a conexão de LISTEN nem as demais inscrições @spec:AC-115', async () => {
      cancelamentos[0]();
      expect(barramento.contarInscricoes()).toBe(49);
      await aguardar(200);
      expect(await contarConexoesListen(pg)).toBe(1);
    });
  });

  describe('AC-116: cliente que fecha libera os recursos', () => {
    let barramento: Barramento;
    const eventos: EventoBarramento[] = [];

    beforeAll(async () => {
      barramento = criarBarramento({ connectionString: pg.appUrl });
    });

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('cancelar a inscrição remove o ouvinte e o número de inscrições ativas cai em 1 @spec:AC-116', async () => {
      const cancelar = barramento.inscrever(EMPRESA_A, (evento) => eventos.push(evento));
      await aguardarCondicao(() => barramento.contarInscricoes() === 1);
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);

      cancelar();
      expect(barramento.contarInscricoes()).toBe(0);

      const oportunidadeId = 'dddddddd-0000-0000-0000-0000000000c2';
      dispararNotify(pg, payloadMovimentacao(EMPRESA_A, oportunidadeId));
      await aguardar(300);

      expect(eventos).toHaveLength(0);
    });
  });

  describe('AC-117: queda do LISTEN reconecta sozinha e avisa os clientes', () => {
    let barramento: Barramento;
    const eventos: EventoBarramento[] = [];

    beforeAll(async () => {
      barramento = criarBarramento({
        connectionString: pg.appUrl,
        backoffInicialMs: 50,
        backoffMaximoMs: 200,
      });
      barramento.inscrever(EMPRESA_A, (evento) => eventos.push(evento));
      await aguardarCondicao(() => barramento.contarInscricoes() === 1);
      await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
    }, 30_000);

    afterAll(async () => {
      await barramento.encerrar();
    });

    test('derrubar o backend da conexão de LISTEN faz o barramento reconectar e emitir stream.reconectado @spec:AC-117', async () => {
      const pidAntigo = await pidDaConexaoListen(pg);
      const resultado = pg.psqlComo(
        'postgres',
        `SELECT pg_terminate_backend(${pidAntigo})`,
        'postgres'
      );
      if (resultado.status !== 0) {
        throw new Error(`Falha ao derrubar a conexão de LISTEN: ${resultado.stderr}`);
      }

      await aguardarCondicao(
        () => eventos.some((evento) => evento.tipo === 'stream.reconectado'),
        { tentativas: 100, intervaloMs: 100 }
      );
      expect(eventos.some((evento) => evento.tipo === 'stream.reconectado')).toBe(true);

      await aguardarCondicao(async () => {
        const pidNovo = await pidDaConexaoListen(pg);
        return pidNovo !== pidAntigo;
      });
      expect(await contarConexoesListen(pg)).toBe(1);

      const oportunidadeId = 'dddddddd-0000-0000-0000-0000000000c3';
      dispararNotify(pg, payloadMovimentacao(EMPRESA_A, oportunidadeId));

      await aguardarCondicao(() =>
        eventos.some(
          (evento) => evento.tipo === 'oportunidade.movida' && evento.oportunidadeId === oportunidadeId
        )
      );
    }, 30_000);
  });
});
