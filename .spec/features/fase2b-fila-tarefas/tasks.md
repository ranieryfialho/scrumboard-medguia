# Tasks: Fase 2b — Fila "Minhas tarefas"

> feature: fase2b-fila-tarefas

<!--
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)
-->

## T-094 — Migration 0012: liberada_em e NOTIFY da fila [concluida]
- Refs: AC-217, AC-212
- Arquivos: drizzle/0012_cadencia_fila.sql, test/db/cadencia-fila.test.ts
- Esforço: alto
- Notas: coluna `liberada_em timestamptz not null default now()` em `cadencia_atividades` (backfill com `realizada_em` ou horário da migration) e trigger AFTER INSERT/UPDATE que dá `pg_notify('oportunidade', ...)` com `tipo: 'cadencia.fila_alterada'`, `empresaId`, `oportunidadeId` — mesmo padrão da 0007/0008. Prova com Postgres efêmero (`test/support/postgres-efemero.ts`), dois tenants.

## T-095 — Rota GET /api/atividades: atrasados e dados do lead [concluida]
- Refs: AC-205, AC-212
- Arquivos: src/repositories/cadencia.ts, src/app/api/atividades/route.ts, test/api/atividades-atrasadas.test.ts
- Esforço: alto
- Notas: depende de T-094 (`liberada_em`). `?atrasados=1` inclui pendentes de turno/dia anterior com `atrasado: true`; sem o parâmetro, comportamento da AC-192 inalterado (teste de regressão). A resposta passa a trazer o nome do lead e o telefone para a tela (AC-205). Relógio injetado (ASM-062).

## T-096 — Stream: evento cadencia.fila_alterada [concluida]
- Refs: AC-218, AC-219
- Arquivos: src/lib/sse/barramento.ts, src/app/api/stream/route.ts, src/hooks/use-stream-oportunidades.ts, test/sse/fila-alterada.test.ts
- Esforço: medio
- Notas: depende de T-094 só pelo formato do payload. Novo tipo no barramento, roteado por `empresaId` como `oportunidade.movida` (AC-109/AC-133); o hook repassa o evento e mantém o fallback de polling (ASM-031).

## T-097 — Página /tarefas, menu e lista da fila [concluida]
- Refs: AC-204, AC-205, AC-206, AC-207, AC-213, AC-219
- Arquivos: src/app/tarefas/page.tsx, src/components/tarefas/fila-tarefas.tsx, src/components/layout/sidebar.tsx, test/components/tarefas/fila-tarefas.test.tsx
- Esforço: alto
- Notas: depende de T-095 e T-096. jsdom, `fetch` e `EventSource` falsos, como em `test/components/pipeline`. Seção "Atrasadas" acima do turno vigente; estados vazios distintos (sem toques vs fora do horário).

## T-098 — Botões de conclusão do toque [concluida]
- Refs: AC-208, AC-209, AC-210, AC-211
- Arquivos: src/components/tarefas/toque-item.tsx, test/components/tarefas/toque-item.test.tsx
- Esforço: alto
- Notas: depende de T-097 (o item é renderizado pela lista). Envia a `version` do card; mapeia 409/422 para mensagens em português; desabilita os botões durante o envio.

## T-099 — Botão "Iniciar cadência" no card e no detalhe [concluida]
- Refs: AC-214, AC-215, AC-216
- Arquivos: src/components/pipeline/card-oportunidade.tsx, src/app/pipeline/[id]/page.tsx, src/components/pipeline/botao-iniciar-cadencia.tsx, test/components/pipeline/iniciar-cadencia.test.tsx
- Esforço: medio
- Notas: independe da fila (arquivos disjuntos); roda em paralelo com T-094/T-096. Só em "Entrada de leads"; move o card sem recarregar e mostra o erro devolvido pela rota.

## T-100 — Selo "Atrasado" no card do board [concluida]
- Refs: AC-220
- Arquivos: src/components/pipeline/board-kanban.tsx, src/components/pipeline/coluna-etapa.tsx, test/components/pipeline/selo-atrasado.test.tsx
- Esforço: medio
- Notas: depende de T-095 (`?atrasados=1`) e de T-099 (que altera `card-oportunidade.tsx`; o selo é renderizado por ele, então roda depois). O board cruza `oportunidadeId` com a resposta de atrasados e se atualiza com `cadencia.fila_alterada` (T-096).
