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

## T-089 — Migration 0011: funções SQL da cadência [concluida]
- Refs: AC-190, AC-193, AC-194, AC-195, AC-196, AC-197, AC-199, AC-200, AC-201, AC-203
- Arquivos: drizzle/0011_cadencia_funcoes.sql, test/db/cadencia-funcoes.test.ts
- Esforço: xalto
- Notas: funções `iniciar_cadencia`, `concluir_atividade_cadencia` e `virar_dia_cadencia`, todas `GRANT EXECUTE` a `crm_app`, chamando `mover_oportunidade` (ator sistema na virada e no esgotamento) para não duplicar a escrita de etapa. Concluir trava o card (`FOR UPDATE`), valida versão, ordem/turno e resultado `pendente`; `conectou` cancela pendentes e preenche `cadencia_encerrada_em` na mesma transação. Gera eventos `cadencia_iniciada`, `atividade_concluida`, `cadencia_dia_avancado`, `cadencia_esgotada` (ASM-060). Prova com Postgres efêmero (`test/support/postgres-efemero.ts`), incluindo dois tenants. Depende de T-088 só pela matriz (replicada em SQL, com teste de paridade).

## T-090 — Repositório de cadência [concluida]
- Refs: AC-190, AC-192, AC-193, AC-195, AC-203
- Arquivos: src/repositories/cadencia.ts, test/repositories/cadencia.test.ts
- Esforço: alto
- Notas: `iniciarCadencia`, `listarFilaDoTurno`, `concluirAtividade`, `virarDiaDeTodasAsEmpresas`, sempre via `comTenant` (RLS) — a virada percorre as empresas ativas, cada uma na própria transação. Fila filtra por responsável, turno vigente, dia útil e manhã concluída (AC-192). Depende de T-088 e T-089.

## T-091 — Rota POST /api/oportunidades/:id/cadencia/iniciar [concluida]
- Refs: US-053, AC-190, AC-191
- Arquivos: src/app/api/oportunidades/[id]/cadencia/iniciar/route.ts, test/api/cadencia-iniciar.test.ts
- Esforço: medio
- Notas: mesmo padrão de sessão/tenant da rota de transição (401 → 404 → 409). Corpo `{ version }`. Depende de T-090.

## T-092 — Rotas GET /api/atividades e POST /api/atividades/:id/concluir [concluida]
- Refs: US-053, US-054, AC-192, AC-193, AC-194, AC-195, AC-196, AC-197, AC-198
- Arquivos: src/app/api/atividades/route.ts, src/app/api/atividades/[id]/concluir/route.ts, test/api/atividades.test.ts, test/api/atividades-concluir.test.ts
- Esforço: alto
- Notas: erros de domínio com o envelope do TDD §4.6 (`TURNO_NAO_LIBERADO`, `BLOCO_ANTERIOR_PENDENTE`, `CADENCIA_ENCERRADA`, `CONFLITO_DE_VERSAO`). Papel conforme ASM-061. Depende de T-090. Pode rodar em paralelo com T-091 (arquivos disjuntos).

## T-093 — Job diário: rota interna de virada de dia [concluida]
- Refs: US-055, AC-199, AC-200, AC-201, AC-202, AC-203
- Arquivos: src/app/api/cron/cadencia/route.ts, src/lib/env.ts, test/api/cron-cadencia.test.ts
- Esforço: alto
- Notas: `POST /api/cron/cadencia` com `Authorization: Bearer $CRON_SEGREDO` (comparação em tempo constante); 401 sem segredo. Grava `cron_execucoes` (em_execucao → sucesso/falha, itens processados). Idempotente por dia: a segunda chamada não avança o mesmo card nem duplica toque (garantido pela função SQL, T-089). Fim de semana/feriado: 0 itens (AC-200). Depende de T-090.

## T-295 — A cadência iniciada à tarde começa pelo bloco da tarde [pendente]
- Refs: US-053, AC-190, AC-756, AC-757
- Arquivos: drizzle/0028_cadencia_inicio_no_turno.sql, src/domain/cadencia/inicio.ts, src/repositories/cadencia.ts, src/app/api/oportunidades/[id]/cadencia/iniciar/route.ts, test/db/cadencia-inicio.test.ts, test/api/cadencia-iniciar.test.ts, test/api/oportunidade-cadencia-lista.test.ts
- Notas: décimo segundo ajuste da série do dono (03/11); ele escolheu a opção "iniciada à tarde, o primeiro bloco já nasce como o da tarde". Escolhas minhas: o bloco da tarde é o de sequências 4–6 (não 1–3 em turno tarde), porque é o que o motor já espera para gerar os blocos seguintes; a cadência iniciada à tarde tem 15 toques; antes das 8h, depois das 18h e fim de semana/feriado o bloco continua o da manhã mas passa a valer às 8h do próximo dia útil (antes ele nascia "valendo" e aparecia como atrasado de manhã). **Migration 0028 precisa ser aplicada em `crm_prod` e no staging antes do deploy** (`iniciar_cadencia` ganha o parâmetro `p_agora` e a função antiga de 5 argumentos é removida). A rota passa `new Date()`; o repositório sem `agora` mantém o comportamento antigo, para os chamadores sem relógio e os testes existentes. Os testes de rota que dependiam do horário real passam a fixar `Date` (senão quebrariam no CI à tarde).

## T-296 — Entrar em "1º dia de contato" inicia a cadência; Iniciar Cadência em Massa [pendente]
- Refs: US-053, US-115, AC-393, AC-445, AC-758, AC-759, AC-760
- Arquivos: src/repositories/transicao-card.ts, src/repositories/cadencia.ts, src/repositories/lote-oportunidades.ts, src/lib/lote-limite.ts, src/app/api/oportunidades/lote/iniciar-cadencia/route.ts, src/components/pipeline/lote/iniciar-cadencia-api.ts, src/components/pipeline/lote/dialogo-iniciar-cadencia.tsx, src/components/pipeline/lote/barra-lote.tsx, src/components/pipeline/lote/tipos.ts, src/components/pipeline/lote/resultado-lote.tsx, src/components/pipeline/board-kanban.tsx, src/app/(app)/pipeline/lista/page.tsx, test/api/cadencia-ao-entrar.test.ts, test/components/pipeline/funil.test.tsx, test/components/pipeline/lote-tela.test.tsx
- Notas: décimo terceiro ajuste da série do dono (03/11), ao perceber que "Tarefas do Turno" só lista cards com toques e que cards chegam a "1º dia de contato" sem cadência (arrastar, voltar do Follow, e a migração, que põe todos em "Entrada de leads"). Ele escolheu as duas primeiras correções: (1) entrar em "1º dia" inicia a cadência (feito em `transicionarCard`, o ponto único de transição, que serve a tela, o arrastar e os lotes — sem trigger no banco; usa `iniciar_cadencia` com o relógio real) e (2) "Iniciar Cadência em Massa" funcional. Sem migration. Escolhas minhas: o funil inicia a cadência de todos os cards de "Entrada de leads" que o filtro deixa à vista (em pedaços de 100, o limite do lote), a lista inicia os selecionados; qualquer papel pode; só vale para "Entrada de leads" e sem toques. **Não feito (terceira opção que ele não escolheu): reparar os cards que já estão em 1º, 2º e 3º dia sem toques** — no banco local de teste há 12 assim; no staging e em produção vale conferir com `SELECT count(*) FROM oportunidades o WHERE etapa_id IN (2,3,4) AND NOT EXISTS (SELECT 1 FROM cadencia_atividades a WHERE a.oportunidade_id = o.id)`.
