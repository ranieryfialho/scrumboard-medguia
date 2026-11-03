# Tasks: Fase4 tarefas agenda

> feature: fase4-tarefas-agenda

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

## T-181 — API da fila: resumo do turno, liberação, responsável e filtro (servidor) [concluida]
- Refs: AC-462, AC-463, AC-468, AC-469
- Arquivos: src/repositories/cadencia.ts, src/repositories/resumo-turno.ts, src/app/api/atividades/route.ts, src/app/api/atividades/resumo/route.ts, test/api/atividades-resumo.test.ts
- Esforço: alto
- Notas: `GET /api/atividades` passa a trazer `liberadaEm` e `responsavel {id, nome}` por item e aceita `responsavelId` (ignorado para ATENDENTE, que vê só os seus). `GET /api/atividades/resumo` devolve toques do turno (concluídos/total), conexões e sem resposta de hoje, atrasados, receita sob risco, ticket médio e maior atraso (ASM-158 a ASM-161), tudo por empresa. Não quebrar nenhum campo existente nem os testes AC-204..221 da fase2b.

## T-182 — Fila do turno: tela nova dentro da casca [concluida]
- Refs: US-119, AC-461, AC-464, AC-465, AC-466, AC-467, AC-470, AC-471
- Arquivos: src/app/(app)/tarefas/page.tsx, src/components/tarefas/fila-turno.tsx, src/components/tarefas/comum.ts, src/components/tarefas/destaque-tarefa.tsx, src/components/tarefas/indicadores-turno.tsx, test/components/tarefas/fila-turno-tela.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/13*`. A tela antiga `src/app/tarefas/page.tsx` foi removida (`git rm`). Os componentes `fila-tarefas.tsx` e `toque-item.tsx` da fase2b e os testes deles ficam como estão (ASM-169). Depende de T-181.

## T-183 — Tarefas atrasadas: tela e reatribuição em lote [concluida]
- Refs: US-120, AC-472, AC-473, AC-474, AC-475, AC-476, AC-477, AC-478, AC-479
- Arquivos: src/app/(app)/tarefas/atrasadas/page.tsx, src/components/tarefas/tarefas-atrasadas.tsx, test/components/tarefas/atrasadas-tela.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/14*`. Reaproveita `DialogoLote`/`ResultadoLote` e `POST /api/oportunidades/lote/reatribuir`. Depende de T-181 e T-182.

## T-184 — Reuniões: leitura, status derivado e resumo (servidor) [concluida]
- Refs: US-121, AC-481, AC-482, AC-483, AC-487
- Arquivos: src/repositories/reunioes.ts, src/lib/reunioes/status.ts, src/app/api/reunioes/route.ts, src/app/api/reunioes/resumo/route.ts, test/api/reunioes-leitura.test.ts
- Esforço: alto
- Notas: ASM-164 (status derivado), ASM-168 (fuso). O GET aceita `de`, `ate` (máx. 70 dias), `closerId`, `status`. O resumo inclui a fila de resgate de no-shows e o desempenho por closer. Sem migration (ASM-170).

## T-185 — Reuniões: agendar, no-show, concluir e reagendar (servidor) [concluida]
- Refs: US-122, AC-489, AC-490, AC-491, AC-492, AC-493, AC-494, AC-495
- Arquivos: src/repositories/reunioes-acoes.ts, src/app/api/reunioes/route.ts, src/app/api/reunioes/elegiveis/route.ts, src/app/api/reunioes/[id]/no-show/route.ts, src/app/api/reunioes/[id]/concluir/route.ts, src/app/api/reunioes/[id]/reagendar/route.ts, test/api/reunioes-acoes.test.ts
- Esforço: xalto
- Notas: cada ação grava a reunião e chama `transicionarCard` na mesma transação (tudo ou nada). Depende de T-184 (arquivo `route.ts` compartilhado: POST fica aqui). Cards elegíveis para agendar via `GET /api/reunioes/elegiveis` se necessário.

