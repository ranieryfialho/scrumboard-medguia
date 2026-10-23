-- Schema REAL do Supabase do CRM legado, conferido em 22/10/2026 pelo
-- `information_schema.columns` (T-139, fase3-etl-supabase). Só as seis
-- tabelas que o ETL lê, só colunas e tipos — sem constraints nem RLS, que não
-- importam para a leitura. Fica num schema próprio (`legado`) para não
-- colidir com as tabelas do CRM novo, que têm os mesmos nomes.
--
-- Se o legado mudar, atualize este arquivo a partir de uma nova consulta ao
-- `information_schema`, nunca a partir do que o ETL espera.
CREATE SCHEMA legado;
SET search_path = legado;

CREATE TABLE empresas (
  id uuid, nome text, slug text, usa_sheets boolean, criado_em timestamptz
);

CREATE TABLE leads (
  id uuid, empresa_id uuid, nome text, email text, whatsapp text, cargo text,
  tipo text, situacao text, origem text, observacoes text, anuncio text,
  responsavel text, dados_fechamento jsonb, data_fechamento timestamptz,
  data_alteracao timestamptz, criado_em timestamptz
);

CREATE TABLE campanhas (
  id uuid, nome text, assunto text, corpo_html text, status text,
  grupo_id uuid, criado_por uuid, criado_em timestamptz, empresa_id uuid
);

CREATE TABLE envios_campanha (
  id uuid, campanha_id uuid, nome_destinatario text, email_destinatario text,
  status text, aberto_em timestamptz, clicado_em timestamptz, log_erro text,
  criado_em timestamptz
);

CREATE TABLE whatsapp_mensagens (
  id uuid, empresa_id uuid, lead_id text, numero text, mensagem text,
  direcao text, status text, evolution_message_id text, created_at timestamptz
);

CREATE TABLE empresa_configuracoes (
  id uuid, empresa_id uuid, chave text, valor text, criado_em timestamptz
);
