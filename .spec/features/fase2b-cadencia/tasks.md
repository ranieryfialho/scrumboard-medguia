# Tasks: Fase 2b — Motor de cadência

> feature: fase2b-cadencia

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

## T-088 — Domínio puro: matriz, turnos e feriados [concluida]
- Refs: US-052, AC-187, AC-188, AC-189
- Arquivos: src/domain/cadencia/matriz.ts, src/domain/cadencia/turno.ts, src/domain/cadencia/feriados.ts, test/domain/cadencia.test.ts
- Esforço: medio
- Notas: módulo sem I/O e sem `Date.now()` (relógio injetado, ASM-062). `blocoDe(dia, turno)` devolve 3 toques com sequência 1–18, canal/tipo e `breakup` no 18. `turnoVigente(instante)` em `America/Sao_Paulo` (8–12h manhã, 13–18h tarde, resto nulo). `podeLiberar(data)` falso em sábado, domingo e feriado da lista fixa 2026–2027 (ASM-057), usando a data local, não UTC.

## T-089 — Migration 0011: funções SQL da cadência [pendente]
- Refs: AC-190, AC-193, AC-194, AC-195, AC-196, AC-197, AC-199, AC-200, AC-201, AC-203
- Arquivos: drizzle/0011_cadencia_funcoes.sql, test/db/cadencia-funcoes.test.ts
- Esforço: xalto
- Notas: funções `iniciar_cadencia`, `concluir_atividade_cadencia` e `virar_dia_cadencia`, todas `GRANT EXECUTE` a `crm_app`, chamando `mover_oportunidade` (ator sistema na virada e no esgotamento) para não duplicar a escrita de etapa. Concluir trava o card (`FOR UPDATE`), valida versão, ordem/turno e resultado `pendente`; `conectou` cancela pendentes e preenche `cadencia_encerrada_em` na mesma transação. Gera eventos `cadencia_iniciada`, `atividade_concluida`, `cadencia_dia_avancado`, `cadencia_esgotada` (ASM-060). Prova com Postgres efêmero (`test/support/postgres-efemero.ts`), incluindo dois tenants. Depende de T-088 só pela matriz (replicada em SQL, com teste de paridade).

## T-090 — Repositório de cadência [pendente]
- Refs: AC-190, AC-192, AC-193, AC-195, AC-203
- Arquivos: src/repositories/cadencia.ts, test/repositories/cadencia.test.ts
- Esforço: alto
- Notas: `iniciarCadencia`, `listarFilaDoTurno`, `concluirAtividade`, `virarDiaDeTodasAsEmpresas`, sempre via `comTenant` (RLS) — a virada percorre as empresas ativas, cada uma na própria transação. Fila filtra por responsável, turno vigente, dia útil e manhã concluída (AC-192). Depende de T-088 e T-089.

## T-091 — Rota POST /api/oportunidades/:id/cadencia/iniciar [pendente]
- Refs: US-053, AC-190, AC-191
- Arquivos: src/app/api/oportunidades/[id]/cadencia/iniciar/route.ts, test/api/cadencia-iniciar.test.ts
- Esforço: medio
- Notas: mesmo padrão de sessão/tenant da rota de transição (401 → 404 → 409). Corpo `{ version }`. Depende de T-090.

## T-092 — Rotas GET /api/atividades e POST /api/atividades/:id/concluir [pendente]
- Refs: US-053, US-054, AC-192, AC-193, AC-194, AC-195, AC-196, AC-197, AC-198
- Arquivos: src/app/api/atividades/route.ts, src/app/api/atividades/[id]/concluir/route.ts, test/api/atividades.test.ts, test/api/atividades-concluir.test.ts
- Esforço: alto
- Notas: erros de domínio com o envelope do TDD §4.6 (`TURNO_NAO_LIBERADO`, `BLOCO_ANTERIOR_PENDENTE`, `CADENCIA_ENCERRADA`, `CONFLITO_DE_VERSAO`). Papel conforme ASM-061. Depende de T-090. Pode rodar em paralelo com T-091 (arquivos disjuntos).

## T-093 — Job diário: rota interna de virada de dia [pendente]
- Refs: US-055, AC-199, AC-200, AC-201, AC-202, AC-203
- Arquivos: src/app/api/cron/cadencia/route.ts, src/lib/env.ts, test/api/cron-cadencia.test.ts
- Esforço: alto
- Notas: `POST /api/cron/cadencia` com `Authorization: Bearer $CRON_SEGREDO` (comparação em tempo constante); 401 sem segredo. Grava `cron_execucoes` (em_execucao → sucesso/falha, itens processados). Idempotente por dia: a segunda chamada não avança o mesmo card nem duplica toque (garantido pela função SQL, T-089). Fim de semana/feriado: 0 itens (AC-200). Depende de T-090.
