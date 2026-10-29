import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { empresas, usuarios } from './identidade';
import { leads } from './pipeline';

export const whatsappDirecaoEnum = pgEnum('whatsapp_direcao', ['enviada', 'recebida']);

// Reescrita do modelo legado do Supabase (TDD-001 §4.3, §16.2) com
// `empresa_id` obrigatório — a versão antiga tinha RLS via JWT; aqui é RLS
// por `current_setting('app.empresa_id')` (T-015).
export const whatsappMensagens = pgTable('whatsapp_mensagens', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  numero: text('numero').notNull(),
  mensagem: text('mensagem').notNull(),
  direcao: whatsappDirecaoEnum('direcao').notNull(),
  status: text('status').notNull().default('entregue'),
  evolutionMessageId: text('evolution_message_id'),
  // Nula = não lida; só tem sentido para `direcao = 'recebida'` (ASM-044).
  lidaEm: timestamp('lida_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const campanhas = pgTable('campanhas', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  assunto: text('assunto').notNull(),
  corpoHtml: text('corpo_html').notNull(),
  status: text('status').notNull().default('RASCUNHO'),
  criadoPor: uuid('criado_por').references(() => usuarios.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const enviosCampanha = pgTable('envios_campanha', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  campanhaId: uuid('campanha_id')
    .notNull()
    .references(() => campanhas.id, { onDelete: 'cascade' }),
  nomeDestinatario: text('nome_destinatario').notNull(),
  emailDestinatario: text('email_destinatario').notNull(),
  status: text('status').notNull().default('RASCUNHO'),
  tentativas: integer('tentativas').notNull().default(0),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
});

/** T-245 (fase5-whatsapp-lote-base, ASM-241): template de mensagem da empresa; só o aprovado vale em lote (migration 0020). */
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    corpo: text('corpo').notNull(),
    status: text('status').notNull().default('rascunho'),
    criadoPor: uuid('criado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    aprovadoPor: uuid('aprovado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('whatsapp_templates_empresa_nome_unico').on(t.empresaId, sql`lower(${t.nome})`)]
);

/** T-250 (fase5-whatsapp-lote-disparo, ASM-246): lote de WhatsApp; um em andamento por empresa (migration 0021). */
export const whatsappLotes = pgTable(
  'whatsapp_lotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => whatsappTemplates.id, { onDelete: 'set null' }),
    templateNome: text('template_nome').notNull(),
    criadoPor: uuid('criado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('em_andamento'),
    total: integer('total').notNull(),
    proximoEnvioEm: timestamp('proximo_envio_em', { withTimezone: true }).notNull().defaultNow(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    finalizadoEm: timestamp('finalizado_em', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('whatsapp_lotes_um_em_andamento').on(t.empresaId).where(sql`${t.status} = 'em_andamento'`),
    index('whatsapp_lotes_empresa_criado_em').on(t.empresaId, t.criadoEm),
  ]
);

/** T-250: destinatário de um lote, com a mensagem já preenchida (ASM-249) e a situação do envio. */
export const whatsappLoteItens = pgTable(
  'whatsapp_lote_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loteId: uuid('lote_id')
      .notNull()
      .references(() => whatsappLotes.id, { onDelete: 'cascade' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    ordem: integer('ordem').notNull(),
    nome: text('nome').notNull(),
    telefone: text('telefone').notNull(),
    mensagem: text('mensagem').notNull(),
    status: text('status').notNull().default('pendente'),
    erro: text('erro'),
    enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  },
  (t) => [index('whatsapp_lote_itens_lote_status_ordem').on(t.loteId, t.status, t.ordem)]
);
