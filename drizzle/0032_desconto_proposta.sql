-- T-318 (fase4-analises, US-135): o desconto concedido na proposta, em porcentagem (0 a 100, duas casas), para o "desconto médio
-- concedido" do relatório comercial. Fica nos dados comerciais do card (`oportunidade_comercial`), junto de plano e condição especial.
-- Escrita à mão, no estilo da 0026; as policies e o GRANT da tabela já existem.

ALTER TABLE "oportunidade_comercial" ADD COLUMN "desconto_percentual" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "oportunidade_comercial" ADD CONSTRAINT "oportunidade_comercial_desconto_valido" CHECK ("desconto_percentual" IS NULL OR ("desconto_percentual" >= 0 AND "desconto_percentual" <= 100));
