-- Tabela de histórico de mensagens WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  lead_id              text,
  numero               text        NOT NULL,
  mensagem             text        NOT NULL,
  direcao              text        NOT NULL CHECK (direcao IN ('enviada', 'recebida')),
  status               text        DEFAULT 'entregue',
  evolution_message_id text,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wpp_msg_empresa  ON whatsapp_mensagens(empresa_id);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_numero   ON whatsapp_mensagens(numero);
CREATE INDEX IF NOT EXISTS idx_wpp_msg_lead     ON whatsapp_mensagens(lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE whatsapp_mensagens ENABLE ROW LEVEL SECURITY;

-- Usuários veem apenas mensagens da sua empresa
CREATE POLICY "wpp_select_empresa"
  ON whatsapp_mensagens FOR SELECT
  USING (
    empresa_id = (auth.jwt() -> 'user_metadata' ->> 'empresa_id')::uuid
  );

-- Apenas o service role escreve (via API routes)
CREATE POLICY "wpp_insert_service"
  ON whatsapp_mensagens FOR INSERT
  WITH CHECK (false);  -- bloqueado para clientes; service role ignora RLS

-- Garante que dois tenants não usem o mesmo nome de instância Evolution API
CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_instance_name_unique
  ON empresa_configuracoes (valor)
  WHERE chave = 'evolution_instance_name';
