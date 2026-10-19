// Testes de T-108 (fase3-etl-supabase, US-074): base do ETL — leitor da
// origem (src/etl/supabase/origem.ts) e contrato comum (src/etl/comum.ts):
// mascaramento de segredos (AC-266), idempotência via `migracao_registros`
// (AC-267), simulação sem escrita (AC-268) e transação única por execução
// (AC-270). Os três últimos só se provam contra um Postgres real — mock não
// prova rollback de transação — então usam o harness efêmero de
// T-020 (mesmo padrão de test/db/cadencia-funcoes.test.ts).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  buscarIdDestino,
  executarEtl,
  mascarar,
  registrarMigracao,
  type ContextoExecucao,
} from '../../src/etl/comum';
import { migracaoRegistros } from '../../src/db/schema';
import {
  conectarOrigem,
  encerrarOrigem,
  ErroOrigemSemCredencial,
  VARIAVEL_AMBIENTE_ORIGEM,
} from '../../src/etl/supabase/origem';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-108: mascarar segredos (@spec:AC-266)', () => {
  test('segredo nunca aparece por inteiro — só as pontas ficam visíveis', () => {
    const mascarado = mascarar('sk_live_9f8a7b6c5d4e3f2a1b0c');
    expect(mascarado).not.toBe('sk_live_9f8a7b6c5d4e3f2a1b0c');
    expect(mascarado.startsWith('sk')).toBe(true);
    expect(mascarado.endsWith('0c')).toBe(true);
    expect(mascarado).toContain('*');
    expect(mascarado).not.toContain('live_9f8a7b6c5d4e3f2a1b');
  });

  test('segredo curto (≤ 4 caracteres) fica totalmente mascarado, sem sobrar pista', () => {
    expect(mascarar('ab12')).toBe('****');
    expect(mascarar('x')).toBe('*');
  });

  test('valor vazio ou ausente não quebra e não vaza nada', () => {
    expect(mascarar('')).toBe('');
    expect(mascarar(null)).toBe('');
    expect(mascarar(undefined)).toBe('');
  });

  test('o tamanho do texto mascarado preserva o tamanho original (sem vazar o comprimento real diferente)', () => {
    const segredo = 'segredo-com-vinte-chars';
    expect(mascarar(segredo)).toHaveLength(segredo.length);
  });
});

describe('T-108: leitor da origem — conexão somente leitura (ASM-087, Q-027)', () => {
  test('recusa conectar sem credencial em variável de ambiente', () => {
    expect(() => conectarOrigem(undefined)).toThrow(ErroOrigemSemCredencial);
    expect(() => conectarOrigem(undefined)).toThrow(VARIAVEL_AMBIENTE_ORIGEM);
  });

  test('não usa DATABASE_URL (essa é do destino) — só a variável da origem', () => {
    const anterior = process.env.DATABASE_URL;
    const anteriorOrigem = process.env[VARIAVEL_AMBIENTE_ORIGEM];
    process.env.DATABASE_URL = 'postgres://destino:x@localhost:5432/crm_prod';
    delete process.env[VARIAVEL_AMBIENTE_ORIGEM];
    try {
      expect(() => conectarOrigem()).toThrow(ErroOrigemSemCredencial);
    } finally {
      if (anterior === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = anterior;
      if (anteriorOrigem !== undefined) process.env[VARIAVEL_AMBIENTE_ORIGEM] = anteriorOrigem;
    }
  });

  test('conecta com a credencial informada e abre a conexão em modo somente leitura', async () => {
    const pool = conectarOrigem('postgres://origem:x@localhost:5432/supabase_legado');
    expect(pool).toBeInstanceOf(Pool);
    expect(pool.options.connectionString).toBe('postgres://origem:x@localhost:5432/supabase_legado');
    expect(pool.options.options).toContain('default_transaction_read_only=on');
    await encerrarOrigem(pool);
  });
});

describe('T-108: contrato comum contra Postgres real (AC-267, AC-268, AC-270)', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contextoReal: ContextoExecucao = { origem: 'supabase-legado', simulacao: false };
  const contextoSimulacao: ContextoExecucao = { origem: 'supabase-legado', simulacao: true };

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

  async function contarRegistros(): Promise<number> {
    const linhas = await db.select().from(migracaoRegistros);
    return linhas.length;
  }

  test('executarEtl roda a etapa de verdade e commita quando não é simulação (@spec:AC-267)', async () => {
    const idDestino = '11111111-0000-0000-0000-000000000001';
    await executarEtl(db, contextoReal, async (tx, contexto) => {
      await registrarMigracao(tx, contexto, {
        entidade: 'empresa',
        idExterno: 'legado-empresa-1',
        idDestino,
      });
    });

    expect(await contarRegistros()).toBe(1);
  });

  test('rodar de novo sobre o mesmo id_externo não duplica — a etapa consulta antes de criar (@spec:AC-267)', async () => {
    const antes = await contarRegistros();

    await executarEtl(db, contextoReal, async (tx, contexto) => {
      const existente = await buscarIdDestino(tx, contexto.origem, 'legado-empresa-1');
      expect(existente).toBe('11111111-0000-0000-0000-000000000001');
      if (!existente) {
        await registrarMigracao(tx, contexto, {
          entidade: 'empresa',
          idExterno: 'legado-empresa-1',
          idDestino: '22222222-0000-0000-0000-000000000002',
        });
      }
    });

    expect(await contarRegistros()).toBe(antes);
  });

  test('simulação roda a etapa por completo mas não grava nada no destino ao final (@spec:AC-268)', async () => {
    const antes = await contarRegistros();

    const resultado = await executarEtl(db, contextoSimulacao, async (tx, contexto) => {
      await registrarMigracao(tx, contexto, {
        entidade: 'usuario',
        idExterno: 'legado-usuario-simulado',
        idDestino: '33333333-0000-0000-0000-000000000003',
      });
      return 'etapa executada';
    });

    expect(resultado).toBe('etapa executada');
    expect(await contarRegistros()).toBe(antes);

    const linha = await db
      .select()
      .from(migracaoRegistros)
      .where(eq(migracaoRegistros.idExterno, 'legado-usuario-simulado'));
    expect(linha).toHaveLength(0);
  });

  test('falha no meio da execução não deixa nada gravado — a transação inteira é desfeita (@spec:AC-270)', async () => {
    const antes = await contarRegistros();

    await expect(
      executarEtl(db, contextoReal, async (tx, contexto) => {
        await registrarMigracao(tx, contexto, {
          entidade: 'lead',
          idExterno: 'legado-lead-parcial-1',
          idDestino: '44444444-0000-0000-0000-000000000004',
        });
        await registrarMigracao(tx, contexto, {
          entidade: 'lead',
          idExterno: 'legado-lead-parcial-2',
          idDestino: '55555555-0000-0000-0000-000000000005',
        });
        throw new Error('falha simulada no meio da migração de leads');
      })
    ).rejects.toThrow('falha simulada no meio da migração de leads');

    expect(await contarRegistros()).toBe(antes);
  });
});
