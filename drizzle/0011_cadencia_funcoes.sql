-- T-089 (fase2b-cadencia, US-053/US-054/US-055): funções SQL do motor de
-- cadência — `iniciar_cadencia`, `concluir_atividade_cadencia` e
-- `virar_dia_cadencia` (AC-190, AC-193, AC-194, AC-195, AC-196, AC-197,
-- AC-199, AC-200, AC-201, AC-203).
--
-- Sem SECURITY DEFINER (mesmo raciocínio de 0003/0004): as três funções —
-- e os dois helpers puros abaixo — rodam com os privilégios de quem chama
-- (crm_app), então as policies de RLS da migration 0001 continuam valendo
-- normalmente para todo SELECT/UPDATE/INSERT feito aqui dentro. É assim que
-- AC-203 (cada empresa só vê e vira os próprios cards) se sustenta: nenhuma
-- das três funções consulta ou escreve fora do `empresa_id` corrente
-- (`current_setting('app.empresa_id')`) — o isolamento é garantia do banco,
-- não de um filtro manual dentro da função. `virar_dia_cadencia` roda contra
-- UM tenant por chamada (quem já está em `app.empresa_id`); varrer todas as
-- empresas ativas, cada uma na sua própria transação, é responsabilidade do
-- repositório (T-090), não desta função.
--
-- Nenhuma das três checa `pipeline_transicoes` — essa tabela é consultada
-- pelo domínio da aplicação antes de chamar a função (mesmo contrato de
-- `mover_oportunidade` desde a 0003); aqui a etapa de destino de cada
-- transição de cadência é sempre a mesma (hardcoded), porque é a cadência
-- quem decide, não uma escolha livre do chamador.
--
-- `cadencia_bloco` replica em SQL a matriz canônica de 18 toques de
-- src/domain/cadencia/matriz.ts (`blocoDe`, T-088) — a mesma regra pura
-- precisa existir nos dois lados porque o domínio TS não roda dentro do
-- Postgres. `test/db/cadencia-funcoes.test.ts` tem um teste de paridade que
-- compara, para os 6 blocos possíveis, a saída desta função com a de
-- `blocoDe`; qualquer divergência futura (ex.: alguém muda só um dos dois
-- lados) quebra esse teste. `cadencia_pode_liberar` replica, da mesma forma,
-- `podeLiberar` de src/domain/cadencia/feriados.ts (fim de semana + lista
-- fixa de feriados nacionais 2026/2027, ASM-057) — usada só por
-- `virar_dia_cadencia` para a guarda de AC-200.
CREATE OR REPLACE FUNCTION cadencia_bloco(p_dia integer, p_turno cadencia_turno)
RETURNS TABLE(sequencia integer, dia integer, turno cadencia_turno, canal cadencia_canal, tipo cadencia_tipo)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    ((p_dia - 1) * 2 + CASE WHEN p_turno = 'tarde' THEN 1 ELSE 0 END) * 3 + posicao + 1 AS sequencia,
    p_dia AS dia,
    p_turno AS turno,
    CASE WHEN posicao = 2 THEN 'whatsapp' ELSE 'telefone' END::cadencia_canal AS canal,
    CASE
      WHEN posicao = 2 AND p_dia = 3 AND p_turno = 'tarde' THEN 'breakup'
      WHEN posicao = 2 THEN 'mensagem'
      ELSE 'ligacao'
    END::cadencia_tipo AS tipo
  FROM generate_series(0, 2) AS posicao
  ORDER BY posicao;
$$;

GRANT EXECUTE ON FUNCTION cadencia_bloco(integer, cadencia_turno) TO crm_app;

