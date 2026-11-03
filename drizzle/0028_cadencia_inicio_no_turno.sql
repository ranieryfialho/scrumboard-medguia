-- T-295 (fase2b-cadencia, US-053, AC-756/AC-757): a cadência iniciada à tarde começa pelo bloco da tarde. Antes, `iniciar_cadencia` gerava
-- SEMPRE o bloco do dia 1 de manhã (sequências 1–3); quem iniciava depois das 13h não via nenhum toque naquele dia (a fila só mostra o
-- turno vigente) e, na manhã seguinte, os 3 toques apareciam como atrasados. Agora o primeiro bloco é o do turno em que a cadência foi
-- iniciada, e a hora em que ele passa a valer (`liberada_em`) acompanha o turno:
--   • dia útil, 8h–11h59      → manhã (sequências 1–3), liberada agora;
--   • dia útil, antes das 8h  → manhã, liberada hoje às 8h;
--   • dia útil, 12h–12h59     → tarde (sequências 4–6), liberada hoje às 13h;
--   • dia útil, 13h–17h59     → tarde (sequências 4–6), liberada agora;
--   • depois das 18h, fim de semana ou feriado → manhã, liberada às 8h do próximo dia útil.
-- Quando o primeiro bloco é o da tarde, os toques 1–3 não existem (a cadência tem 15 toques); o resto segue igual: concluir o bloco da
-- tarde não gera nada, e a virada de dia gera a manhã seguinte. O relógio entra por parâmetro (ASM-062): `p_agora` nulo mantém o
-- comportamento anterior (manhã, liberada agora), que os chamadores sem relógio — e os testes que já existiam — continuam usando.
-- A mesma regra existe em TypeScript (`primeiroBlocoDaCadencia`, src/domain/cadencia/inicio.ts), com teste de paridade.

DROP FUNCTION IF EXISTS iniciar_cadencia(uuid, integer, uuid, ator_tipo, jsonb);

CREATE OR REPLACE FUNCTION cadencia_primeiro_bloco(p_agora timestamp with time zone)
RETURNS TABLE(turno cadencia_turno, liberada_em timestamp with time zone)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_local timestamp := p_agora AT TIME ZONE 'America/Sao_Paulo';
  v_data date := v_local::date;
  v_hora integer := EXTRACT(HOUR FROM v_local)::integer;
BEGIN
  IF cadencia_pode_liberar(v_data) THEN
    IF v_hora >= 13 AND v_hora < 18 THEN
      RETURN QUERY SELECT 'tarde'::cadencia_turno, p_agora;
    ELSIF v_hora = 12 THEN
      RETURN QUERY SELECT 'tarde'::cadencia_turno, (v_data + time '13:00') AT TIME ZONE 'America/Sao_Paulo';
    ELSIF v_hora < 8 THEN
      RETURN QUERY SELECT 'manha'::cadencia_turno, (v_data + time '08:00') AT TIME ZONE 'America/Sao_Paulo';
    ELSIF v_hora < 12 THEN
      RETURN QUERY SELECT 'manha'::cadencia_turno, p_agora;
    END IF;
    IF v_hora < 18 THEN RETURN; END IF;
  END IF;

  -- depois das 18h, fim de semana ou feriado: 8h do próximo dia útil
  v_data := v_data + 1;
  WHILE NOT cadencia_pode_liberar(v_data) LOOP
    v_data := v_data + 1;
  END LOOP;
  RETURN QUERY SELECT 'manha'::cadencia_turno, (v_data + time '08:00') AT TIME ZONE 'America/Sao_Paulo';
END;
$$;

GRANT EXECUTE ON FUNCTION cadencia_primeiro_bloco(timestamp with time zone) TO crm_app;

CREATE OR REPLACE FUNCTION iniciar_cadencia(
  p_oportunidade_id uuid,
  p_version integer,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_payload jsonb DEFAULT NULL,
  p_agora timestamp with time zone DEFAULT NULL
) RETURNS oportunidades
LANGUAGE plpgsql
AS $$
DECLARE
  v_oportunidade oportunidades;
  v_turno cadencia_turno := 'manha';
  v_liberada_em timestamp with time zone := now();
BEGIN
  IF p_agora IS NOT NULL THEN
    SELECT b.turno, b.liberada_em INTO v_turno, v_liberada_em FROM cadencia_primeiro_bloco(p_agora) b;
  END IF;

  v_oportunidade := mover_oportunidade(p_oportunidade_id, p_version, 2, p_ator_id, p_ator_tipo, p_payload);

  UPDATE oportunidades
  SET cadencia_dia = 1,
      cadencia_turno = v_turno,
      cadencia_encerrada_em = NULL,
      atualizado_em = now()
  WHERE id = p_oportunidade_id
  RETURNING * INTO v_oportunidade;

  INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, liberada_em)
  SELECT v_oportunidade.id, v_oportunidade.empresa_id, sequencia, dia, turno, canal, tipo, v_liberada_em
  FROM cadencia_bloco(1, v_turno);

  INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload)
  VALUES (v_oportunidade.empresa_id, p_oportunidade_id, 'cadencia_iniciada', p_ator_id, p_ator_tipo, p_payload);

  RETURN v_oportunidade;
END;
$$;

GRANT EXECUTE ON FUNCTION iniciar_cadencia(uuid, integer, uuid, ator_tipo, jsonb, timestamp with time zone) TO crm_app;
