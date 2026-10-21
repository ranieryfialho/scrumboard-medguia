# Tasks: Fase3 etl lp

> feature: fase3-etl-lp

<!--
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - `Refs:` = histórias/critérios que a tarefa atende; `Arquivos:` separados por vírgula.
  - Uma tarefa só vira [concluida] com prova PASS de `onp-spec verify`.
  Status: pendente | em-andamento | concluida
-->

## T-121 — Leitor somente leitura da LP [pendente]
- Refs: AC-299, AC-306
- Arquivos: src/etl/lp/origem.ts, test/etl/lp-origem.test.ts
- Esforço: medio
- Notas: lê `leads` da LP via PostgREST com `SUPABASE_LP_URL` + `SUPABASE_LP_SERVICE_KEY` (ASM-095), só GET, com `select=` explícito que NUNCA inclui `password_hash` (AC-299); paginado; devolve também o total da origem (header `Content-Range`, para AC-304). Erro de leitura nunca imprime a chave (usar `mascarar` de `src/etl/comum.ts`). O `fetch` é injetável para o teste.

## T-122 — Importar cadastros da LP como lead + card [pendente]
- Refs: US-082, US-083, US-084, AC-294, AC-295, AC-296, AC-297, AC-298, AC-300, AC-301
- Arquivos: src/etl/lp/leads.ts, test/etl/lp-leads.test.ts
- Esforço: alto
- Notas: reaproveita `mapearStatusParaEtapa` (`src/etl/sheets/status.ts`), `normalizarTelefone`/`normalizarData` (`src/etl/sheets/normalizar.ts`) e `buscarIdDestino`/`registrarMigracao` (`src/etl/comum.ts`), com `contexto.origem = 'supabase-lp'` e entidade `lead`. Dedupe contra leads existentes da empresa por e-mail (lower) ou telefone E.164 → revisão com o id do lead existente (ASM-096). Decisões: `{ idLp: { etapaId } | { ignorar: true } }`; "ignorar" registra em `migracao_registros` com entidade `lead_ignorado` para sair da fila.

## T-123 — Orquestrador e comando do ETL da LP com simulação e relatório [pendente]
- Refs: US-085, AC-299, AC-302, AC-303, AC-304, AC-305
- Arquivos: src/etl/lp/executar.ts, scripts/etl-lp.ts, test/etl/lp-executar.test.ts
- Esforço: medio
- Notas: `executarEtl` (transação única, rollback em simulação); relatório lidas/criadas/ignoradas/emRevisao que fecha a conta e confere com o total da origem; `scripts/etl-lp.ts [--dry-run] [--decisoes <arquivo.json>]` no molde de `scripts/etl-supabase.ts`. Depende de T-121 e T-122.