CREATE OR REPLACE FUNCTION cadencia_pode_liberar(p_data date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  -- ISODOW: segunda=1 .. domingo=7 — sábado/domingo pausam a cadência.
  SELECT EXTRACT(ISODOW FROM p_data) NOT IN (6, 7)
    AND p_data NOT IN (
      '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07',
      '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
      '2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-09-07',
      '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25'
    );
$$;

GRANT EXECUTE ON FUNCTION cadencia_pode_liberar(date) TO crm_app;

-- AC-190: move o card para `1º dia de contato` (etapa 2 do seed de T-019) via
-- `mover_oportunidade` — reaproveitado para não duplicar a escrita de etapa
-- nem o lock otimista por `version`/evento `transicao_etapa` — e gera
-- somente o bloco de dia 1/manhã (sequências 1–3); os toques 4–18 só nascem
-- mais tarde, bloco a bloco, por `concluir_atividade_cadencia` e
-- `virar_dia_cadencia`. `cadencia_dia`/`cadencia_turno` em `oportunidades`
-- (colunas já existentes desde o schema inicial) passam a apontar para o
-- bloco corrente liberado — é esse ponteiro que as outras duas funções leem
-- para decidir o que pode ser concluído (AC-196) e o que vira na virada de
-- dia (AC-199).
CREATE OR REPLACE FUNCTION iniciar_cadencia(
  p_oportunidade_id uuid,
  p_version integer,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_payload jsonb DEFAULT NULL
) RETURNS oportunidades
LANGUAGE plpgsql
AS $$
DECLARE
  v_oportunidade oportunidades;
BEGIN
  v_oportunidade := mover_oportunidade(p_oportunidade_id, p_version, 2, p_ator_id, p_ator_tipo, p_payload);

  UPDATE oportunidades
  SET cadencia_dia = 1,
      cadencia_turno = 'manha',
      cadencia_encerrada_em = NULL,
      atualizado_em = now()
  WHERE id = p_oportunidade_id
  RETURNING * INTO v_oportunidade;

  INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
  SELECT v_oportunidade.id, v_oportunidade.empresa_id, sequencia, dia, turno, canal, tipo
  FROM cadencia_bloco(1, 'manha');

  INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload)
  VALUES (v_oportunidade.empresa_id, p_oportunidade_id, 'cadencia_iniciada', p_ator_id, p_ator_tipo, p_payload);

  RETURN v_oportunidade;
END;
$$;

GRANT EXECUTE ON FUNCTION iniciar_cadencia(uuid, integer, uuid, ator_tipo, jsonb) TO crm_app;

