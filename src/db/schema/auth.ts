import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { usuarios } from './identidade';

// Tabelas do adaptador Drizzle do Better Auth (AC-016). Credenciais e sessões
// ficam aqui; `usuarios` continua sendo a identidade de negócio sem senha.
// Configurar a biblioteca em si é escopo da feature fase1-auth-rbac.

export const contas = pgTable('contas', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: uuid('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  idConta: text('id_conta').notNull(),
  idProvedor: text('id_provedor').notNull(),
  tokenAcesso: text('token_acesso'),
  tokenRefresh: text('token_refresh'),
  tokenId: text('token_id'),
  tokenAcessoExpiraEm: timestamp('token_acesso_expira_em', { withTimezone: true }),
  tokenRefreshExpiraEm: timestamp('token_refresh_expira_em', { withTimezone: true }),
  escopo: text('escopo'),
  senha: text('senha'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const sessoes = pgTable('sessoes', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: uuid('usuario_id')
    .notNull()
    .references(() => usuarios.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  enderecoIp: text('endereco_ip'),
  userAgent: text('user_agent'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('sessoes_token_unico').on(t.token)]);

export const tokensVerificacao = pgTable('tokens_verificacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  identificador: text('identificador').notNull(),
  valor: text('valor').notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});
