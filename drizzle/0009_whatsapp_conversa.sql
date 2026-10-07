-- T-071 (fase2c-whatsapp-conversa, US-046/US-047): telefones extras do lead
-- (ASM-043) e estado de leitura real das mensagens recebidas (ASM-044). O
-- bloco inicial (CREATE TABLE/ADD COLUMN/FKs/índice único) foi gerado por
-- `drizzle-kit generate` a partir do diff de src/db/schema/pipeline.ts e
-- src/db/schema/legado.ts; o resto (RLS, trigger de integridade, backfill e
-- índice parcial) é escrito à mão, no mesmo padrão das migrations 0001/0008.

CREATE TABLE "lead_telefones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"rotulo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "lida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_telefones" ADD CONSTRAINT "lead_telefones_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_telefones" ADD CONSTRAINT "lead_telefones_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_telefones_lead_numero_unica" ON "lead_telefones" USING btree ("lead_id","numero");

-- AC-164 (RLS): mesmo padrão de isolamento por tenant da migration 0001 —
-- fail-closed, sem `SET LOCAL app.empresa_id` nenhuma linha é lida/gravada.
ALTER TABLE "lead_telefones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_telefones_isolamento_tenant" ON "lead_telefones";
CREATE POLICY "lead_telefones_isolamento_tenant" ON "lead_telefones"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);

-- Nota do T-071: "garantir que lead e empresa batem" — RLS já impede que uma
-- linha de `lead_telefones` fique visível/gravável fora do tenant da sessão,
-- mas isso não impede, por si só, um INSERT com `empresa_id` da sessão
-- correta apontando para um `lead_id` de outro lead (ex.: bug no
-- repositório). Esta trigger fecha essa lacuna: sem SECURITY DEFINER, roda
-- com os privilégios de quem chama (mesmo raciocínio das triggers da
-- migration 0008), então a própria RLS de `leads` já filtra a busca pelo
-- tenant da sessão.
CREATE OR REPLACE FUNCTION verificar_lead_telefone_empresa() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM leads WHERE id = NEW.lead_id AND empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'LEAD_EMPRESA_DIVERGENTE: lead % não pertence à empresa %', NEW.lead_id, NEW.empresa_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "lead_telefones_verificar_empresa" ON "lead_telefones";
CREATE TRIGGER "lead_telefones_verificar_empresa"
  BEFORE INSERT ON "lead_telefones"
  FOR EACH ROW
  EXECUTE FUNCTION verificar_lead_telefone_empresa();

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION verificar_lead_telefone_empresa() TO crm_app;

-- AC-153: mensagens `recebida` já existentes antes desta migration nunca
-- devem virar "não lidas" na virada — ficam todas marcadas como lidas no
-- próprio instante em que já tinham sido criadas (ASM-044).
UPDATE "whatsapp_mensagens" SET "lida_em" = "criado_em"
  WHERE "direcao" = 'recebida' AND "lida_em" IS NULL;

-- Índice parcial das não lidas (T-076 vai agrupar por lead/número sobre
-- este subconjunto) — só as linhas que `/api/whatsapp/unread` de fato
-- precisa escanear.
CREATE INDEX IF NOT EXISTS "whatsapp_mensagens_recebidas_nao_lidas"
  ON "whatsapp_mensagens" USING btree ("empresa_id", "criado_em")
  WHERE "direcao" = 'recebida' AND "lida_em" IS NULL;