-- AC-193/AC-194/AC-195/AC-196/AC-197/AC-201: concluir um toque é o único
-- ponto de escrita de `cadencia_atividades.resultado`, e tudo que decorre
-- disso (cancelamento em cadeia, geração do próximo bloco, transição de
-- etapa) acontece na mesma transação.
--
-- Trava a atividade e, via ela, a oportunidade (`FOR UPDATE` nas duas,
-- mesmo padrão de lock otimista por `version` de `mover_oportunidade`) antes
-- de validar qualquer coisa — isso fecha a janela de corrida de duas
-- conclusões concorrentes do mesmo toque ou de dois toques do mesmo card.
--
-- Guardas, nesta ordem (AC-196/AC-197): (1) cadência já encerrada ou toque
-- que não está `pendente` → `CADENCIA_ENCERRADA`; (2) o `(dia, turno)` do
-- toque não é o bloco corrente apontado por
-- `oportunidades.cadencia_dia/cadencia_turno` → `BLOCO_ANTERIOR_PENDENTE`
-- (só acontece se alguma atividade foi inserida fora do fluxo desta função —
-- nela, o ponteiro e o bloco gerado sempre nascem juntos, atomicamente); (3)
-- bloco da tarde antes das 13h em `America/Sao_Paulo` (`p_agora`, relógio
-- injetado — ASM-062, nunca `now()` direto num ponto que decida regra de
-- negócio) → `TURNO_NAO_LIBERADO`.
--
-- `conectou` (AC-195): cancela as demais atividades pendentes do card,
-- preenche `cadencia_encerrada_em` e chama `mover_oportunidade` para
-- `Qualificando` (etapa 5) — sem gerar bloco novo, sem olhar se o bloco
-- "terminou".
--
-- `sem_resposta`: só dispara efeito em cadeia quando o bloco do próprio
-- toque (mesmo `dia`+`turno`) fica com zero pendentes depois desta
-- conclusão. Bloco de manhã completo → gera o bloco da tarde do mesmo dia
-- (AC-194) e avança o ponteiro para `tarde` (ele só fica *visível* na fila a
-- partir das 13h — AC-192 — mas isso é filtro da fila/rota, não desta
-- função). Bloco da tarde completo e dia < 3 → não gera nada: o próximo
-- bloco só nasce na virada de dia (`virar_dia_cadencia`, AC-199). Bloco da
-- tarde completo no dia 3 (toque 18, breakup) → os 18 toques se esgotaram
-- sem conexão: `Perdido` (etapa 14) com o motivo sistêmico "Cadência
-- esgotada" (semeado em 0005), `cadencia_encerrada_em` preenchido e o evento
-- `cadencia_esgotada` gravado com `ator_tipo = 'sistema'` (AC-201) — mesmo
-- quando quem concluiu o toque 18 foi um usuário: a decisão de encerrar e
-- perder o card é automática, não da pessoa que tocou. O payload desse
-- evento carrega `ofertaRevisitaDisponivel: true` — a oferta em si (criar
-- `tarefa_agendada` em 30–60 dias) é sinalizada aqui; criá-la de fato é
-- fora de escopo desta feature.
CREATE OR REPLACE FUNCTION concluir_atividade_cadencia(
  p_atividade_id uuid,
  p_version integer,
  p_resultado cadencia_resultado,
  p_ator_id uuid,
  p_ator_tipo ator_tipo,
  p_agora timestamp with time zone DEFAULT now(),
  p_payload jsonb DEFAULT NULL
) RETURNS cadencia_atividades
LANGUAGE plpgsql
AS $$
DECLARE
  v_atividade cadencia_atividades;
  v_oportunidade oportunidades;
  v_hora_sp integer;
  v_pendentes_no_bloco integer;
  v_motivo_cadencia_esgotada_id uuid;
