-- Card que vai para "Perdido" (etapa 14) encerra a cadência na mesma transação.
-- Antes, `cadencia_encerrada_em` ficava nulo: os toques pendentes continuavam na fila do turno, no resumo e nos atrasados, e o
-- `virar_dia_cadencia` ainda podia puxar o card perdido de volta para o 2º/3º dia. Agora `mover_oportunidade` preenche a coluna (sem
-- sobrescrever uma data já gravada) — vale para qualquer caminho que perca o card (arrastar, lote, arquivar). Reabrir (14 → 5) não
-- reinicia a cadência: o card volta para Qualificando com ela encerrada. Mesma assinatura da 0008, então basta CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION mover_oportunidade(
  p_oportunidade_id uuid,
  p_version integer,
  p_etapa_destino_id integer,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_payload jsonb DEFAULT NULL,
  p_valor numeric(12, 2) DEFAULT NULL,
  p_motivo_perda_id uuid DEFAULT NULL,
  p_proxima_acao_em timestamp with time zone DEFAULT NULL
) RETURNS oportunidades
LANGUAGE plpgsql
AS $$
DECLARE
  v_etapa_origem_id integer;
  v_oportunidade oportunidades;
BEGIN
  SELECT etapa_id INTO v_etapa_origem_id
  FROM oportunidades
  WHERE id = p_oportunidade_id AND version = p_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLITO_DE_VERSAO: oportunidade % não está na version %', p_oportunidade_id, p_version
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE oportunidades
  SET etapa_id = p_etapa_destino_id,
      version = version + 1,
      valor = COALESCE(p_valor, valor),
      motivo_perda_id = COALESCE(p_motivo_perda_id, motivo_perda_id),
      proxima_acao_em = COALESCE(p_proxima_acao_em, proxima_acao_em),
      cadencia_encerrada_em = CASE
        WHEN p_etapa_destino_id = 14 THEN COALESCE(cadencia_encerrada_em, now())
        ELSE cadencia_encerrada_em
      END,
      atualizado_em = now()
  WHERE id = p_oportunidade_id AND version = p_version
  RETURNING * INTO v_oportunidade;

  INSERT INTO oportunidade_eventos (
    empresa_id, oportunidade_id, tipo, etapa_origem_id, etapa_destino_id,
    ator_id, ator_tipo, payload
  ) VALUES (
    v_oportunidade.empresa_id, p_oportunidade_id, 'transicao_etapa',
    v_etapa_origem_id, p_etapa_destino_id, p_ator_id, p_ator_tipo, p_payload
  );

  PERFORM pg_notify(
    'oportunidade',
    jsonb_build_object(
      'tipo', 'oportunidade.movida',
      'empresaId', v_oportunidade.empresa_id,
      'oportunidadeId', p_oportunidade_id,
      'etapaOrigemId', v_etapa_origem_id,
      'etapaDestinoId', p_etapa_destino_id,
      'atorId', p_ator_id,
      'ocorridoEm', to_char(v_oportunidade.atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN v_oportunidade;
END;
$$;

GRANT EXECUTE ON FUNCTION mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb, numeric, uuid, timestamp with time zone) TO crm_app;

-- Cards que já estão em Perdido com a cadência aberta: encerra agora. Sem mexer em `version` nem em `atualizado_em` (não é uma ação da
-- pessoa); idempotente (só pega quem ainda está nulo).
UPDATE oportunidades
SET cadencia_encerrada_em = now()
WHERE etapa_id = 14 AND cadencia_encerrada_em IS NULL;