## T-186 — Agenda: tela com as quatro visões e filtros [concluida]
- Refs: AC-480, AC-484, AC-485, AC-486, AC-487, AC-488
- Arquivos: src/app/(app)/agenda/page.tsx, src/components/agenda/agenda-tela.tsx, src/components/agenda/cartao-reuniao.tsx, src/components/agenda/visoes.tsx, src/components/agenda/lateral-agenda.tsx, src/components/agenda/datas.ts, src/components/agenda/tipos.ts, test/components/agenda/agenda-tela.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/15*`. Depende de T-184.

## T-187 — Agenda: modais das ações e eventos em tempo real [concluida]
- Refs: AC-489, AC-490, AC-491, AC-492, AC-493, AC-495, AC-496
- Arquivos: src/components/agenda/modais.tsx, src/components/agenda/acoes-reuniao.ts, test/components/agenda/modais-agenda.test.tsx
- Esforço: alto
- Notas: reaproveita o modal de evidência do funil. Depende de T-185 e T-186.

## T-188 — Navegação sem 404, estados de tela e limpeza [concluida]
- Refs: US-123, AC-497, AC-498
- Arquivos: test/auth/rotas-tarefas-agenda.test.ts, src/components/tarefas/estados.tsx
- Esforço: medio
- Notas: teste no molde de `test/auth/rotas-pipeline.test.ts`. Depende das demais.

## T-298 — A fila do turno e os atrasados têm altura fixa [pendente]
- Refs: US-119, US-120, AC-762
- Arquivos: src/components/tarefas/fila-turno.tsx, src/components/tarefas/tarefas-atrasadas.tsx, test/components/tarefas/fila-turno-tela.test.tsx, test/components/tarefas/atrasadas-tela.test.tsx
- Notas: décimo quarto ajuste da série do dono (03/11): pedido para a Fila do Turno, mesmo padrão do funil, da lista e da conversa (T-284/T-285/T-291); a tela de atrasados recebeu o mesmo (é a irmã, com a mesma tabela longa). A Agenda não foi mexida.

## T-299 — Os cartões de "Tarefas Atrasadas" seguem o protótipo [pendente]
- Refs: US-120, AC-473, AC-763
- Arquivos: src/components/tarefas/kpis-atrasados.tsx, src/components/tarefas/tarefas-atrasadas.tsx, test/components/tarefas/atrasadas-tela.test.tsx
- Notas: décimo quinto ajuste da série do dono (03/11). Só os cartões do topo e a etiqueta do cabeçalho mudam (a altura fixa já veio no T-298). Escolhas minhas: o quarto cartão é "Cards em risco" porque a "Recuperação de SLA" do protótipo (88,4%; 27 de 31 regularizados) não tem dado no sistema; o rodapé do "Maior tempo de atraso" mostra a ordenação da fila no lugar de "Expira redistribuição em" (regra que não existe). Os blocos "Regra de governança / transbordo > 4 horas" e "Plantão de Resgate" do protótipo continuam de fora: dependem de regras e de capacidade por consultor que o sistema não tem.

## T-300 — A agenda fica mais perto do protótipo [pendente]
- Refs: US-121, AC-764
- Arquivos: src/components/agenda/kpis-agenda.tsx, src/components/agenda/agenda-tela.tsx, src/components/agenda/cartao-reuniao.tsx, src/components/agenda/lateral-agenda.tsx, src/components/agenda/visoes.tsx, test/components/agenda/agenda-tela.test.tsx
- Notas: décimo sexto ajuste da série do dono (03/11). Só aparência, com os dados que a agenda já tem; nada de backend novo. O botão "Google Meet / Outlook" e "Entrar no Meet Agora" continuam "em breve": a integração com o Meet é uma funcionalidade à parte (Google Calendar, ver a conversa de 03/11). A altura fixa não foi aplicada: a agenda é uma página de leitura longa e o dono não pediu.
