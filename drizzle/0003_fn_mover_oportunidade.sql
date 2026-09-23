-- T-017: função SQL `mover_oportunidade` — transição de etapa + evento
-- gravados na mesma transação, com lock otimista por `version` (AC-026,
-- AC-027).
--
-- Sem SECURITY DEFINER: a função roda com os privilégios de quem chama
-- (crm_app), então as policies de RLS da migration 0001 (`empresa_id =
-- current_setting('app.empresa_id')::uuid`) se aplicam normalmente ao
-- SELECT/UPDATE/INSERT feitos aqui dentro — o isolamento por tenant continua
-- garantido pelo banco, não pela função.
--
-- Lock otimista: o `SELECT ... FOR UPDATE` filtra por `id` e `version`
-- juntos. Se a version informada não bate (ou o id não existe/não é visível
-- pelo RLS), a busca não encontra linha nenhuma, a função levanta
-- `CONFLITO_DE_VERSAO` e nada é escrito (nem etapa, nem evento, nem version)
-- — o UPDATE e o INSERT só rodam depois desse ponto (AC-027). O `FOR UPDATE`
-- também fecha a janela de corrida: uma segunda chamada concorrente para a
-- mesma oportunidade espera esta transação terminar antes de reler a
-- version, em vez de correr em paralelo sobre o mesmo valor antigo.
CREATE FUNCTION mover_oportunidade(
  p_oportunidade_id uuid,
  p_version integer,
  p_etapa_destino_id integer,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_payload jsonb DEFAULT NULL
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

  RETURN v_oportunidade;
END;
$$;

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb) TO crm_app;
