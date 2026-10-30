-- T-270 (fase5-email-descadastro, US-174, ASM-269): quem pediu para sair da lista de e-mails de cada empresa (LGPD).
-- Um registro por empresa e e-mail (em minúsculas), idempotente. Escrita à mão, no estilo da 0020; isolamento por tenant
-- da 0001 (fail-closed). O `GRANT` vem de ALTER DEFAULT PRIVILEGES (infra/postgres/init).

CREATE TABLE "email_descadastros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"email" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_descadastros_email_minusculo" CHECK ("email" = lower(btrim("email")) AND char_length("email") BETWEEN 3 AND 320)
);
--> statement-breakpoint
ALTER TABLE "email_descadastros" ADD CONSTRAINT "email_descadastros_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_descadastros_empresa_email_unico" ON "email_descadastros" USING btree ("empresa_id", "email");

ALTER TABLE "email_descadastros" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_descadastros_tenant" ON "email_descadastros";
CREATE POLICY "email_descadastros_tenant" ON "email_descadastros"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
