-- T-016: invariantes do pipeline garantidas pelo banco (constraints) e
-- privilégios de runtime (AC-021, AC-022, AC-023, AC-024, AC-025, AC-032).
--
-- Os IDs de etapa usados abaixo são os do seed imutável de `pipeline_etapas`
-- (TDD-001 §4.4, seed em T-019): 7 = Follow de longo prazo, 11 = Proposta,
-- 12 = Teste (Trial), 13 = Negociação, 14 = Perdido. CHECK não aceita
-- subquery contra outra tabela, por isso os IDs são literais aqui — mudar
-- uma etapa é migration nova, nunca edição de linha (TDD-001 §4.8).

-- AC-021: card em `Proposta` (11) exige valor > 0.
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_proposta_exige_valor"
  CHECK (etapa_id <> 11 OR (valor IS NOT NULL AND valor > 0));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AC-022: card em `Perdido` (14) exige motivo.
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_perdido_exige_motivo"
  CHECK (etapa_id <> 14 OR motivo_perda_id IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AC-023: etapas de acompanhamento (Follow=7, Proposta=11, Teste=12,
-- Negociação=13) exigem próxima ação futura.
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_acompanhamento_exige_proxima_acao"
  CHECK (etapa_id NOT IN (7, 11, 12, 13) OR (proxima_acao_em IS NOT NULL AND proxima_acao_em > now()));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AC-024: sequência de cadência 1–18, dia 1–3 (a unicidade por oportunidade
-- já é o UNIQUE INDEX `cadencia_atividades_oportunidade_sequencia_unica` da
-- migration 0000).
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_sequencia_intervalo"
  CHECK (sequencia BETWEEN 1 AND 18);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_dia_intervalo"
  CHECK (dia BETWEEN 1 AND 3);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AC-025: log de eventos é append-only para a aplicação — crm_app perde
-- UPDATE/DELETE (o GRANT default do infra/postgres/init/01-databases-and-roles.sql
-- concede as duas na criação da tabela; aqui revogamos explicitamente).
REVOKE UPDATE, DELETE ON "oportunidade_eventos" FROM crm_app;

-- AC-032: confirma que crm_app não tem DDL no schema public. A role já nasce
-- sem CREATE em infra/postgres/init/01-databases-and-roles.sql (só
-- crm_migrator recebe USAGE, CREATE); este REVOKE é redundante por
-- construção e serve só para tornar a invariante explícita nesta migration.
REVOKE CREATE ON SCHEMA public FROM crm_app;
