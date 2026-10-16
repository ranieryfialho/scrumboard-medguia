# Spec: Fase 2b — Fila "Minhas tarefas" (tela da cadência)

> feature: fase2b-fila-tarefas
> status: auditada

## Contexto

A feature fase2b-cadencia entregou o motor (matriz de 18 toques, turnos, conclusão, virada de dia) e as rotas `POST /api/oportunidades/:id/cadencia/iniciar`, `GET /api/atividades` e `POST /api/atividades/:id/concluir`, mas nenhum operador consegue usá-las: não há tela. Esta feature entrega a tela da SDR (PRD-001 §5.2, TDD-001 §4.5): a página **Minhas tarefas** com os 3 toques do turno, os botões para registrar o resultado de cada toque, o aviso de toques atrasados, a atualização em tempo real e o botão **Iniciar cadência** nos cards de "Entrada de leads". Sem ela a cadência não tem como começar nem ser cumprida.

## Fora de escopo

- Tarefas agendadas (follow de longo prazo, revisitar perdido em 30–60 dias) — TDD-001 §3.
- Observação livre ou anexo no toque (as colunas existem, a UI não os expõe agora).
- Reatribuição em massa de responsável (Q-019) e notificações push/e-mail.
- Alterar matriz, turnos, feriados ou regras de conclusão — já entregues por fase2b-cadencia; esta feature só os CONSOME pelas rotas.
- Relatórios de cadência (feature f2d).

## Histórias

### US-056 — Ver a fila do turno em uma página própria

Como SDR, quero abrir a página "Minhas tarefas" e ver só os toques do turno vigente, para saber o que fazer agora sem me perder entre 18 tarefas.

#### AC-204 — A página exige login e tem um item no menu lateral

- **Dado** o menu lateral do CRM
- **Quando** um usuário autenticado o abre, e quando alguém sem sessão acessa `/tarefas`
- **Então** o menu mostra o item "Minhas tarefas" que leva a `/tarefas`; sem sessão, o acesso é redirecionado para o login e nenhuma tarefa é carregada

#### AC-205 — Cada toque mostra o lead, o canal e a posição na cadência

- **Dado** um toque pendente do turno vigente de um card em cadência
- **Quando** a fila é exibida
- **Então** o item mostra o nome do lead, o canal (telefone ou WhatsApp), o tipo (ligação, mensagem ou breakup) e "toque N de 18"

#### AC-206 — Fila vazia explica o motivo

- **Dado** que não há toques pendentes no turno, ou que é fora de turno, fim de semana ou feriado
- **Quando** a página é aberta
- **Então** a tela mostra uma mensagem de fila vazia (sem lista em branco nem erro), distinguindo "sem toques neste turno" de "fora do horário de atendimento"

#### AC-207 — Cada toque leva ao card e, se for WhatsApp, à conversa

- **Dado** um toque pendente na fila
- **Quando** o operador clica no lead, ou em "Abrir conversa" num toque de WhatsApp
- **Então** abre o detalhe do card (`/pipeline/:id`) ou a conversa do lead; toque de telefone não mostra o atalho da conversa

### US-057 — Concluir um toque direto da fila

Como SDR, quero registrar "Sem resposta" ou "Conectou" em cada toque, para que o sistema libere o próximo bloco ou interrompa a cadência sem eu mexer no card.

#### AC-208 — "Sem resposta" conclui o toque e a fila se atualiza

- **Dado** um toque pendente na fila
- **Quando** o operador clica em "Sem resposta"
- **Então** o toque sai da fila, o resultado é gravado pela rota de concluir (`POST /api/atividades/:id/concluir`, com a `version` do card) e, ao concluir o terceiro toque da manhã, os 3 da tarde aparecem

#### AC-209 — "Conectou" encerra a cadência e avisa para onde o card foi

- **Dado** um card com vários toques pendentes na fila
- **Quando** o operador clica em "Conectou"
- **Então** todos os toques daquele card somem da fila e a tela avisa que o card foi para "Qualificando"

#### AC-210 — Erros de conclusão são explicados e a fila é recarregada

- **Dado** que a rota recusa a conclusão (409 `CONFLITO_DE_VERSAO`, 422 `TURNO_NAO_LIBERADO` ou 422 `CADENCIA_ENCERRADA`)
- **Quando** o operador clica em um botão
- **Então** a tela mostra uma mensagem em português específica para o motivo e recarrega a fila com o estado real, sem duplicar nem perder toques

#### AC-211 — O botão não permite clique duplo

- **Dado** uma conclusão em andamento
- **Quando** o operador clica de novo no mesmo toque antes da resposta
- **Então** os botões daquele toque ficam desabilitados e só uma requisição é enviada

### US-058 — Ver toques atrasados

Como SDR, quero ver separadamente os toques que ficaram pendentes de turnos ou dias anteriores, para recuperá-los sem confundir com o que é do turno de agora.

#### AC-212 — A rota devolve os atrasados quando pedidos

- **Dado** um card em cadência ativa com toque pendente liberado em turno ou dia anterior ao vigente
- **Quando** `GET /api/atividades?atrasados=1` é chamado
- **Então** esses toques voltam marcados com `atrasado: true`, junto com os do turno vigente (`atrasado: false`); sem o parâmetro a resposta é a da AC-192, inalterada; o isolamento por tenant e por responsável (ASM-061) vale para os atrasados

