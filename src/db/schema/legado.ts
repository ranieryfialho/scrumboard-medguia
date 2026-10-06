import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
