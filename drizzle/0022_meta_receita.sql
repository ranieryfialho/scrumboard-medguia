-- T-255 (fase5-meta-receita, US-168, ASM-252): a meta de receita mensal (`receita_mensal`, em reais) entra na mesma
-- tabela das metas em porcentagem. A coluna `valor` passa a `numeric(12,2)` (as porcentagens gravadas mantêm o valor) e
-- o limite do banco vira por chave: porcentagem de 0,1 a 100; receita de 0,01 a 99.999.999,99. Só aumenta o que aceita.
ALTER TABLE "empresa_metas" DROP CONSTRAINT "empresa_metas_valor_valido";--> statement-breakpoint
ALTER TABLE "empresa_metas" DROP CONSTRAINT "empresa_metas_chave_valida";--> statement-breakpoint
ALTER TABLE "empresa_metas" ALTER COLUMN "valor" TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "empresa_metas" ADD CONSTRAINT "empresa_metas_chave_valida" CHECK ("chave" IN ('taxa_conversao', 'taxa_presenca', 'taxa_entrega_email', 'taxa_abertura_email', 'taxa_cliques_email', 'receita_mensal'));--> statement-breakpoint
ALTER TABLE "empresa_metas" ADD CONSTRAINT "empresa_metas_valor_valido" CHECK (
  ("chave" = 'receita_mensal' AND "valor" >= 0.01 AND "valor" <= 99999999.99)
  OR ("chave" <> 'receita_mensal' AND "valor" >= 0.1 AND "valor" <= 100)
);
