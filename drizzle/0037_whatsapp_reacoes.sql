-- Reações às mensagens do WhatsApp (o emoji embaixo do balão). No WhatsApp cada pessoa tem no máximo UMA reação por mensagem: trocar o emoji
-- substitui a anterior e tirar a reação a apaga. Por isso a chave é (mensagem, autor): `autor` = 'nos' (a empresa) ou 'contato' (o cliente).
-- Escrita à mão, no estilo da 0030; RLS por tenant da 0001. Idempotente (IF NOT EXISTS): pode rodar de novo sem erro.

CREATE TABLE IF NOT EXISTS "whatsapp_reacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"mensagem_id" uuid NOT NULL REFERENCES "whatsapp_mensagens"("id") ON DELETE CASCADE,
	"autor" text NOT NULL,
	"emoji" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_reacoes_autor_valido" CHECK ("autor" IN ('nos', 'contato')),
	CONSTRAINT "whatsapp_reacoes_emoji_preenchido" CHECK (length("emoji") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_reacoes_mensagem_autor_unico" ON "whatsapp_reacoes" USING btree ("mensagem_id", "autor");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_reacoes_empresa" ON "whatsapp_reacoes" USING btree ("empresa_id");

ALTER TABLE "whatsapp_reacoes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_reacoes_tenant" ON "whatsapp_reacoes";
CREATE POLICY "whatsapp_reacoes_tenant" ON "whatsapp_reacoes"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