BEGIN
  IF p_resultado NOT IN ('sem_resposta', 'conectou') THEN
    RAISE EXCEPTION 'RESULTADO_INVALIDO: concluir_atividade_cadencia só aceita sem_resposta ou conectou, recebido %', p_resultado
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_atividade FROM cadencia_atividades WHERE id = p_atividade_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATIVIDADE_NAO_ENCONTRADA: atividade % não encontrada (ou não visível)', p_atividade_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_oportunidade
  FROM oportunidades
  WHERE id = v_atividade.oportunidade_id AND version = p_version
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLITO_DE_VERSAO: oportunidade % não está na version %', v_atividade.oportunidade_id, p_version
      USING ERRCODE = 'P0001';
  END IF;

  IF v_oportunidade.cadencia_encerrada_em IS NOT NULL OR v_atividade.resultado <> 'pendente' THEN
    RAISE EXCEPTION 'CADENCIA_ENCERRADA: atividade % não pode ser concluída (cadência encerrada ou toque não está mais pendente)', p_atividade_id
      USING ERRCODE = 'P0001';
  END IF;

  IF (v_atividade.dia, v_atividade.turno) IS DISTINCT FROM (v_oportunidade.cadencia_dia, v_oportunidade.cadencia_turno) THEN
    RAISE EXCEPTION 'BLOCO_ANTERIOR_PENDENTE: bloco do toque % ainda não é o bloco corrente liberado da oportunidade', p_atividade_id
      USING ERRCODE = 'P0001';
  END IF;

  v_hora_sp := EXTRACT(HOUR FROM (p_agora AT TIME ZONE 'America/Sao_Paulo'))::integer;
  IF v_atividade.turno = 'tarde' AND v_hora_sp < 13 THEN
    RAISE EXCEPTION 'TURNO_NAO_LIBERADO: bloco da tarde só libera a partir das 13h em America/Sao_Paulo'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE cadencia_atividades
  SET resultado = p_resultado,
      realizada_em = p_agora,
      realizada_por = p_ator_id
  WHERE id = p_atividade_id
  RETURNING * INTO v_atividade;

  INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload)
  VALUES (
    v_atividade.empresa_id, v_atividade.oportunidade_id, 'atividade_concluida', p_ator_id, p_ator_tipo,
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('atividadeId', v_atividade.id, 'resultado', p_resultado)
  );

  IF p_resultado = 'conectou' THEN
    UPDATE cadencia_atividades
    SET resultado = 'cancelada'
    WHERE oportunidade_id = v_atividade.oportunidade_id AND resultado = 'pendente';

    UPDATE oportunidades
    SET cadencia_encerrada_em = p_agora, atualizado_em = now()
    WHERE id = v_oportunidade.id;

    PERFORM mover_oportunidade(v_oportunidade.id, v_oportunidade.version, 5, p_ator_id, p_ator_tipo, p_payload);

    RETURN v_atividade;
  END IF;

  -- sem_resposta: só dispara efeito em cadeia se o bloco do próprio toque
  -- (dia+turno) acabou de ficar com zero pendentes.
  SELECT count(*) INTO v_pendentes_no_bloco
  FROM cadencia_atividades
  WHERE oportunidade_id = v_atividade.oportunidade_id
    AND dia = v_atividade.dia
    AND turno = v_atividade.turno
    AND resultado = 'pendente';

  IF v_pendentes_no_bloco > 0 THEN
    RETURN v_atividade;
  END IF;

  IF v_atividade.turno = 'manha' THEN
    INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
    SELECT v_atividade.oportunidade_id, v_atividade.empresa_id, sequencia, dia, turno, canal, tipo
    FROM cadencia_bloco(v_atividade.dia, 'tarde');

    UPDATE oportunidades
    SET cadencia_turno = 'tarde', atualizado_em = now()
    WHERE id = v_oportunidade.id;

    RETURN v_atividade;
  END IF;

  -- turno = 'tarde': os dois blocos do dia terminaram.
  IF v_atividade.dia < 3 THEN
    -- dia 1 ou 2: o bloco da manhã seguinte só nasce na virada de dia.
    RETURN v_atividade;
  END IF;

  -- dia 3 / tarde concluído (toque 18, breakup): 18 toques esgotados sem
  -- conexão -> Perdido.
  UPDATE oportunidades
  SET cadencia_encerrada_em = p_agora, atualizado_em = now()
  WHERE id = v_oportunidade.id;

  SELECT id INTO v_motivo_cadencia_esgotada_id FROM motivos_perda WHERE nome = 'Cadência esgotada';

  INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload)
  VALUES (
    v_atividade.empresa_id, v_atividade.oportunidade_id, 'cadencia_esgotada', NULL, 'sistema',
    jsonb_build_object('ofertaRevisitaDisponivel', true)
  );

  PERFORM mover_oportunidade(
    v_oportunidade.id, v_oportunidade.version, 14, NULL, 'sistema', NULL, NULL, v_motivo_cadencia_esgotada_id, NULL
  );

  RETURN v_atividade;
END;
$$;

GRANT EXECUTE ON FUNCTION concluir_atividade_cadencia(uuid, integer, cadencia_resultado, uuid, ator_tipo, timestamp with time zone, jsonb) TO crm_app;

