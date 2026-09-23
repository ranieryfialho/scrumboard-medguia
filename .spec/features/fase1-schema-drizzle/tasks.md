# Tasks: Fase1 schema drizzle

> feature: fase1-schema-drizzle

## T-010 — Instalar e configurar Drizzle ORM + drizzle-kit [concluida]
- Refs: US-007
- Arquivos: package.json, package-lock.json, drizzle.config.ts, src/db/client.ts
- Notas: adiciona `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`; scripts npm
  `db:generate`/`db:migrate`; `DATABASE_URL` validada em `src/lib/env.ts`
  (já existe desde a fase0 — só adiciona a variável, não recria o arquivo).

## T-011 — Modelar tabelas de identidade/tenant e Better Auth [concluida]
- Refs: US-007, AC-015, AC-016, AC-018
- Arquivos: src/db/schema/identidade.ts, src/db/schema/auth.ts, src/db/schema/index.ts
- Notas: `empresas`, `empresa_configuracoes`, `usuarios` (UUID como chave,
  preparado para preservar os IDs do Supabase no ETL futuro),
  `empresas_usuarios`; tabelas do adaptador Drizzle do Better Auth (conta,
  sessão, token de verificação) — sem configurar a biblioteca em si.
- Depende de: T-010.

## T-012 — Modelar tabelas do pipeline [concluida]
- Refs: US-007, AC-015, AC-018
- Arquivos: src/db/schema/pipeline.ts
- Notas: `pipeline_etapas`, `pipeline_transicoes`, `motivos_perda`, `leads`,
  `oportunidades`, `cadencia_atividades`, `oportunidade_eventos`,
  `tarefas_agendadas`, `anexos`, `reunioes` — colunas e tipos conforme
  TDD-001 §4.3.
- Depende de: T-010.

## T-013 — Modelar tabelas de operação e as reescritas do modelo legado [concluida]
- Refs: US-007, AC-015, AC-018
- Arquivos: src/db/schema/operacao.ts, src/db/schema/legado.ts
- Notas: `cron_execucoes`, `importacoes`, `migracao_registros`;
  `whatsapp_mensagens`, `campanhas`, `envios_campanha` reescritas com
  `empresa_id` obrigatório.
- Depende de: T-010.

## T-014 — Gerar e versionar a migration inicial do schema [concluida]
- Refs: AC-015, AC-017
- Arquivos: drizzle/0000_schema_inicial.sql, drizzle/meta/_journal.json, drizzle/meta/0000_snapshot.json
- Depende de: T-011, T-012, T-013.

## T-015 — Migration de RLS (ativar + policy por tenant em toda tabela de negócio) [concluida]
- Refs: AC-019, AC-020
- Arquivos: drizzle/0001_rls.sql
- Notas: `ENABLE ROW LEVEL SECURITY` + policy `USING (empresa_id =
  current_setting('app.empresa_id')::uuid)` em cada tabela listada no AC-018;
  sem policy permissiva default (fail-closed).
- Depende de: T-014.

## T-016 — Migration das invariantes do pipeline (constraints + privilégios) [concluida]
- Refs: AC-021, AC-022, AC-023, AC-024, AC-025, AC-032
- Arquivos: drizzle/0002_constraints.sql
- Notas: `CHECK` condicionais por etapa (valor/motivo/próxima ação),
  `UNIQUE (oportunidade_id, sequencia)` + `CHECK` de intervalo,
  `REVOKE UPDATE, DELETE ON oportunidade_eventos FROM crm_app`; confirma que
  só `crm_migrator` tem `CREATE`/`ALTER`/`DROP` no schema `public`.
- Depende de: T-014.

## T-017 — Função SQL `mover_oportunidade` (transição + evento + lock otimista) [pendente]

- Refs: AC-026, AC-027
- Arquivos: drizzle/0003_fn_mover_oportunidade.sql
- Depende de: T-014, T-016.

## T-018 — Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia) [pendente]

- Refs: AC-028
- Arquivos: drizzle/0004_fn_concluir_atividade.sql
- Depende de: T-014, T-016.

## T-019 — Seeds idempotentes (etapas, grafo de transições, motivos de perda) [pendente]

- Refs: AC-029, AC-030, AC-031
- Arquivos: drizzle/0005_seeds.sql
- Notas: `INSERT ... ON CONFLICT DO NOTHING/UPDATE` — reaplicar não duplica
  (prova do AC-017 também passa por aqui).
- Depende de: T-014.

## T-020 — Harness de teste com Postgres efêmero (CI) [pendente]

- Refs: US-007
- Arquivos: test/support/postgres-efemero.ts
- Notas: sobe um container Postgres 15 via `docker run` (mesmo padrão da
  fase0), aplica `infra/postgres/init/01-databases-and-roles.sql` e as
  migrations desta feature, expõe conexões como `crm_migrator` e `crm_app`
  para os testes.
- Depende de: T-010.

## T-021 — Testes de schema e tenant obrigatório [pendente]

- Refs: AC-015, AC-016, AC-017, AC-018
- Arquivos: test/db/schema.test.ts
- Depende de: T-014, T-020.

## T-022 — Testes de RLS (isolamento por tenant) [pendente]

- Refs: AC-019, AC-020
- Arquivos: test/db/rls.test.ts
- Depende de: T-015, T-020.

## T-023 — Testes das invariantes (constraints) e dos privilégios de DDL [pendente]

- Refs: AC-021, AC-022, AC-023, AC-024, AC-025, AC-032
- Arquivos: test/db/constraints.test.ts
- Depende de: T-016, T-020.

## T-024 — Testes das funções SQL transacionais [pendente]

- Refs: AC-026, AC-027, AC-028
- Arquivos: test/db/funcoes.test.ts
- Depende de: T-017, T-018, T-020.

## T-025 — Testes dos seeds [pendente]

- Refs: AC-029, AC-030, AC-031
- Arquivos: test/db/seeds.test.ts
- Depende de: T-019, T-020.
