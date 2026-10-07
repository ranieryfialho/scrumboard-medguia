import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { empresas, papelUsuarioEnum, usuarios } from './identidade';

export const macrofluxoEnum = pgEnum('macrofluxo', ['SDR', 'CLOSER']);
export const cadenciaTurnoEnum = pgEnum('cadencia_turno', ['manha', 'tarde']);
export const cadenciaCanalEnum = pgEnum('cadencia_canal', ['telefone', 'whatsapp']);
export const cadenciaTipoEnum = pgEnum('cadencia_tipo', ['ligacao', 'mensagem', 'breakup']);
export const cadenciaResultadoEnum = pgEnum('cadencia_resultado', [
  'pendente',
  'sem_resposta',
  'conectou',
  'cancelada',
]);
export const atorTipoEnum = pgEnum('ator_tipo', ['usuario', 'sistema', 'migracao']);

// Seed imutável das 15 etapas (AC-029) — `id` explícito, sem defaultRandom,
// porque as linhas nascem do seed da migration, nunca de um insert da app.
export const pipelineEtapas = pgTable('pipeline_etapas', {
  id: integer('id').primaryKey(),
  ordem: integer('ordem').notNull(),
  nome: text('nome').notNull(),
  macrofluxo: macrofluxoEnum('macrofluxo').notNull(),
  exigeValor: boolean('exige_valor').notNull().default(false),
  exigeMotivo: boolean('exige_motivo').notNull().default(false),
  exigeProximaAcao: boolean('exige_proxima_acao').notNull().default(false),
  exigeEvidencia: boolean('exige_evidencia').notNull().default(false),
  eTerminal: boolean('e_terminal').notNull().default(false),
});

// Grafo de transições permitido (AC-030) — toda combinação fora daqui é
// rejeitada por omissão; sem policy permissiva default.
export const pipelineTransicoes = pgTable(
  'pipeline_transicoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    etapaOrigemId: integer('etapa_origem_id')
      .notNull()
      .references(() => pipelineEtapas.id, { onDelete: 'restrict' }),
    etapaDestinoId: integer('etapa_destino_id')
      .notNull()
      .references(() => pipelineEtapas.id, { onDelete: 'restrict' }),
    exigeJustificativa: boolean('exige_justificativa').notNull().default(false),
    papeisPermitidos: papelUsuarioEnum('papeis_permitidos').array().notNull(),
  },
  (t) => [
    uniqueIndex('pipeline_transicoes_origem_destino_unica').on(t.etapaOrigemId, t.etapaDestinoId),
  ]
);

