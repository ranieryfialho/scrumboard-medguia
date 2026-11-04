-- T-313 (fase4-pipeline, US-114): o "Fechamento de Clientes" — os dados que o sistema antigo pedia quando o card chegava ao
-- fechamento: a plataforma que o cliente usava antes, o que deixou a desejar nela, o que mais o interessou na MedGuia, o plano
-- escolhido, por onde conheceu e as observações do combinado. Uma linha por oportunidade, criada ao mover o card para
-- "Contrato (Ganho)" e editável depois no detalhe. Escrita à mão, no estilo da 0026; RLS por tenant da 0001. O GRANT vem de
-- ALTER DEFAULT PRIVILEGES.

CREATE TABLE "oportunidade_fechamento" (
	"oportunidade_id" uuid PRIMARY KEY NOT NULL REFERENCES "oportunidades"("id") ON DELETE CASCADE,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"plataforma_anterior" text NOT NULL,
	"deixou_a_desejar" text NOT NULL,
	"mais_interessou" text NOT NULL,
	"plano" text NOT NULL,
	"por_onde_conheceu" text NOT NULL,
	"observacoes" text NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"registrado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	CONSTRAINT "oportunidade_fechamento_textos_validos" CHECK (
		char_length("plataforma_anterior") BETWEEN 1 AND 200 AND char_length("deixou_a_desejar") BETWEEN 1 AND 200
		AND char_length("mais_interessou") BETWEEN 1 AND 500 AND char_length("plano") BETWEEN 1 AND 200
		AND char_length("por_onde_conheceu") BETWEEN 1 AND 200 AND char_length("observacoes") BETWEEN 1 AND 2000
	)
);

CREATE INDEX "oportunidade_fechamento_empresa_registrado" ON "oportunidade_fechamento" USING btree ("empresa_id", "registrado_em" DESC);

ALTER TABLE "oportunidade_fechamento" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oportunidade_fechamento_tenant" ON "oportunidade_fechamento";
CREATE POLICY "oportunidade_fechamento_tenant" ON "oportunidade_fechamento"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
