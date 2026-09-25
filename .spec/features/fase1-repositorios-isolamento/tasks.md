# Tasks: Fase 1 — Repositórios + isolamento

> feature: fase1-repositorios-isolamento

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

## T-039 — Helper de teste: dois tenants seedados (empresa A/B) [concluida]
- Refs: US-027
- Arquivos: test/support/seed-tenants.ts
- Esforço: baixo
- Notas: sobe (via `postgres-efemero`) duas empresas com leads e
  oportunidades próprios, usando o pool `crm_migrator` (sem RLS) para
  inserir os dados de teste. Reaproveitado por T-041 e T-042 — não depende
  de nenhuma outra tarefa desta feature.

## T-040 — `comTenant`: helper que abre transação com `SET LOCAL app.empresa_id` [concluida]
- Refs: US-026, AC-065, AC-066, AC-067
- Arquivos: src/repositories/contexto.ts, test/repositories/contexto.test.ts
- Esforço: medio
- Notas: `comTenant(db, contexto, fn)` — abre `db.transaction`, seta o
  tenant via `select set_config('app.empresa_id', $1, true)` (parametrizado;
  `SET LOCAL` puro não aceita bind), então roda `fn(tx)`. É a ÚNICA forma de
  repositório tocar o banco (AC-066: nenhuma função de repositório aceita
  `db`/`empresaId` cru como alternativa). AC-067 prova, via
  `SELECT current_user`, que o pool usado é `crm_app` (harness: `pg.appUrl`,
  mesmo padrão de `test/auth/*.test.ts`).

## T-041 — Repositório de leads (criar, buscar por id, listar) [concluida]
- Refs: US-026, US-027, AC-068, AC-069, AC-071
- Arquivos: src/repositories/leads.ts, test/repositories/leads.test.ts
- Esforço: medio
- Notas: depende de T-039 (seed) e T-040 (`comTenant`) já existirem.
  `criarLead` ignora `empresaId` de um payload eventualmente malicioso
  (AC-071) — usa sempre `contexto.empresaId`. Sem `excluir` (ASM-018).

## T-042 — Repositório de oportunidades (buscar, atualizar, listar com filtro/paginação) [concluida]
- Refs: US-026, US-027, US-028, AC-068, AC-069, AC-070, AC-071, AC-072, AC-073
- Arquivos: src/repositories/oportunidades.ts, test/repositories/oportunidades.test.ts
- Esforço: alto
- Notas: depende de T-039 (seed) e T-040 (`comTenant`) já existirem.
  `listarOportunidades(db, contexto, { etapaId?, responsavelId?, limite,
  deslocamento })` — paginação por deslocamento (offset), filtros combinam
  com E. `atualizarOportunidade` retorna linhas afetadas (0 quando o id é de
  outro tenant — AC-070), nunca lança como sucesso.
