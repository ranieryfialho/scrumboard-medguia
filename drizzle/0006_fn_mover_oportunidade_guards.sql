-- T-043 (fase2-kanban, US-031): estende `mover_oportunidade` (0003) para
-- gravar, na mesma transação/UPDATE que muda a etapa, os dados de guard que
-- a etapa de destino pode exigir (`valor`, `motivo_perda_id`,
-- `proxima_acao_em`) — AC-082. Quem decide SE esses dados são obrigatórios
-- para a etapa de destino é o domínio (`validarTransicao`, fase1-dominio-
-- pipeline) antes de chamar esta função; a função só grava o que recebeu.
--
-- Assinatura muda (3 parâmetros novos, `DEFAULT NULL`, ao final) — por isso
-- a função antiga é derrubada primeiro: `CREATE OR REPLACE` sozinho criaria
-- um overload novo em vez de estender a existente, e as duas chamadas
-- (6 argumentos vs. 9) coexistiriam de forma confusa. Todo argumento antigo
-- mantém posição e tipo, então nenhuma chamada existente (6 argumentos)
-- quebra: os 3 novos, ausentes, caem no `DEFAULT NULL` e o `COALESCE`
-- abaixo preserva o valor já gravado na coluna.
DROP FUNCTION IF EXISTS mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb);

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

  RETURN v_oportunidade;
END;
$$;

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb, numeric, uuid, timestamp with time zone) TO crm_app;
