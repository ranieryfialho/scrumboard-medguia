-- T-264 (fase5-email-disparo, US-171, ASM-263): o motivo curto de cada envio que não saiu (`RESEND_RECUSOU`,
-- `FALHA_DE_REDE`, `SEM_CHAVE_RESEND`, `INTERROMPIDO`) e o índice parcial dos pendentes, para o worker não varrer a
-- tabela inteira a cada ciclo. Os estados novos (`ENVIANDO`, `PAUSADO`, `DESCADASTRADO`) são texto, sem enum.

ALTER TABLE "envios_campanha" ADD COLUMN "erro" text;
--> statement-breakpoint
CREATE INDEX "envios_campanha_pendentes_idx" ON "envios_campanha" USING btree ("empresa_id", "campanha_id") WHERE "status" = 'PENDENTE';
