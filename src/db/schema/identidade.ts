import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const papelUsuarioEnum = pgEnum('papel_usuario', ['MASTER', 'GERENTE', 'ATENDENTE']);

export const empresas = pgTable(
  'empresas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
    slug: text('slug').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('empresas_slug_unico').on(t.slug)]
);

export const empresaConfiguracoes = pgTable(
  'empresa_configuracoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    chave: text('chave').notNull(),
    valor: jsonb('valor').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('empresa_configuracoes_empresa_chave_unica').on(t.empresaId, t.chave)]
);

// `id` preserva os UUIDs de usuário do Supabase (ETL futuro) — sem defaultRandom
// para não mascarar inserts que precisam informar o id explicitamente.
export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    nome: text('nome').notNull(),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usuarios_email_unico').on(t.email)]
);

export const empresasUsuarios = pgTable(
  'empresas_usuarios',
  {
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    papel: papelUsuarioEnum('papel').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.usuarioId] })]
);
