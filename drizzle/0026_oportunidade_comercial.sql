-- T-289 (fase4-card-abas, US-114, AC-742): dados comerciais do card — os campos de "Dados da Proposta" (previsão de fechamento,
-- condição especial, plano) e de "Qualificação Técnica" (porte da clínica, prontuário legado, faturamento TISS, termo LGPD) da tela
-- de conversa. Uma linha por oportunidade, criada na primeira edição. Escrita à mão, no estilo da 0020; segue o isolamento por
-- tenant da 0001 (fail-closed). O `GRANT` vem de ALTER DEFAULT PRIVILEGES.

CREATE TABLE "oportunidade_comercial" (
	"oportunidade_id" uuid PRIMARY KEY NOT NULL,
	"empresa_id" uuid NOT NULL,
	"previsao_fechamento" date,
	"condicao_especial" text,
	"plano" text,
	"porte_clinica" text,
	"prontuario_legado" text,
	"faturamento_tiss" text,
	"termo_lgpd_validado" boolean DEFAULT false NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid,
	CONSTRAINT "oportunidade_comercial_textos_validos" CHECK (
		char_length(coalesce("condicao_especial", '')) <= 200 AND char_length(coalesce("plano", '')) <= 200
		AND char_length(coalesce("porte_clinica", '')) <= 200 AND char_length(coalesce("prontuario_legado", '')) <= 200
		AND char_length(coalesce("faturamento_tiss", '')) <= 200
	)
);
--> statement-breakpoint
ALTER TABLE "oportunidade_comercial" ADD CONSTRAINT "oportunidade_comercial_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_comercial" ADD CONSTRAINT "oportunidade_comercial_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_comercial" ADD CONSTRAINT "oportunidade_comercial_atualizado_por_usuarios_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "oportunidade_comercial" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oportunidade_comercial_tenant" ON "oportunidade_comercial";
CREATE POLICY "oportunidade_comercial_tenant" ON "oportunidade_comercial"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
