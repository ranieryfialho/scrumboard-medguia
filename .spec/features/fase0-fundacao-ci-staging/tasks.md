# Tasks: Fase 0 — Fundação (CI, imagem versionada, staging, backup, observabilidade)

> feature: fase0-fundacao-ci-staging

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - Toda tarefa referencia em `Refs:` pelo menos uma história de usuário
    (US-xxx) ou critério de aceite (AC-xxx).
  - Toda tarefa lista os arquivos que cria/altera em `Arquivos:` — capriche:
    é o que decide o que `onp-spec plano` roda em PARALELO (arquivos
    disjuntos) e o que roda em sequência.
  - Campos opcionais por tarefa, usados pelo plano de execução:
    `- Modelo: claude-sonnet-5` e `- Esforço: alto` (baixo|medio|alto|xalto|max).
  - Uma tarefa só pode virar [concluida] quando os critérios de aceite dela
    tiverem prova PASS registrada por `onp-spec verify`.
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)
-->

## T-001 — Migrar runner de testes para Vitest [concluida]
- Refs: US-001
- Arquivos: package.json, vitest.config.ts, onpspec.config.json
- Esforço: baixo
- Notas: Resolve ASM-002 (RFC-001 Q6). Troca `testCommand`/`reporter` do
  `onpspec.config.json` para `vitest run` com reporter compatível
  (json/tap). Pré-requisito das demais tarefas que escrevem teste.

## T-002 — CI com gates (lint → typecheck → test → build) [concluida]
- Refs: US-001, AC-001, AC-002
- Arquivos: .github/workflows/ci.yml, package.json
- Esforço: medio
- Notas: Depende de T-001 (script `test` precisa já rodar Vitest). Roda em
  `pull_request` e em `push` na `main`. Nenhum step de gate com
  `continue-on-error`.

## T-003 — Workflow de release: build e publish no GHCR por tag SHA [concluida]
- Refs: US-002, AC-003
- Arquivos: .github/workflows/release.yml
- Esforço: medio
- Notas: Build acontece só no GitHub Actions, nunca na VPS. Tag da imagem é
  o SHA do commit (nunca `latest`).

## T-004 — Deploy por pull de imagem + rollback por tag [concluida]
- Refs: US-002, AC-004
- Arquivos: .github/workflows/deploy.yml, docker-compose.yml
- Esforço: medio
- Notas: Continua `workflow_dispatch` (trava tática já aplicada nesta
  conversa — ver ASM-005). Recebe a tag da imagem como input manual; a VPS
  só executa `docker compose pull && up -d`, nunca `build`. Depende de T-003
  existir (precisa haver imagem publicada para puxar).

## T-005 — Databases crm_prod/crm_staging e roles crm_app/crm_migrator [concluida]
- Refs: US-003, US-004, AC-005, AC-007, AC-008, AC-009
- Arquivos: infra/postgres/init/01-databases-and-roles.sql, docker-compose.yml
- Esforço: alto
- Notas: `crm_app` sem `SUPERUSER`/`BYPASSRLS`/DDL; `crm_migrator` é a única
  role com DDL. Nenhum `ports:` publica 5432. Teste de integração roda
  contra um Postgres real (service container no CI) aplicando este script e
  tentando as operações vedadas com a role `crm_app`.

## T-006 — Topologia de staging atrás do proxy, sem porta nova exposta [concluida]
- Refs: US-003, AC-006
- Arquivos: docker-compose.yml, docker-compose.staging.yml
- Esforço: baixo
- Notas: Depende de T-005 (staging aponta para `crm_staging`). Serviço
  `crm-app` de staging fica na mesma rede `wp-network`, roteado pelo
  nginx-proxy-manager existente — sem novo `ports:` publicado.

## T-007 — Backup diário (pg_dump + checksum + rclone) com alerta [concluida]
- Refs: US-005, AC-010, AC-011
- Arquivos: infra/backup/backup-crm.sh, infra/backup/crontab
- Esforço: alto
- Notas: Depende de T-005 (precisa do database `crm_prod` existir). Reusa o
  remote `rclone gdrive:` já configurado na VPS (ASM-004), em pasta própria
  do CRM. Alerta via Evolution API em falha; `/api/health` (T-009) consome a
  idade do último backup.

## T-008 — Restore ensaiado, documentado e com script de verificação [concluida]
- Refs: US-005, AC-012
- Arquivos: infra/backup/restore-crm.sh, docs/runbooks/restore-backup-crm.md
- Esforço: medio
- Notas: Depende de T-007 (precisa existir um dump gerado pelo script de
  backup). Teste de integração gera um dump de um Postgres descartável,
  restaura em outro e confere que os dados batem.

## T-009 — Endpoint `/api/health` [concluida]
- Refs: US-006, AC-013, AC-014
- Arquivos: src/app/api/health/route.ts, src/lib/env.ts
- Esforço: medio
- Notas: Depende de T-005 (checa conexão com `crm_prod`) e de T-007 (idade do
  último backup). `503`/`checks[].status:"fail"` explícito quando o banco
  está inacessível — nunca `200` mascarando falha.
