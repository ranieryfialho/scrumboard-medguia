-- T-168 (fase4-card-abas, US-112): nome original do anexo (AC-428) — escrita
-- à mão, mesmo estilo de 0011/0012 (o diário `drizzle/meta` só registra as
-- migrations geradas pelo drizzle-kit). Nula para os anexos já existentes
-- (ASM-142); a tela mostra "Anexo PDF — data" quando for nula (T-169/T-172).
-- Sem policy nova: a RLS de 0001 isola por `empresa_id` linha a linha, e não
-- depende de quais colunas a tabela tem.
ALTER TABLE "anexos" ADD COLUMN "nome" text;
