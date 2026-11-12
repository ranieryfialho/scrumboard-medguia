-- fase6-qualificacao-comercial (US-198): a qualificação comercial do card — seis critérios pontuados, três eliminatórios e o estágio
-- profissional; uma linha por oportunidade (a última avaliação). `score` e `faixa` são calculados pelo servidor e guardados para o
-- funil e a lista filtrarem sem refazer a conta. Escrita à mão, no estilo da 0037; RLS por tenant da 0001. Idempotente.

CREATE TABLE IF NOT EXISTS "oportunidade_qualificacao" (
	"oportunidade_id" uuid PRIMARY KEY NOT NULL REFERENCES "oportunidades"("id") ON DELETE CASCADE,
	"empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE CASCADE,
	"dor" smallint,
	"complexidade" smallint,
	"decisao" smallint,
	"gatilho" smallint,
	"abertura" smallint,
	"aderencia" smallint,
	"bloqueios" text[] DEFAULT '{}'::text[] NOT NULL,
	"estagio" text,
	"score" smallint NOT NULL,
	"faixa" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	CONSTRAINT "oportunidade_qualificacao_score_valido" CHECK ("score" BETWEEN 0 AND 100),
	CONSTRAINT "oportunidade_qualificacao_faixa_valida" CHECK ("faixa" IS NULL OR "faixa" IN ('A', 'B', 'C', 'baixo', 'revisao')),
	CONSTRAINT "oportunidade_qualificacao_estagio_valido" CHECK ("estagio" IS NULL OR "estagio" IN ('residente', 'inicio', 'operacao', 'crescimento', 'migracao'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oportunidade_qualificacao_empresa_faixa" ON "oportunidade_qualificacao" USING btree ("empresa_id", "faixa");

ALTER TABLE "oportunidade_qualificacao" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oportunidade_qualificacao_tenant" ON "oportunidade_qualificacao";
CREATE POLICY "oportunidade_qualificacao_tenant" ON "oportunidade_qualificacao"
  USING (empresa_id = current_setting('app.empresa_id')::uuid)
  WITH CHECK (empresa_id = current_setting('app.empresa_id')::uuid);
