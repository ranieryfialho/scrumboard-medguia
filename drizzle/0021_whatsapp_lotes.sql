-- T-250 (fase5-whatsapp-lote-disparo, US-162/US-163, ASM-246/ASM-248): lotes de WhatsApp e a fila de
-- destinatários. Um lote por empresa em andamento (índice único parcial); cada item guarda a mensagem
-- já preenchida (ASM-249) e a situação do envio. `proximo_envio_em` é quando o worker pode mandar o
-- próximo (envio + sorteio de 15 a 45 s). Escrita à mão, no estilo da 0020; RLS por tenant da 0001.

CREATE TABLE "whatsapp_lotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"template_id" uuid,
	"template_nome" text NOT NULL,
	"criado_por" uuid,
	"status" text DEFAULT 'em_andamento' NOT NULL,
	"total" integer NOT NULL,
	"proximo_envio_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"finalizado_em" timestamp with time zone,
	CONSTRAINT "whatsapp_lotes_status_valido" CHECK ("status" IN ('em_andamento', 'concluido', 'cancelado')),
	CONSTRAINT "whatsapp_lotes_total_positivo" CHECK ("total" >= 1)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_lote_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lote_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"lead_id" uuid,
	"ordem" integer NOT NULL,
	"nome" text NOT NULL,
	"telefone" text NOT NULL,
	"mensagem" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"erro" text,
	"enviado_em" timestamp with time zone,
	CONSTRAINT "whatsapp_lote_itens_status_valido" CHECK ("status" IN ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado'))
);
--> statement-breakpoint
ALTER TABLE "whatsapp_lotes" ADD CONSTRAINT "whatsapp_lotes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lotes" ADD CONSTRAINT "whatsapp_lotes_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lotes" ADD CONSTRAINT "whatsapp_lotes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lote_itens" ADD CONSTRAINT "whatsapp_lote_itens_lote_id_whatsapp_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."whatsapp_lotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lote_itens" ADD CONSTRAINT "whatsapp_lote_itens_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_lote_itens" ADD CONSTRAINT "whatsapp_lote_itens_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_lotes_um_em_andamento" ON "whatsapp_lotes" USING btree ("empresa_id") WHERE "status" = 'em_andamento';--> statement-breakpoint
CREATE INDEX "whatsapp_lotes_empresa_criado_em" ON "whatsapp_lotes" USING btree ("empresa_id", "criado_em" DESC);--> statement-breakpoint
CREATE INDEX "whatsapp_lote_itens_lote_status_ordem" ON "whatsapp_lote_itens" USING btree ("lote_id", "status", "ordem");

ALTER TABLE "whatsapp_lotes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_lotes_tenant" ON "whatsapp_lotes";
CREATE POLICY "whatsapp_lotes_tenant" ON "whatsapp_lotes"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
ALTER TABLE "whatsapp_lote_itens" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_lote_itens_tenant" ON "whatsapp_lote_itens";
CREATE POLICY "whatsapp_lote_itens_tenant" ON "whatsapp_lote_itens"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
