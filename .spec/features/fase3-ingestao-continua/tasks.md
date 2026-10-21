# Tasks: Fase3 ingestao continua

> feature: fase3-ingestao-continua

## T-127 — Configuração do worker e validação das variáveis [concluida]
- Refs: AC-327, AC-320
- Arquivos: src/worker/config.ts, test/worker/config.spec.test.ts
- Notas: lê `DATABASE_URL`, `SUPABASE_LP_URL`, `SUPABASE_LP_SERVICE_KEY`, credenciais do Sheets e `WORKER_INTERVALO_IMPORT_MIN` (padrão 5, ASM-108); lista só os NOMES que faltam.

## T-128 — Ciclo de importação: trava, registro e isolamento de falhas [concluida]
- Refs: AC-318, AC-319, AC-321, AC-322, AC-324, AC-325
- Arquivos: src/worker/ciclo.ts, test/worker/ciclo.spec.test.ts
- Notas: `pg_try_advisory_lock` por origem (ASM-110); grava `cron_execucoes` e `importacoes` (ASM-111); chama `executarMigracaoSheets`/`executarMigracaoLp` sem decisões (ASM-107, ASM-109); erro sem segredos. Depende de T-127 só pelo tipo de configuração.

## T-129 — Verificação de saúde do worker [pendente]

- Refs: AC-323
- Arquivos: src/worker/saude.ts, test/worker/saude.spec.test.ts
- Notas: consulta `cron_execucoes`; saudável = sucesso nos últimos 2 intervalos; sai com código 0/1 para o healthcheck do compose.

## T-130 — Agendador e parada graciosa [pendente]

- Refs: AC-320, AC-326
- Arquivos: src/worker/index.ts, test/worker/index.spec.test.ts, package.json
- Notas: `node-cron` (ASM-112); SIGTERM espera o ciclo em andamento e sai 0. Depende de T-127, T-128.

## T-131 — Serviço crm-worker na composição [pendente]

- Refs: AC-328
- Arquivos: docker-compose.yml, docker-compose.staging.yml, test/worker/compose.spec.test.ts
- Notas: mesma imagem da aplicação, comando de entrada do worker, healthcheck de T-129. Depende de T-129, T-130.
