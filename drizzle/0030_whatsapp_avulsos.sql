-- T-303 (fase4-whatsapp, US-125): a mensagem avulsa passa a lembrar para quem foi e por quê. `whatsapp_avulsos` guarda, por número
-- externo da empresa, o nome do destinatário, o motivo/categoria da abordagem e se o contato vira lead quando responder;
-- `whatsapp_rascunhos` guarda um rascunho por pessoa (a mensagem ainda não enviada). Escrita à mão, no estilo da 0021; RLS por tenant da 0001.

CREATE TABLE "whatsapp_avulsos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"numero" text NOT NULL,
	"nome" text,
	"categoria" text,
	"criar_lead_ao_responder" boolean DEFAULT false NOT NULL,
	"criado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_avulsos_empresa_numero_unico" ON "whatsapp_avulsos" USING btree ("empresa_id", "numero");
--> statement-breakpoint
CREATE TABLE "whatsapp_rascunhos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
	"numero" text NOT NULL DEFAULT '',
	"nome" text NOT NULL DEFAULT '',
	"categoria" text NOT NULL DEFAULT '',
	"mensagem" text NOT NULL DEFAULT '',
	"criar_lead_ao_responder" boolean DEFAULT true NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_rascunhos_empresa_usuario_unico" ON "whatsapp_rascunhos" USING btree ("empresa_id", "usuario_id");

ALTER TABLE "whatsapp_avulsos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_avulsos_tenant" ON "whatsapp_avulsos";
CREATE POLICY "whatsapp_avulsos_tenant" ON "whatsapp_avulsos"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
ALTER TABLE "whatsapp_rascunhos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_rascunhos_tenant" ON "whatsapp_rascunhos";
CREATE POLICY "whatsapp_rascunhos_tenant" ON "whatsapp_rascunhos"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
