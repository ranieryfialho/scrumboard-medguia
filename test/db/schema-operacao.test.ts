// Testes de T-013 (fase1-schema-drizzle, US-007): tabelas de operação
// (cron, importações, reconciliação do ETL). Introspecção estática do schema
// Drizzle (sem Postgres) — a prova de que as migrations aplicam o schema
// completo num banco limpo é do T-021 (AC-015).
import { describe, test, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';

import { cronExecucoes, importacoes, migracaoRegistros } from '../../src/db/schema';

describe('T-013: tabelas de operação (@spec:AC-015)', () => {
  test('cron_execucoes existe com job, status e contagem obrigatórios', () => {
    expect(getTableName(cronExecucoes)).toBe('cron_execucoes');
    const columns = getTableColumns(cronExecucoes);
    expect(columns.id.primary).toBe(true);
    expect(columns.job.notNull).toBe(true);
    expect(columns.iniciadoEm.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.itensProcessados.notNull).toBe(true);
  });

  test('importacoes existe com origem e contagens de linhas obrigatórias', () => {
    expect(getTableName(importacoes)).toBe('importacoes');
    const columns = getTableColumns(importacoes);
    expect(columns.origem.notNull).toBe(true);
    expect(columns.linhasLidas.notNull).toBe(true);
    expect(columns.linhasCriadas.notNull).toBe(true);
    expect(columns.linhasIgnoradas.notNull).toBe(true);
  });

  test('migracao_registros existe com origem, id_externo, entidade e id_destino obrigatórios', () => {
    expect(getTableName(migracaoRegistros)).toBe('migracao_registros');
    const columns = getTableColumns(migracaoRegistros);
    expect(columns.origem.notNull).toBe(true);
    expect(columns.idExterno.notNull).toBe(true);
    expect(columns.entidade.notNull).toBe(true);
    expect(columns.idDestino.notNull).toBe(true);
  });
});
