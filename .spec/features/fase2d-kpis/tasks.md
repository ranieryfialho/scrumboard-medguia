# Tasks: Fase2d kpis

> feature: fase2d-kpis

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

## T-101 — Repositório de KPIs sobre o log de eventos [concluida]
- Refs: US-061, AC-221, AC-222, AC-223, AC-224, AC-225, AC-226, AC-227, AC-228
- Arquivos: src/repositories/kpis.ts, test/db/kpis.test.ts
- Esforço: alto
- Notas: uma consulta SQL por tenant (RLS), coorte por `oportunidades.criado_em` no fuso America/Sao_Paulo (ASM-069), `count(distinct oportunidade_id)` por evento (ASM-070/071). Ativação do trial devolve `valor: null` (Q-023). Teste em Postgres efêmero, como test/db/cadencia-fila.test.ts.

## T-102 — Rota GET /api/relatorios/kpis [pendente]
- Refs: AC-226, AC-227, AC-228, AC-229, AC-230
- Arquivos: src/app/api/relatorios/kpis/route.ts, test/api/relatorios-kpis.test.ts
- Esforço: medio
- Notas: depende de T-101. Mesmo padrão de sessão/tenant de src/app/api/atividades/route.ts; só MASTER, GERENTE e super admin (ASM-074); valida `de`/`ate`/`responsavelId` antes de tocar o banco; padrão = mês corrente.

## T-103 — Página /indicadores e item no menu [pendente]
- Refs: US-063, AC-231, AC-232, AC-233
- Arquivos: src/app/indicadores/page.tsx, src/components/indicadores/painel-kpis.tsx, src/components/layout/sidebar.tsx, test/components/indicadores/painel-kpis.test.tsx
- Esforço: alto
- Notas: depende de T-102 só pelo formato da resposta (pode ser feita com `fetch` falso). Menu oculto para ATENDENTE. Cartões com percentual, nome por extenso e "N de M"; estados carregando/erro com "Tentar de novo" mantendo os números anteriores.
