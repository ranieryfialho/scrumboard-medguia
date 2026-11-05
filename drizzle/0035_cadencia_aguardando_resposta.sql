-- Cadência: o estado "aguardando resposta" de um toque de WhatsApp.
-- Depois de mandar a mensagem, a pessoa marca o toque como "aguardando resposta" (a mensagem saiu, o lead ainda não respondeu). O toque
-- continua `pendente` (a regra dos blocos e a virada de dia não mudam), mas enquanto `aguardando_ate` estiver no futuro ele sai das
-- filas de atraso e dos contadores. Vencido o prazo, o cron conclui o toque como `sem_resposta`; se o lead responde antes, a conexão
-- automática do WhatsApp leva o card a Qualificando e cancela o toque, como sempre.
ALTER TABLE "cadencia_atividades" ADD COLUMN IF NOT EXISTS "aguardando_desde" timestamp with time zone;
ALTER TABLE "cadencia_atividades" ADD COLUMN IF NOT EXISTS "aguardando_ate" timestamp with time zone;
ALTER TABLE "cadencia_atividades" DROP CONSTRAINT IF EXISTS "cadencia_atividades_aguardando_coerente";
ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_aguardando_coerente"
  CHECK (("aguardando_desde" IS NULL AND "aguardando_ate" IS NULL) OR ("aguardando_desde" IS NOT NULL AND "aguardando_ate" IS NOT NULL AND "aguardando_ate" > "aguardando_desde"));
-- O cron procura só os que ainda aguardam.
CREATE INDEX IF NOT EXISTS "cadencia_atividades_aguardando_ate" ON "cadencia_atividades" ("aguardando_ate") WHERE "resultado" = 'pendente' AND "aguardando_ate" IS NOT NULL;
