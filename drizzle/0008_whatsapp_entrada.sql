-- T-066 (fase2c-whatsapp-entrada, US-039/040/041/042): idempotência de
-- mensagem, conexão automática que encerra a cadência e NOTIFY de mensagem
-- recebida. Sem SECURITY DEFINER em nenhuma função nova (mesmo raciocínio da
-- 0003/0004): tudo roda com os privilégios de quem chama (crm_app), então as
-- policies de RLS da migration 0001 continuam valendo normalmente para
-- qualquer SELECT/UPDATE/INSERT feito aqui dentro — inclusive dentro de
-- `registrar_conexao_whatsapp` (ASM-034).

-- AC-124 (idempotência): índice único parcial em (empresa_id,
-- evolution_message_id) — só quando o id não é nulo (ASM-037), porque a
-- Evolution nem sempre entrega um id de mensagem e esses casos nunca devem
-- colidir entre si. Uma segunda tentativa de INSERT com o mesmo id vira
-- violação de constraint; o repositório (T-068) absorve isso com
-- `ON CONFLICT ... DO NOTHING` e só segue para `registrar_conexao_whatsapp`
-- quando a inserção foi de fato nova.
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mensagens_empresa_evolution_message_id_unica"
  ON "whatsapp_mensagens" USING btree ("empresa_id", "evolution_message_id")
  WHERE "evolution_message_id" IS NOT NULL;

-- AC-133: toda mensagem `recebida` gravada (nunca as que ignoramos antes de
-- inserir, nem as retentativas que o índice único acima absorve) dispara
-- `pg_notify` no mesmo canal `oportunidade` da migration 0007, com `tipo`
-- distinguindo o evento (ASM-038) — só ids e o instante, nunca o texto da
-- mensagem nem o número (Q-011). Por nascer de um trigger AFTER INSERT, uma
-- linha que o `ON CONFLICT DO NOTHING` descartou nunca chega a disparar o
-- trigger — a mesma garantia "só na escrita nova" que a 0007 já tem para
-- `oportunidade.movida` (AC-134 é provado do lado do barramento, T-070).
CREATE OR REPLACE FUNCTION notificar_mensagem_whatsapp_recebida() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify(
    'oportunidade',
    jsonb_build_object(
      'tipo', 'mensagem.recebida',
      'empresaId', NEW.empresa_id,
      'leadId', NEW.lead_id,
      'mensagemId', NEW.id,
      'ocorridoEm', to_char(NEW.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "whatsapp_mensagens_notificar_recebida" ON "whatsapp_mensagens";
CREATE TRIGGER "whatsapp_mensagens_notificar_recebida"
  AFTER INSERT ON "whatsapp_mensagens"
  FOR EACH ROW
  WHEN (NEW.direcao = 'recebida')
  EXECUTE FUNCTION notificar_mensagem_whatsapp_recebida();

-- `mover_oportunidade` (0003/0006/0007) ganha o mesmo `tipo` no payload do
-- NOTIFY, agora que o canal `oportunidade` carrega dois tipos de evento
-- (ASM-038) — é o que permite o barramento (T-070) distinguir
-- `oportunidade.movida` de `mensagem.recebida` sem abrir um canal novo. A
-- assinatura não muda, então basta `CREATE OR REPLACE` (mesmo raciocínio da
-- 0007).
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

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION mover_oportunidade(uuid, integer, integer, uuid, ator_tipo, jsonb, numeric, uuid, timestamp with time zone) TO crm_app;

-- AC-127/AC-128/AC-129/AC-130/AC-132: `registrar_conexao_whatsapp` é a
-- conexão automática inteira numa função só (ASM-036). Não recebe `version`
-- nem a oportunidade: ela mesma relê e trava (`FOR UPDATE`) a oportunidade do
-- lead que está em cadência (etapas 2–4, `cadencia_encerrada_em` nulo —
-- Q-012) dentro da própria transação, então não existe janela em que um
-- "version desatualizado" possa ser passado de fora — é por isso que não há
-- 409 aqui (AC-132): se o card já saiu de 2–4 por qualquer motivo (outro
-- operador moveu, segunda mensagem já conectou — AC-130), a busca
-- simplesmente não encontra linha e a função devolve `false` sem tocar em
-- nada, em vez de levantar `CONFLITO_DE_VERSAO`.
--
-- Quando encontra, chama `mover_oportunidade` para a etapa 5 (Qualificando)
-- com `ator_tipo = sistema` e `ator_id` nulo (não há usuário humano agindo),
-- grava o evento append-only `conexao_whatsapp` com o `evolution_message_id`
-- no payload (AC-128), cancela as atividades de cadência pendentes — nenhuma
-- vira `conectou`, ao contrário de `concluir_atividade` (0004): aqui a
-- conexão não é um "toque" concluído, é a cadência inteira encerrada — e
-- preenche `cadencia_encerrada_em`. Tudo antes do `RETURN`, na mesma
-- transação da chamada (AC-131: se o chamador envolver o INSERT da mensagem
-- na mesma transação — T-068/T-069 — e algo falhar depois, o ROLLBACK desfaz
-- mensagem e conexão juntos).
CREATE OR REPLACE FUNCTION registrar_conexao_whatsapp(
  p_empresa_id uuid,
  p_lead_id uuid,
  p_evolution_message_id text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_oportunidade oportunidades;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_oportunidade
  FROM oportunidades
  WHERE empresa_id = p_empresa_id
    AND lead_id = p_lead_id
    AND etapa_id IN (2, 3, 4)
    AND cadencia_encerrada_em IS NULL
  ORDER BY criado_em DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM mover_oportunidade(
    v_oportunidade.id,
    v_oportunidade.version,
    5,
    NULL,
    'sistema',
    jsonb_build_object('evolutionMessageId', p_evolution_message_id)
  );

  UPDATE oportunidades
  SET cadencia_encerrada_em = now()
  WHERE id = v_oportunidade.id;

  UPDATE cadencia_atividades
  SET resultado = 'cancelada'
  WHERE oportunidade_id = v_oportunidade.id
    AND resultado = 'pendente';

  INSERT INTO oportunidade_eventos (
    empresa_id, oportunidade_id, tipo, ator_tipo, payload
  ) VALUES (
    v_oportunidade.empresa_id, v_oportunidade.id, 'conexao_whatsapp', 'sistema',
    jsonb_build_object('evolutionMessageId', p_evolution_message_id)
  );

  RETURN true;
END;
$$;

-- ALTER DEFAULT PRIVILEGES (infra/postgres/init/01-databases-and-roles.sql)
-- só cobre TABLES/SEQUENCES — funções precisam de GRANT explícito.
GRANT EXECUTE ON FUNCTION registrar_conexao_whatsapp(uuid, uuid, text) TO crm_app;
