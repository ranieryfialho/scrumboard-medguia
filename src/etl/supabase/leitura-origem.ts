// T-139 (fase3-etl-supabase, US-074): leitores das tabelas da origem Supabase
// legada. Saíram de `scripts/etl-supabase.ts` para serem testados contra o
// schema REAL do legado (test/etl/fixtures/legado-supabase.sql): o dry-run de
// 22/10 mostrou que `envios_campanha` não tem `empresa_id`/`tentativas` e que
// `whatsapp_mensagens` tem `created_at`, não `criado_em`, e nenhuma data de
// leitura. Só leitura — a conexão já nasce com `default_transaction_read_only`
// (origem.ts).
import type { Pool } from 'pg';

import type { CampanhaLegado, EnvioLegado } from './campanhas';
import type { EmpresaLegado } from './identidade';
import type { LeadLegado } from './leads';
import type { ConfiguracaoLegado, MensagemLegado } from './mensagens-config';

export async function lerEmpresas(pool: Pool): Promise<EmpresaLegado[]> {
  const { rows } = await pool.query<EmpresaLegado>('SELECT id, nome, slug FROM empresas');
  return rows;
}

export async function lerLeads(pool: Pool): Promise<LeadLegado[]> {
  const { rows } = await pool.query<{
    id: string;
    empresa_id: string;
    nome: string;
    email: string | null;
    situacao: string | null;
    origem: string | null;
    observacoes: string | null;
    whatsapp: string | null;
  }>(
    'SELECT id, empresa_id, nome, email, situacao, origem, observacoes, whatsapp FROM leads'
  );
  return rows.map((linha) => ({
    id: linha.id,
    empresaId: linha.empresa_id,
    nome: linha.nome,
    email: linha.email,
    situacao: linha.situacao,
    origem: linha.origem,
    observacoes: linha.observacoes,
    whatsapp: linha.whatsapp,
  }));
}

export async function lerCampanhas(pool: Pool): Promise<CampanhaLegado[]> {
  const { rows } = await pool.query<{
    id: string;
    empresa_id: string;
    nome: string;
    assunto: string;
    corpo_html: string;
    status: string;
    criado_por: string | null;
  }>('SELECT id, empresa_id, nome, assunto, corpo_html, status, criado_por FROM campanhas');
  return rows.map((linha) => ({
    id: linha.id,
    empresaId: linha.empresa_id,
    nome: linha.nome,
    assunto: linha.assunto,
    corpoHtml: linha.corpo_html,
    status: linha.status,
    criadoPor: linha.criado_por,
  }));
}

/**
 * AC-342 (ASM-122): o legado não tem `empresa_id` nem `tentativas` em
 * `envios_campanha`. A empresa vem da campanha; `tentativas` entra como 0.
 * `LEFT JOIN` de propósito: um envio sem campanha chega com empresa nula e a
 * migração falha alto (NOT NULL no destino) em vez de perder o envio em
 * silêncio.
 */
export async function lerEnvios(pool: Pool): Promise<EnvioLegado[]> {
  const { rows } = await pool.query<{
    id: string;
    empresa_id: string;
    campanha_id: string;
    nome_destinatario: string;
    email_destinatario: string;
    status: string;
    tentativas: number;
  }>(
    `SELECT e.id, c.empresa_id, e.campanha_id, e.nome_destinatario,
            e.email_destinatario, e.status, 0 AS tentativas
       FROM envios_campanha e
       LEFT JOIN campanhas c ON c.id = e.campanha_id`
  );
  return rows.map((linha) => ({
    id: linha.id,
    empresaId: linha.empresa_id,
    campanhaId: linha.campanha_id,
    nomeDestinatario: linha.nome_destinatario,
    emailDestinatario: linha.email_destinatario,
    status: linha.status,
    tentativas: linha.tentativas,
  }));
}

/**
 * AC-343 (Q-039): o legado guarda só `created_at` e nada sobre leitura. O
 * horário da mensagem é `created_at` e, por decisão do usuário, o histórico
 * migra como lido: `lida_em` recebe a mesma data.
 */
export async function lerMensagens(pool: Pool): Promise<MensagemLegado[]> {
  const { rows } = await pool.query<{
    id: string;
    empresa_id: string;
    lead_id: string | null;
    numero: string;
    mensagem: string;
    direcao: 'enviada' | 'recebida';
    status: string;
    evolution_message_id: string | null;
    lida_em: Date | null;
    criado_em: Date;
  }>(
    `SELECT id, empresa_id, lead_id, numero, mensagem, direcao, status,
            evolution_message_id, created_at AS lida_em, created_at AS criado_em
       FROM whatsapp_mensagens`
  );
  return rows.map((linha) => ({
    id: linha.id,
    empresaId: linha.empresa_id,
    leadId: linha.lead_id,
    numero: linha.numero,
    mensagem: linha.mensagem,
    direcao: linha.direcao,
    status: linha.status,
    evolutionMessageId: linha.evolution_message_id,
    lidaEm: linha.lida_em,
    criadoEm: linha.criado_em,
  }));
}

export async function lerConfiguracoes(pool: Pool): Promise<ConfiguracaoLegado[]> {
  const { rows } = await pool.query<{ id: string; empresa_id: string; chave: string; valor: string }>(
    'SELECT id, empresa_id, chave, valor FROM empresa_configuracoes'
  );
  return rows.map((linha) => ({
    id: linha.id,
    empresaId: linha.empresa_id,
    chave: linha.chave,
    valor: linha.valor,
  }));
}
