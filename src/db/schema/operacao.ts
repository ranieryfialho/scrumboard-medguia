import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Status fechado de execução de job (TDD-001 §4.3) — base do health e da
// detecção de falha silenciosa; sem tenant, é infraestrutura própria da app.
export const cronStatusEnum = pgEnum('cron_status', ['em_execucao', 'sucesso', 'falha']);

export const cronExecucoes = pgTable('cron_execucoes', {
  id: uuid('id').primaryKey().defaultRandom(),
  job: text('job').notNull(),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull().defaultNow(),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
  status: cronStatusEnum('status').notNull().default('em_execucao'),
  itensProcessados: integer('itens_processados').notNull().default(0),
  erro: text('erro'),
});

export const importacoes = pgTable('importacoes', {
  id: uuid('id').primaryKey().defaultRandom(),
  origem: text('origem').notNull(),
  janelaInicio: timestamp('janela_inicio', { withTimezone: true }),
  janelaFim: timestamp('janela_fim', { withTimezone: true }),
  linhasLidas: integer('linhas_lidas').notNull().default(0),
  linhasCriadas: integer('linhas_criadas').notNull().default(0),
  linhasIgnoradas: integer('linhas_ignoradas').notNull().default(0),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Garante idempotência do ETL (TDD-001 §4.3): `(origem, id_externo)` único
// casa com o `id_destino` já criado, sem duplicar em reexecução.
export const migracaoRegistros = pgTable(
  'migracao_registros',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    origem: text('origem').notNull(),
    idExterno: text('id_externo').notNull(),
    entidade: text('entidade').notNull(),
    idDestino: uuid('id_destino').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('migracao_registros_origem_id_externo_unica').on(t.origem, t.idExterno)]
);
