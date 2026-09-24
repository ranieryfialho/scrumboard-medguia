-- T-015: RLS (ativar + policy por tenant) em toda tabela de negócio com
-- empresa_id (AC-018). Fail-closed: sem `SET LOCAL app.empresa_id`, a
-- expressão `current_setting('app.empresa_id')::uuid` nunca casa com
-- nenhum `empresa_id`, então nenhuma linha é lida ou gravada (AC-020).
-- Sem policy permissiva default.

ALTER TABLE "empresa_configuracoes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "empresa_configuracoes_isolamento_tenant" ON "empresa_configuracoes";
CREATE POLICY "empresa_configuracoes_isolamento_tenant" ON "empresa_configuracoes"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads_isolamento_tenant" ON "leads";
CREATE POLICY "leads_isolamento_tenant" ON "leads"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "oportunidades" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oportunidades_isolamento_tenant" ON "oportunidades";
CREATE POLICY "oportunidades_isolamento_tenant" ON "oportunidades"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "cadencia_atividades" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cadencia_atividades_isolamento_tenant" ON "cadencia_atividades";
CREATE POLICY "cadencia_atividades_isolamento_tenant" ON "cadencia_atividades"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "oportunidade_eventos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oportunidade_eventos_isolamento_tenant" ON "oportunidade_eventos";
CREATE POLICY "oportunidade_eventos_isolamento_tenant" ON "oportunidade_eventos"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "tarefas_agendadas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tarefas_agendadas_isolamento_tenant" ON "tarefas_agendadas";
CREATE POLICY "tarefas_agendadas_isolamento_tenant" ON "tarefas_agendadas"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "anexos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anexos_isolamento_tenant" ON "anexos";
CREATE POLICY "anexos_isolamento_tenant" ON "anexos"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "reunioes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reunioes_isolamento_tenant" ON "reunioes";
CREATE POLICY "reunioes_isolamento_tenant" ON "reunioes"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "whatsapp_mensagens" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_mensagens_isolamento_tenant" ON "whatsapp_mensagens";
CREATE POLICY "whatsapp_mensagens_isolamento_tenant" ON "whatsapp_mensagens"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "campanhas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campanhas_isolamento_tenant" ON "campanhas";
CREATE POLICY "campanhas_isolamento_tenant" ON "campanhas"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

ALTER TABLE "envios_campanha" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "envios_campanha_isolamento_tenant" ON "envios_campanha";
CREATE POLICY "envios_campanha_isolamento_tenant" ON "envios_campanha"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
