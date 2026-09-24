-- T-018: função SQL `concluir_atividade` — grava o resultado do toque de
-- cadência e o efeito em cadeia na mesma transação (AC-028).
--
-- Sem SECURITY DEFINER (mesmo raciocínio da 0003_fn_mover_oportunidade.sql):
-- a função roda com os privilégios de quem chama (crm_app), então as
-- policies de RLS da migration 0001 continuam se aplicando normalmente a
-- todo SELECT/UPDATE/INSERT feito aqui dentro.
--
-- Só aceita 'sem_resposta' ou 'conectou' como resultado — os únicos valores
-- que fazem sentido para "concluir" um toque pendente ('pendente' é o
-- estado inicial, 'cancelada' é o efeito em cadeia, não uma entrada válida
-- para esta função).
--
-- O `SELECT ... FOR UPDATE ... WHERE resultado = 'pendente'` garante que só
-- uma atividade pendente pode ser concluída; se já foi concluída/cancelada
-- ou não existe (ou não é visível pelo RLS), a busca não encontra linha
-- nenhuma e a função rejeita sem escrever nada.
--
-- Efeito em cadeia (AC-028): quando o resultado é 'conectou', as demais
-- atividades pendentes da mesma oportunidade viram 'cancelada' — a
-- oportunidade conectou, não há mais sentido em tocar de novo — e o evento
-- gravado em `oportunidade_eventos` já é o "evento de conexão" exigido pelo
-- critério. Quando o resultado é 'sem_resposta', nenhuma atividade extra é
-- tocada aqui: a geração do próximo bloco de cadência (se o bloco atual se
-- completou) é responsabilidade do worker/domínio, fora desta função — o
-- que se prova aqui é apenas que nenhuma linha fica parcialmente escrita.
CREATE OR REPLACE FUNCTION concluir_atividade(
  p_atividade_id uuid,
  p_resultado cadencia_resultado,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_payload jsonb DEFAULT NULL
) RETURNS cadencia_atividades
LANGUAGE plpgsql
AS $$
DECLARE
  v_atividade cadencia_atividades;
  v_evento_tipo text;
BEGIN
  IF p_resultado NOT IN ('sem_resposta', 'conectou') THEN
    RAISE EXCEPTION 'RESULTADO_INVALIDO: concluir_atividade só aceita sem_resposta ou conectou, recebido %', p_resultado
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_atividade
  FROM cadencia_atividades
  WHERE id = p_atividade_id AND resultado = 'pendente'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATIVIDADE_NAO_PENDENTE: atividade % não está pendente (ou não é visível)', p_atividade_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE cadencia_atividades
  SET resultado = p_resultado,
      realizada_em = now(),
      realizada_por = p_ator_id
  WHERE id = p_atividade_id
  RETURNING * INTO v_atividade;

  v_evento_tipo := CASE p_resultado
    WHEN 'conectou' THEN 'cadencia_conectou'
    ELSE 'cadencia_sem_resposta'
  END;

  INSERT INTO oportunidade_eventos (
    empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload
  ) VALUES (
    v_atividade.empresa_id, v_atividade.oportunidade_id, v_evento_tipo,
    p_ator_id, p_ator_tipo, p_payload
  );

  IF p_resultado = 'conectou' THEN
    UPDATE cadencia_atividades
    SET resultado = 'cancelada'
    WHERE oportunidade_id = v_atividade.oportunidade_id
      AND resultado = 'pendente'
      AND id <> v_atividade.id;
  END IF;

  RETURN v_atividade;
END;
$$;

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION concluir_atividade(uuid, cadencia_resultado, uuid, ator_tipo, jsonb) TO crm_app;
