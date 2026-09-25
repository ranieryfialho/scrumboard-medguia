# Tasks: Fase 2 — Kanban de 15 etapas

> feature: fase2-kanban

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

## T-043 — Migration: `mover_oportunidade` grava valor/motivo/próxima ação [concluida]
- Refs: AC-082
- Arquivos: drizzle/0006_fn_mover_oportunidade_guards.sql, test/db/funcoes.test.ts
- Esforço: medio
- Notas: `CREATE OR REPLACE FUNCTION mover_oportunidade` com os 3 parâmetros
  novos (`DEFAULT NULL`, `COALESCE` com o valor atual da coluna). Mesma
  convenção de teste de `test/db/funcoes.test.ts` (Postgres efêmero real).
  Base para todas as tarefas de repositório/rota de transição.

## T-044 — Repositório: `criarOportunidade` [concluida]
- Refs: US-030, AC-079, AC-080, AC-081
- Arquivos: src/repositories/oportunidades.ts, test/repositories/oportunidades.test.ts
- Esforço: medio
- Notas: valida que o `leadId` existe no tenant do `contexto` antes de
  inserir (senão `ErroLeadNaoEncontrado`); `empresaId` sempre do
  `contexto`, nunca de parâmetro externo; etapa fixa em 1, `version` 1
  (default da coluna).

## T-045 — Repositório: `moverOportunidade` (chama a função SQL estendida) [pendente]

- Refs: AC-082, AC-086
- Arquivos: src/repositories/oportunidades.ts, test/repositories/oportunidades.test.ts
- Esforço: alto
- Notas: depende de T-043. Chama `mover_oportunidade` via `sql` do Drizzle
  dentro de `comTenant`; captura a exceção `CONFLITO_DE_VERSAO` (por
  `ERRCODE`, ver design.md) e relança como erro tipado
  (`ErroConflitoDeVersao`) — quem decide o código HTTP é a rota (T-047).

## T-046 — Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar) [pendente]

- Refs: US-029, US-030, AC-074, AC-075, AC-076, AC-077, AC-078, AC-079, AC-080, AC-081, AC-094
- Arquivos: src/app/api/oportunidades/route.ts, test/api/oportunidades.test.ts
- Esforço: alto
- Notas: depende de T-044. `GET` monta o mapa de destinos alcançáveis por
  etapa (AC-094) filtrando `pipeline_transicoes` pelo papel do ator (mesma
  lógica de `papelPodeTransicionar`, aplicada em memória sobre o grafo já
  carregado — não duplica a regra, só a consulta). `POST` usa
  `resolverContextoTenant`; sem sessão → 401 antes de qualquer query
  (AC-078).

## T-047 — Rota `POST /api/oportunidades/:id/transicao` [pendente]

- Refs: US-031, AC-082, AC-083, AC-084, AC-085, AC-086, AC-087
- Arquivos: src/app/api/oportunidades/[id]/transicao/route.ts, test/api/oportunidades-transicao.test.ts
- Esforço: xalto
- Notas: depende de T-045. Carrega etapa origem (do card), etapa destino e
  transição do grafo; monta `AtorTransicao`/`DadosTransicao` a partir da
  sessão + corpo; chama `validarTransicao` (domínio, síncrono); se `!ok`,
  `422` com o `codigo` do domínio; se `ok`, chama `moverOportunidade` — erro
  de conflito de versão vira `409`; card de outro tenant (busca não encontra
  nada) vira `404` antes mesmo de validar a transição (AC-087).

## T-048 — Rota `GET /api/oportunidades/:id` (detalhe) [pendente]

- Refs: US-033, AC-092, AC-093
- Arquivos: src/app/api/oportunidades/[id]/route.ts, test/api/oportunidades-detalhe.test.ts
- Esforço: baixo
- Notas: usa `buscarOportunidadePorId` (já existe, fail closed por AC-069 da
  fase1-repositorios-isolamento) + join simples para nome do lead/
  responsável.

## T-049 — Componentes do board: colunas, card, drag-and-drop [pendente]

- Refs: US-029, US-031, AC-074, AC-075, AC-076, AC-077, AC-094, AC-083, AC-084, AC-091
- Arquivos: src/components/pipeline/board-kanban.tsx, src/components/pipeline/coluna-etapa.tsx, src/components/pipeline/card-oportunidade.tsx, src/app/pipeline/page.tsx
- Esforço: xalto
- Notas: depende de T-046, T-047. `DndContext` do dnd-kit (mesmo padrão já
  usado em `src/components/kanban/kanban-board.tsx`, mas componente novo —
  não editar o antigo, ver design.md). Restringe drop às etapas do mapa de
  AC-094. Ao soltar num destino válido, chama a rota de transição; erro
  `TRANSICAO_NAO_PERMITIDA`/`PAPEL_NAO_PERMITIDO` mostra mensagem (AC-091) e
  devolve o card à coluna de origem.

## T-050 — Modal de dado faltante [pendente]

- Refs: US-032, AC-088, AC-089, AC-090
- Arquivos: src/components/pipeline/modal-dado-faltante.tsx
- Esforço: medio
- Notas: depende de T-047, T-049. Um campo por código
  (`VALOR_OBRIGATORIO`→valor, `MOTIVO_PERDA_OBRIGATORIO`→select de motivo,
  `PROXIMA_ACAO_OBRIGATORIA`→data futura, `JUSTIFICATIVA_OBRIGATORIA`→
  textarea). Confirmar reenvia a transição com o campo preenchido; cancelar
  não chama nada (AC-090).

## T-051 — Página de detalhe do card [pendente]

- Refs: US-033, AC-092, AC-093
- Arquivos: src/app/pipeline/[id]/page.tsx
- Esforço: medio
- Notas: depende de T-048. Consome a rota de detalhe; card inexistente/de
  outro tenant (404) mostra estado de "não encontrado", nunca vaza que o id
  existe em outra empresa.
