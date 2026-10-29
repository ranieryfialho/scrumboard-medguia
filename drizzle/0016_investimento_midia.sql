-- T-224 (fase5-investimento-midia, US-147, ASM-217): investimento em mídia lançado à mão pela gestão,
-- um valor por empresa, mês (primeiro dia) e canal (a origem do lead, sem diferenciar maiúsculas).
-- Escrita à mão, no estilo da 0015. Isolamento por tenant como na 0001 (fail-closed: sem
-- `app.empresa_id` nada é lido ou gravado). O `GRANT` vem de ALTER DEFAULT PRIVILEGES (infra/postgres/init).

CREATE TABLE "investimento_midia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"mes" date NOT NULL,
	"canal" text NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investimento_midia_mes_dia_um" CHECK (extract(day from "mes") = 1),
	CONSTRAINT "investimento_midia_canal_valido" CHECK (char_length("canal") BETWEEN 2 AND 60 AND "canal" = btrim("canal")),
	CONSTRAINT "investimento_midia_valor_valido" CHECK ("valor" >= 0.01 AND "valor" <= 9999999.99)
);
--> statement-breakpoint
ALTER TABLE "investimento_midia" ADD CONSTRAINT "investimento_midia_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investimento_midia" ADD CONSTRAINT "investimento_midia_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investimento_midia_empresa_mes_canal_unico" ON "investimento_midia" USING btree ("empresa_id","mes",lower("canal"));

ALTER TABLE "investimento_midia" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "investimento_midia_tenant" ON "investimento_midia";
CREATE POLICY "investimento_midia_tenant" ON "investimento_midia"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
