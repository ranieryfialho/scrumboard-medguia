# Tasks: Fase2c sse

> feature: fase2c-sse

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

## T-060 — Migration 0007: NOTIFY dentro de mover_oportunidade [concluida]
- Refs: AC-108, AC-110, AC-111
- Arquivos: drizzle/0007_fn_mover_oportunidade_notify.sql, test/sse/notify-sql.test.ts
- Esforço: medio
- Notas: recria a função mantendo a assinatura de 9 argumentos e acrescenta `pg_notify('oportunidade', json)` com `empresaId`, `oportunidadeId`, `etapaOrigemId`, `etapaDestinoId`, `atorId`, `ocorridoEm` (ASM-028/029). Só ids no payload. Prova com rollback e commit reais (testcontainers).

## T-061 — Barramento de eventos: um LISTEN por instância [concluida]
- Refs: AC-109, AC-115, AC-116, AC-117
- Arquivos: src/lib/sse/barramento.ts, test/sse/barramento.test.ts
- Esforço: alto
- Notas: singleton com 1 `pg.Client` em `LISTEN oportunidade`; `inscrever(empresaId, ouvinte)` devolve função de cancelamento; filtra por `empresaId` antes de entregar (ASM-029/030); reconecta com backoff e emite `stream.reconectado` (AC-117).

## T-062 — Rota GET /api/stream [concluida]
- Refs: US-038, AC-108, AC-113, AC-114, AC-116
- Arquivos: src/app/api/stream/route.ts, test/sse/stream-route.test.ts
- Esforço: alto
- Notas: sessão via `resolverContextoTenant` (401 antes de abrir qualquer coisa); `ReadableStream` com `text/event-stream`, `Cache-Control: no-cache, no-transform`, `: ping` a cada 25 s; limpa ouvinte e timer no `request.signal` abort (ASM-031). Depende de T-061.

## T-063 — Evento chega fim a fim e transição recusada não emite [pendente]
- Refs: AC-108, AC-109, AC-110
- Arquivos: test/sse/fim-a-fim.test.ts
- Esforço: medio
- Notas: usa a rota de transição real contra Postgres: 200 emite; 422, 409 e 404 não emitem; dois tenants conectados. Depende de T-060 e T-062.

## T-064 — Hook do cliente: EventSource com fallback de polling [pendente]
- Refs: US-038, AC-118
- Arquivos: src/hooks/use-stream-oportunidades.ts, test/sse/use-stream.test.tsx
- Esforço: medio
- Notas: abre `EventSource('/api/stream')`; após 3 erros seguidos liga polling de 30 s e volta ao SSE quando reconecta (ASM-031).

## T-065 — Board aplica o evento sem recarregar [pendente]
- Refs: US-037, AC-112
- Arquivos: src/components/pipeline/board-kanban.tsx, test/sse/board-evento.test.tsx
- Esforço: medio
- Notas: no `oportunidade.movida` relê o card e o reposiciona (ASM-032); ignora o evento do próprio ator por `version` já atualizada (Q-010) e card fora do filtro; em `stream.reconectado` recarrega a lista. Depende de T-064.
