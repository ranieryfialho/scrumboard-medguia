-- T-219 (fase5-metas, US-144, ASM-211): metas dos indicadores cadastradas pela gestão, uma por
-- empresa e chave do catálogo (src/lib/metas/catalogo.ts). Escrita à mão, no estilo de 0014.
-- Isolamento por tenant como na 0001 (fail-closed: sem `app.empresa_id` nada é lido ou gravado).
-- O `GRANT` de tabela vem de ALTER DEFAULT PRIVILEGES (infra/postgres/init).

CREATE TABLE "empresa_metas" (
	"empresa_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"valor" numeric(4, 1) NOT NULL,
	"atualizado_por" uuid,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresa_metas_pkey" PRIMARY KEY ("empresa_id", "chave"),
	CONSTRAINT "empresa_metas_chave_valida" CHECK ("chave" IN ('taxa_conversao', 'taxa_presenca', 'taxa_entrega_email', 'taxa_abertura_email', 'taxa_cliques_email')),
	CONSTRAINT "empresa_metas_valor_valido" CHECK ("valor" >= 0.1 AND "valor" <= 100)
);
--> statement-breakpoint
ALTER TABLE "empresa_metas" ADD CONSTRAINT "empresa_metas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresa_metas" ADD CONSTRAINT "empresa_metas_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "empresa_metas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "empresa_metas_tenant" ON "empresa_metas";
CREATE POLICY "empresa_metas_tenant" ON "empresa_metas"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
