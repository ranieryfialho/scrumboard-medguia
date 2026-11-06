import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { empresas, usuarios } from './identidade';
import { leads, oportunidades } from './pipeline';

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
  // T-290 (migration 0027): mídia da mensagem — tipo, mimetype, nome e o caminho do arquivo no volume, quando já guardado.
  midiaTipo: text('midia_tipo'),
  midiaMimetype: text('midia_mimetype'),
  midiaNome: text('midia_nome'),
  midiaArquivo: text('midia_arquivo'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Reações (emoji) às mensagens: uma por pessoa por mensagem — `autor` 'nos' (a empresa) ou 'contato'. Migration 0037.
export const whatsappReacoes = pgTable(
  'whatsapp_reacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    mensagemId: uuid('mensagem_id')
      .notNull()
      .references(() => whatsappMensagens.id, { onDelete: 'cascade' }),
    autor: text('autor').notNull(),
    emoji: text('emoji').notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('whatsapp_reacoes_mensagem_autor_unico').on(t.mensagemId, t.autor)]
);

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
  /** T-264 (migration 0024): o motivo curto de um envio que não saiu. */
  erro: text('erro'),
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

/** T-270 (fase5-email-descadastro, ASM-269): e-mails que a empresa não pode mais contatar por campanha (migration 0023). */
export const emailDescadastros = pgTable(
  'email_descadastros',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('email_descadastros_empresa_email_unico').on(t.empresaId, t.email)]
);

/** T-303 (fase4-whatsapp, US-125): para quem foi a mensagem avulsa e por quê; um por número da empresa (migration 0030). */
export const whatsappAvulsos = pgTable(
  'whatsapp_avulsos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    numero: text('numero').notNull(),
    nome: text('nome'),
    categoria: text('categoria'),
    criarLeadAoResponder: boolean('criar_lead_ao_responder').notNull().default(false),
    criadoPor: uuid('criado_por').references(() => usuarios.id, { onDelete: 'set null' }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('whatsapp_avulsos_empresa_numero_unico').on(t.empresaId, t.numero)]
);

/** T-303: o rascunho da mensagem avulsa de cada pessoa; um por usuário (migration 0030). */
export const whatsappRascunhos = pgTable(
  'whatsapp_rascunhos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    numero: text('numero').notNull().default(''),
    nome: text('nome').notNull().default(''),
    categoria: text('categoria').notNull().default(''),
    mensagem: text('mensagem').notNull().default(''),
    criarLeadAoResponder: boolean('criar_lead_ao_responder').notNull().default(true),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('whatsapp_rascunhos_empresa_usuario_unico').on(t.empresaId, t.usuarioId)]
);

/** T-313 (fase4-pipeline, US-114): dados do fechamento do cliente, uma linha por card (migration 0031). */
export const oportunidadeFechamento = pgTable('oportunidade_fechamento', {
  oportunidadeId: uuid('oportunidade_id')
    .primaryKey()
    .references(() => oportunidades.id, { onDelete: 'cascade' }),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  plataformaAnterior: text('plataforma_anterior').notNull(),
  deixouADesejar: text('deixou_a_desejar').notNull(),
  maisInteressou: text('mais_interessou').notNull(),
  plano: text('plano').notNull(),
  porOndeConheceu: text('por_onde_conheceu').notNull(),
  observacoes: text('observacoes').notNull(),
  registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
  registradoPor: uuid('registrado_por').references(() => usuarios.id, { onDelete: 'set null' }),
});

/** T-321 (fase4-admin, US-137): auditoria da equipe — convites, trocas de papel, desativações e reativações (migration 0033, append-only). */
export const auditoriaEquipe = pgTable('auditoria_equipe', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  atorId: uuid('ator_id').references(() => usuarios.id, { onDelete: 'set null' }),
  alvoId: uuid('alvo_id').references(() => usuarios.id, { onDelete: 'set null' }),
  alvoEmail: text('alvo_email').notNull(),
  acao: text('acao').notNull(),
  detalhe: jsonb('detalhe').notNull().default({}),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
