-- T-240 (fase5-motivos-por-empresa, US-156, ASM-235 a ASM-237): motivo de perda com dono. `empresa_id`
-- vazio = motivo global (todos os que existem hoje continuam assim, sem tocar nos dados); preenchido =
-- motivo da empresa. O índice único global de `nome` é trocado por dois parciais: globais por nome
-- (sem diferenciar maiúsculas) e, por empresa, nome minúsculo — assim duas empresas podem ter o mesmo
-- nome e uma empresa não repete nome nem entre os seus. A tabela segue sem RLS (ASM-236): o filtro vem
-- das consultas e dos guards do servidor.

ALTER TABLE "motivos_perda" ADD COLUMN "empresa_id" uuid;--> statement-breakpoint
ALTER TABLE "motivos_perda" ADD CONSTRAINT "motivos_perda_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motivos_perda" ADD CONSTRAINT "motivos_perda_sistemico_e_global" CHECK (NOT "e_sistemico" OR "empresa_id" IS NULL);--> statement-breakpoint
DROP INDEX IF EXISTS "motivos_perda_nome_unico";--> statement-breakpoint
CREATE UNIQUE INDEX "motivos_perda_nome_global_unico" ON "motivos_perda" USING btree (lower("nome")) WHERE "empresa_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "motivos_perda_empresa_nome_unico" ON "motivos_perda" USING btree ("empresa_id", lower("nome")) WHERE "empresa_id" IS NOT NULL;