export const motivosPerda = pgTable(
  'motivos_perda',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nome: text('nome').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    eSistemico: boolean('e_sistemico').notNull().default(false),
  },
  (t) => [uniqueIndex('motivos_perda_nome_unico').on(t.nome)]
);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  telefoneE164: text('telefone_e164'),
  email: text('email'),
  origem: text('origem'),
  idExterno: text('id_externo'),
  dados: jsonb('dados'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Telefones extras do lead (US-047) — o principal continua em
// `leads.telefone_e164` (ASM-043); aqui só recepção/sócio/financeiro etc.,
// sempre ligados ao mesmo lead e à mesma empresa dele.
export const leadTelefones = pgTable(
  'lead_telefones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    numero: text('numero').notNull(),
    rotulo: text('rotulo'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lead_telefones_lead_numero_unica').on(t.leadId, t.numero)]
);

// O card do pipeline. `version` sustenta o lock otimista de `mover_oportunidade`
// (AC-026/AC-027) — incrementada só dentro dessa função transacional.
export const oportunidades = pgTable('oportunidades', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'restrict' }),
  etapaId: integer('etapa_id')
    .notNull()
    .references(() => pipelineEtapas.id, { onDelete: 'restrict' }),
  responsavelId: uuid('responsavel_id').references(() => usuarios.id, { onDelete: 'set null' }),
  valor: numeric('valor', { precision: 12, scale: 2 }),
  motivoPerdaId: uuid('motivo_perda_id').references(() => motivosPerda.id, {
    onDelete: 'restrict',
  }),
  proximaAcaoEm: timestamp('proxima_acao_em', { withTimezone: true }),
  cadenciaDia: integer('cadencia_dia'),
  cadenciaTurno: cadenciaTurnoEnum('cadencia_turno'),
  cadenciaEncerradaEm: timestamp('cadencia_encerrada_em', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const anexos = pgTable('anexos', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  oportunidadeId: uuid('oportunidade_id')
    .notNull()
    .references(() => oportunidades.id, { onDelete: 'cascade' }),
  caminho: text('caminho').notNull(),
  mime: text('mime').notNull(),
  tamanho: integer('tamanho').notNull(),
  hash: text('hash').notNull(),
  enviadoPor: uuid('enviado_por').references(() => usuarios.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Um toque da cadência (AC-024): sequência única por oportunidade, limitada a
// 1–18, dia 1–3 — constraints da migration T-016.
export const cadenciaAtividades = pgTable(
  'cadencia_atividades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oportunidadeId: uuid('oportunidade_id')
      .notNull()
      .references(() => oportunidades.id, { onDelete: 'cascade' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    sequencia: integer('sequencia').notNull(),
    dia: integer('dia').notNull(),
    turno: cadenciaTurnoEnum('turno').notNull(),
    canal: cadenciaCanalEnum('canal').notNull(),
    tipo: cadenciaTipoEnum('tipo').notNull(),
    resultado: cadenciaResultadoEnum('resultado').notNull().default('pendente'),
    realizadaEm: timestamp('realizada_em', { withTimezone: true }),
    realizadaPor: uuid('realizada_por').references(() => usuarios.id, { onDelete: 'set null' }),
    observacao: text('observacao'),
    anexoId: uuid('anexo_id').references(() => anexos.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('cadencia_atividades_oportunidade_sequencia_unica').on(t.oportunidadeId, t.sequencia)]
);

// Log append-only (AC-025): `crm_app` perde UPDATE/DELETE na migration de
// privilégios (T-016) — aqui só o modelo de colunas.
export const oportunidadeEventos = pgTable('oportunidade_eventos', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  oportunidadeId: uuid('oportunidade_id')
    .notNull()
    .references(() => oportunidades.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(),
  etapaOrigemId: integer('etapa_origem_id').references(() => pipelineEtapas.id, {
    onDelete: 'restrict',
  }),
  etapaDestinoId: integer('etapa_destino_id').references(() => pipelineEtapas.id, {
    onDelete: 'restrict',
  }),
  atorId: uuid('ator_id').references(() => usuarios.id, { onDelete: 'set null' }),
  atorTipo: atorTipoEnum('ator_tipo').notNull(),
  payload: jsonb('payload'),
  ocorridoEm: timestamp('ocorrido_em', { withTimezone: true }).notNull().defaultNow(),
});

export const tarefasAgendadas = pgTable('tarefas_agendadas', {
  id: uuid('id').primaryKey().defaultRandom(),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  oportunidadeId: uuid('oportunidade_id')
    .notNull()
    .references(() => oportunidades.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(),
  agendadaPara: timestamp('agendada_para', { withTimezone: true }).notNull(),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  responsavelId: uuid('responsavel_id').references(() => usuarios.id, { onDelete: 'set null' }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const reunioes = pgTable('reunioes', {
  id: uuid('id').primaryKey().defaultRandom(),
  oportunidadeId: uuid('oportunidade_id')
    .notNull()
    .references(() => oportunidades.id, { onDelete: 'cascade' }),
  empresaId: uuid('empresa_id')
    .notNull()
    .references(() => empresas.id, { onDelete: 'cascade' }),
  agendadaPara: timestamp('agendada_para', { withTimezone: true }).notNull(),
  calendarEventId: text('calendar_event_id'),
  iniciadaEm: timestamp('iniciada_em', { withTimezone: true }),
  encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
  duracaoMinutos: integer('duracao_minutos'),
  resumo: text('resumo'),
  anexoId: uuid('anexo_id').references(() => anexos.id, { onDelete: 'set null' }),
  noShow: boolean('no_show').notNull().default(false),
  remarcadaDe: uuid('remarcada_de'),
});
