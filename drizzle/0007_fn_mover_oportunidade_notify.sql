-- T-060 (fase2c-sse, US-037): emite `oportunidade.movida` via `pg_notify`
-- dentro da própria `mover_oportunidade` (0006), na mesma transação do
-- UPDATE/INSERT. Por nascer aqui dentro, a notificação só existe depois do
-- commit (AC-111: Postgres só entrega NOTIFY após o commit da transação que
-- o emitiu; um ROLLBACK depois da chamada simplesmente não entrega nada) e
-- nunca é emitida quando a função levanta `CONFLITO_DE_VERSAO`, porque a
-- exceção aborta a transação antes de chegar no `pg_notify` (AC-110). A
-- assinatura (9 argumentos) não muda — só o corpo ganha a notificação — por
-- isso aqui basta `CREATE OR REPLACE`, sem derrubar a função antes (ao
-- contrário da 0006, que mudou a assinatura).
--
-- O canal é único (`oportunidade`) para todos os tenants (ASM-029); o
-- filtro por `empresaId` acontece no servidor da aplicação (T-061), não
-- aqui. O payload leva só ids e o instante da transição — nunca nome do
-- lead, valor ou qualquer outro dado de negócio — e usa as mesmas chaves em
-- camelCase do contrato do TDD (`empresaId`, `oportunidadeId`,
-- `etapaOrigemId`, `etapaDestinoId`, `atorId`, `ocorridoEm`), já que esse
-- payload trafega para fora do banco como está.
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

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb, numeric, uuid, timestamp with time zone) TO crm_app;
