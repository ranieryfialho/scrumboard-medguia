-- T-245 (fase5-whatsapp-lote-base, US-159/US-160, ASM-240/ASM-241): base do WhatsApp em lote — o
-- consentimento do lead (colunas em `leads`; vazio = sem consentimento) e os templates de mensagem
-- da empresa, que só valem em lote depois de aprovados. Escrita à mão, no estilo da 0016; a tabela
-- nova segue o isolamento por tenant da 0001 (fail-closed). O `GRANT` vem de ALTER DEFAULT PRIVILEGES.

ALTER TABLE "leads" ADD COLUMN "consentimento_whatsapp_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "consentimento_whatsapp_por" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_consentimento_whatsapp_por_usuarios_id_fk" FOREIGN KEY ("consentimento_whatsapp_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"corpo" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"criado_por" uuid,
	"aprovado_por" uuid,
	"aprovado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_templates_status_valido" CHECK ("status" IN ('rascunho', 'aprovado', 'arquivado')),
	CONSTRAINT "whatsapp_templates_nome_valido" CHECK (char_length("nome") BETWEEN 2 AND 60),
	CONSTRAINT "whatsapp_templates_corpo_valido" CHECK (char_length("corpo") BETWEEN 1 AND 1000),
	CONSTRAINT "whatsapp_templates_aprovado_tem_autor" CHECK ("status" <> 'aprovado' OR "aprovado_em" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_aprovado_por_usuarios_id_fk" FOREIGN KEY ("aprovado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_empresa_nome_unico" ON "whatsapp_templates" USING btree ("empresa_id", lower("nome"));

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_templates_tenant" ON "whatsapp_templates";
CREATE POLICY "whatsapp_templates_tenant" ON "whatsapp_templates"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