#### AC-213 — A tela destaca os atrasados em uma seção própria

- **Dado** que a resposta traz toques atrasados
- **Quando** a página é exibida
- **Então** os atrasados aparecem numa seção "Atrasadas", acima do turno vigente, com o selo "Atrasado", e podem ser concluídos como os demais

#### AC-220 — O card do board também mostra o selo "Atrasado"

- **Dado** um card em cadência ativa com toque atrasado (ASM-065) e outro sem atraso
- **Quando** o board é exibido
- **Então** só o card com toque atrasado mostra o selo "Atrasado"; o selo some quando o toque é concluído, sem recarregar a página

### US-059 — Iniciar a cadência pelo card

Como SDR, quero um botão "Iniciar cadência" nos cards de "Entrada de leads", para começar o contato sem usar a API.

#### AC-214 — O botão só aparece em card de "Entrada de leads"

- **Dado** cards do board em etapas diferentes
- **Quando** o board e o detalhe do card são exibidos
- **Então** só o card em "Entrada de leads" mostra "Iniciar cadência", tanto no card do board quanto no detalhe

#### AC-215 — Iniciar move o card e mostra o primeiro bloco

- **Dado** um card em "Entrada de leads"
- **Quando** o operador clica em "Iniciar cadência"
- **Então** é chamada `POST /api/oportunidades/:id/cadencia/iniciar` com a `version` atual, o card aparece em "1º dia de contato" sem recarregar a página, e a tela confirma que os 3 primeiros toques estão em "Minhas tarefas"

#### AC-216 — Erros ao iniciar são explicados

- **Dado** que a rota recusa (409 `CONFLITO_DE_VERSAO` ou 404 `OPORTUNIDADE_NAO_ENCONTRADA`)
- **Quando** o operador clica em "Iniciar cadência"
- **Então** a tela mostra o motivo em português, recarrega o card e não deixa o botão preso em "carregando"

### US-060 — Fila em tempo real

Como SDR, quero que a fila se atualize sozinha quando um toque é concluído ou um bloco é liberado, para não trabalhar com uma lista velha.

#### AC-217 — O banco avisa a mudança da fila

- **Dado** a cadência de um card
- **Quando** um toque é criado ou muda de resultado (concluir, `conectou`, virada de dia)
- **Então** é emitido um `NOTIFY` do evento `cadencia.fila_alterada` com `empresaId` e `oportunidadeId`, na mesma transação da mudança (migration 0012); a migration também registra `liberada_em` em cada toque (base da AC-212)

#### AC-218 — O stream só entrega o evento ao tenant dono

- **Dado** duas empresas conectadas em `/api/stream`
- **Quando** um toque da empresa A muda
- **Então** só as conexões da empresa A recebem `cadencia.fila_alterada`; as da empresa B nunca recebem nada (mesma regra do AC-109)

#### AC-219 — A página recarrega a fila ao receber o evento, com fallback

- **Dado** a página `/tarefas` aberta
- **Quando** chega `cadencia.fila_alterada` ou `stream.reconectado`, ou o stream cai para polling (30 s, ASM-031)
- **Então** a fila é recarregada e reflete o novo estado sem ação do usuário; o evento disparado pela própria conclusão não duplica itens

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-063 | A página `/tarefas` é uma rota Next própria, com item "Minhas tarefas" no menu lateral. | confirmada | Decidido pelo usuário em 2026-10-15. |
| ASM-064 | O resultado é registrado por dois botões, "Sem resposta" e "Conectou", que mapeiam os dois resultados da rota de concluir. | confirmada | Decidido pelo usuário em 2026-10-15. |
| ASM-065 | "Atrasado" = toque `pendente`, de cadência ativa, liberado em turno anterior ao vigente no mesmo dia (manhã durante a tarde) ou em dia-calendário anterior (fuso `America/Sao_Paulo`). Exige a coluna `liberada_em` (migration 0012, default `now()`; toques existentes recebem `realizada_em` ou o horário da migration). | confirmada | Confirmada pelo usuário em 2026-10-15. |
| ASM-066 | A atualização em tempo real reaproveita o canal `LISTEN/NOTIFY` e o `/api/stream` da fase2c-sse, com um novo tipo de evento — sem um segundo canal ou processo. | confirmada | Confirmada pelo usuário em 2026-10-15. |
| ASM-067 | "Iniciar cadência" aparece para quem já pode mover o card (mesma regra de papel da rota); a tela não duplica regra de permissão, apenas exibe o erro devolvido. | confirmada | Confirmada pelo usuário em 2026-10-15. |
| ASM-068 | A tela fala com a API por `fetch` com cookie de sessão, como o board (`src/components/pipeline`); nada de acesso direto ao banco no cliente. | confirmada | Convenção do código existente. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-021 | O selo "Atrasado" deve ficar visível também no card do board (além da fila)? | respondida | Sim: aparece nos dois lugares, na fila e no card do board (decidido pelo usuário em 2026-10-15; AC-220). |
| Q-022 | MASTER/GERENTE, que veem o tenant inteiro na fila (ASM-061), podem concluir toques de qualquer responsável pela tela? | respondida | Sim, podem concluir (decidido pelo usuário em 2026-10-15; mesma regra da rota, ASM-061). |