-- AC-199/AC-200/AC-203: job diário de virada de dia. Roda contra o tenant
-- corrente (`app.empresa_id`, via RLS — AC-203); varrer todas as empresas
-- ativas é trabalho do repositório (T-090), chamando esta função uma vez por
-- tenant.
--
-- AC-200: se a data em `America/Sao_Paulo` (derivada do relógio injetado
-- `p_agora`, ASM-062) não é dia útil (`cadencia_pode_liberar`), a função
-- devolve zero linhas sem tocar em nada — nenhum card muda de dia, nenhum
-- bloco é gerado. Quem grava a execução em `cron_execucoes` é a rota
-- interna (T-093): esta função só precisa ser um no-op limpo nesse caso.
--
-- AC-199: avança só as oportunidades em cadência (`cadencia_dia` não nulo,
-- `cadencia_encerrada_em` nulo) cujo card não tem nenhum toque `pendente` —
-- ou seja, os dois blocos (manhã e tarde) do dia corrente já foram
-- concluídos. Como `concluir_atividade_cadencia` gera o bloco da tarde no
-- instante em que o da manhã fecha (AC-194), "zero pendentes" só acontece
-- quando o dia inteiro terminou; nunca no meio do caminho. Cards com toque
-- pendente não entram no `SELECT` e portanto não mudam — ficam "atrasados"
-- (ASM-059, estado derivado, sem coluna nova).
--
-- Cada avanço chama `mover_oportunidade` para a etapa seguinte (2→3→4 —
-- "1º/2º/3º dia de contato", mesmo mapeamento `cadencia_dia + 1` do seed de
-- T-019) com `ator_tipo = 'sistema'` — é a virada do job, não uma pessoa —
-- gera o bloco de manhã do novo dia e grava o evento `cadencia_dia_avancado`
-- (ASM-060), ao lado do `transicao_etapa` que `mover_oportunidade` já grava.
-- `dia < 3` na guarda é defensivo: um card no dia 3 com zero pendentes já
-- foi roteado para `Perdido` por `concluir_atividade_cadencia` no próprio
-- toque 18 (AC-201), então nunca deveria chegar aqui, mas a condição deixa a
-- invariante explícita em vez de depender só disso.
CREATE OR REPLACE FUNCTION virar_dia_cadencia(
  p_agora timestamp with time zone DEFAULT now()
) RETURNS SETOF oportunidades
LANGUAGE plpgsql
AS $$
DECLARE
  v_data_sp date;
  v_oportunidade oportunidades;
  v_dia_novo integer;
BEGIN
  v_data_sp := (p_agora AT TIME ZONE 'America/Sao_Paulo')::date;

  IF NOT cadencia_pode_liberar(v_data_sp) THEN
    RETURN;
  END IF;

  FOR v_oportunidade IN
    SELECT o.*
    FROM oportunidades o
    WHERE o.cadencia_dia IS NOT NULL
      AND o.cadencia_dia < 3
      AND o.cadencia_encerrada_em IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cadencia_atividades a
        WHERE a.oportunidade_id = o.id AND a.resultado = 'pendente'
      )
    FOR UPDATE
  LOOP
    v_dia_novo := v_oportunidade.cadencia_dia + 1;

    PERFORM mover_oportunidade(v_oportunidade.id, v_oportunidade.version, v_dia_novo + 1, NULL, 'sistema', NULL);

    UPDATE oportunidades
    SET cadencia_dia = v_dia_novo, cadencia_turno = 'manha', atualizado_em = now()
    WHERE id = v_oportunidade.id
    RETURNING * INTO v_oportunidade;

    INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
    SELECT v_oportunidade.id, v_oportunidade.empresa_id, sequencia, dia, turno, canal, tipo
    FROM cadencia_bloco(v_dia_novo, 'manha');

    INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, ator_id, ator_tipo, payload)
    VALUES (
      v_oportunidade.empresa_id, v_oportunidade.id, 'cadencia_dia_avancado', NULL, 'sistema',
      jsonb_build_object('diaNovo', v_dia_novo)
    );

    RETURN NEXT v_oportunidade;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION virar_dia_cadencia(timestamp with time zone) TO crm_app;
