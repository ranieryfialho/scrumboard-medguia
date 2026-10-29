-- T-235 (fase5-empresa-dados, US-153, ASM-228 a ASM-232): dados cadastrais, plano e cota de assentos
-- da empresa. Só acrescenta colunas anuláveis (as empresas existentes ficam em branco, ASM-230);
-- `assentos` vazio = sem limite (ASM-229). Escrita à mão, no estilo da 0016. `empresas` não tem RLS
-- por empresa (quem decide o acesso é a rota, só super admin).

ALTER TABLE "empresas" ADD COLUMN "razao_social" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "cep" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "logradouro" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "numero" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "complemento" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "bairro" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "cidade" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "plano" text;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "assentos" integer;--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_cnpj_14_digitos" CHECK ("cnpj" IS NULL OR "cnpj" ~ '^[0-9]{14}$');--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_cep_8_digitos" CHECK ("cep" IS NULL OR "cep" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_uf_valida" CHECK ("uf" IS NULL OR "uf" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_plano_valido" CHECK ("plano" IS NULL OR "plano" IN ('starter', 'clinica', 'enterprise'));--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_assentos_validos" CHECK ("assentos" IS NULL OR ("assentos" >= 1 AND "assentos" <= 9999));--> statement-breakpoint
CREATE UNIQUE INDEX "empresas_cnpj_unico" ON "empresas" USING btree ("cnpj") WHERE "cnpj" IS NOT NULL;
