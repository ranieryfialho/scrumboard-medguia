-- T-321 (fase4-admin, US-137): o registro de auditoria da equipe — quem convidou, reenviou convite, trocou o papel, desativou ou
-- reativou quem, e quando. Até aqui essas ações só iam para o log do servidor. Append-only como a 0014: o isolamento por tenant
-- vale para leitura e inserção, e não há política de UPDATE/DELETE (o `crm_app` não consegue alterar nem apagar um registro).
-- Escrita à mão, no estilo da 0014; o GRANT vem de ALTER DEFAULT PRIVILEGES.

CREATE TABLE "auditoria_equipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"ator_id" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"alvo_id" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"alvo_email" text NOT NULL,
	"acao" text NOT NULL,
	"detalhe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoria_equipe_acao_valida" CHECK ("acao" IN ('convite', 'reenvio_convite', 'papel_alterado', 'desativado', 'reativado', 'acessos_alterados'))
);

CREATE INDEX "auditoria_equipe_empresa_criado_em" ON "auditoria_equipe" USING btree ("empresa_id", "criado_em" DESC);

ALTER TABLE "auditoria_equipe" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auditoria_equipe_leitura_tenant" ON "auditoria_equipe";
CREATE POLICY "auditoria_equipe_leitura_tenant" ON "auditoria_equipe"
  FOR SELECT
  USING (empresa_id = current_setting('app.empresa_id')::uuid);
DROP POLICY IF EXISTS "auditoria_equipe_insercao_tenant" ON "auditoria_equipe";
CREATE POLICY "auditoria_equipe_insercao_tenant" ON "auditoria_equipe"
  FOR INSERT
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
