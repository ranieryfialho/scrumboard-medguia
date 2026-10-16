-- T-094 (fase2b-fila-tarefas, US-060): coluna `liberada_em` e NOTIFY de fila
-- alterada — a base mecânica que a tela "Minhas tarefas" (T-095 em diante)
-- consome para distinguir atrasados e atualizar em tempo real.

-- AC-212/ASM-065: `liberada_em` é o instante em que o toque passou a existir
-- como pendente (bloco liberado) — base para "atrasado" = toque pendente
-- liberado num turno/dia anterior ao vigente. Toques futuros nascem sempre
-- no exato momento em que o bloco é gerado (iniciar_cadencia,
-- concluir_atividade_cadencia, virar_dia_cadencia — todas em 0011), então o
-- `DEFAULT now()` já captura corretamente esse instante sem precisar mexer
-- nas três funções; não há coluna nova para "o chamador escolher". Os toques
-- que já existem (antes desta migration) recebem `realizada_em` quando já
-- concluídos/cancelados (foram liberados no passado, antes de ganhar
-- resultado) ou, para os ainda `pendente`, o horário desta migration — é o
-- melhor valor disponível sem reconstruir histórico.
ALTER TABLE "cadencia_atividades" ADD COLUMN "liberada_em" timestamp with time zone;

UPDATE "cadencia_atividades" SET "liberada_em" = COALESCE("realizada_em", now());

ALTER TABLE "cadencia_atividades" ALTER COLUMN "liberada_em" SET NOT NULL;
ALTER TABLE "cadencia_atividades" ALTER COLUMN "liberada_em" SET DEFAULT now();

-- AC-217: todo INSERT (toque novo liberado) ou UPDATE (toque muda de
-- resultado — concluir, `conectou`, cancelamento em cadeia) em
-- `cadencia_atividades` dispara `pg_notify` no mesmo canal `oportunidade`
-- das migrations 0007/0008, com `tipo: 'cadencia.fila_alterada'` — mesmo
-- padrão de `tipo` discriminando o payload que `mensagem.recebida` já usa
-- (ASM-038/ASM-066: um canal só, sem processo novo). Só ids, nunca dado de
-- negócio (nome do lead, canal, tipo de toque) — o mesmo cuidado de
-- `mensagem.recebida` (Q-011). Como todas as escritas em
-- `cadencia_atividades` acontecem dentro de funções sem SECURITY DEFINER
-- (0004/0008/0011), o trigger herda a mesma transação da chamada: um
-- ROLLBACK depois do INSERT/UPDATE nunca entrega o NOTIFY (mesma garantia de
-- AC-111). Um bloco inteiro (3 toques) dispara o trigger 3 vezes com o
-- mesmo payload (só ids, sem sequência) — o próprio Postgres deduplica
-- NOTIFYs idênticos consecutivos da mesma transação, então chega só 1
-- evento por bloco liberado; a tela (T-097) recarrega a fila inteira a cada
-- evento recebido, então nem a deduplicação do Postgres nem disparos a mais
-- no mesmo instante duplicam ou perdem toque algum.
CREATE OR REPLACE FUNCTION notificar_cadencia_fila_alterada() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'oportunidade',
    jsonb_build_object(
      'tipo', 'cadencia.fila_alterada',
      'empresaId', NEW.empresa_id,
      'oportunidadeId', NEW.oportunidade_id
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cadencia_atividades_notificar_fila_alterada" ON "cadencia_atividades";
CREATE TRIGGER "cadencia_atividades_notificar_fila_alterada"
  AFTER INSERT OR UPDATE ON "cadencia_atividades"
  FOR EACH ROW
  EXECUTE FUNCTION notificar_cadencia_fila_alterada();
