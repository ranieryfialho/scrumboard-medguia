-- T-179 (fase4-pipeline-lote, US-118, AC-459/ASM-156): registro das exportações
-- de CSV da lista e dos arquivados do pipeline — quem exportou, quando, de qual
-- tela, com quais filtros e quantas linhas saíram. O arquivo leva nome, telefone
-- e e-mail de leads, então cada exportação fica registrada (LGPD).
--
-- Escrita à mão, no mesmo estilo de 0011 a 0013. Isolamento por tenant como na
-- 0001/0009 (fail-closed: sem `app.empresa_id` nenhuma linha é lida ou gravada),
-- mas APENAS leitura e inserção: o registro é append-only — sem política de
-- UPDATE/DELETE, o `crm_app` não consegue alterar nem apagar uma exportação.
-- O `GRANT` de tabela vem de ALTER DEFAULT PRIVILEGES (infra/postgres/init).

CREATE TABLE "auditoria_exportacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid,
	"tela" text NOT NULL,
	"filtros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linhas" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoria_exportacoes_tela_valida" CHECK ("tela" IN ('lista', 'arquivados')),
	CONSTRAINT "auditoria_exportacoes_linhas_nao_negativas" CHECK ("linhas" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auditoria_exportacoes" ADD CONSTRAINT "auditoria_exportacoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria_exportacoes" ADD CONSTRAINT "auditoria_exportacoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_exportacoes_empresa_criado_em" ON "auditoria_exportacoes" USING btree ("empresa_id","criado_em" DESC);

ALTER TABLE "auditoria_exportacoes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auditoria_exportacoes_leitura_tenant" ON "auditoria_exportacoes";
CREATE POLICY "auditoria_exportacoes_leitura_tenant" ON "auditoria_exportacoes"
  FOR SELECT
  USING (empresa_id = current_setting('app.empresa_id')::uuid);
DROP POLICY IF EXISTS "auditoria_exportacoes_insercao_tenant" ON "auditoria_exportacoes";
CREATE POLICY "auditoria_exportacoes_insercao_tenant" ON "auditoria_exportacoes"
  FOR INSERT
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
