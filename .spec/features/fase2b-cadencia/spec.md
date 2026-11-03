# Spec: Fase 2b — Motor de cadência

> feature: fase2b-cadencia
> status: auditada

## Contexto

O TDD-001 (§4.5) e o PRD-001 (§5.2) definem a cadência de 18 toques em 3 dias, liberada bloco a bloco por turno. Hoje o banco já tem a tabela `cadencia_atividades` e o webhook do WhatsApp já interrompe a cadência numa conexão, mas nada **gera** os toques, nada os **lista** para o operador e nada os **conclui** nem faz o dia virar. Esta feature entrega o motor: regras puras de matriz/turno/feriado, geração do bloco corrente ao iniciar a cadência, a fila "Minhas tarefas" do turno, a conclusão de cada toque (inclusive `conectou`), a virada de dia pelo job diário e o esgotamento dos 18 toques. A tela da fila fica para a feature seguinte.

## Histórias

### US-052 — Regras da cadência como domínio puro

Como responsável pelo produto, quero que a matriz de 18 toques, os turnos e os feriados vivam num módulo puro e testado, para que a mesma regra sirva à API, ao job e à futura tela.

#### AC-187 — Matriz canônica de 18 toques

- **Dado** a matriz do PRD §5.2
- **Quando** o domínio monta o bloco de qualquer par (dia 1–3, turno manhã/tarde)
- **Então** ele devolve 3 toques com as sequências 1–18 contíguas na ordem: ligação, ligação, mensagem de WhatsApp; e o último toque (sequência 18) é do tipo `breakup`

#### AC-188 — Turno vigente por horário de São Paulo

- **Dado** um instante qualquer
- **Quando** o domínio calcula o turno em `America/Sao_Paulo`
- **Então** 08:00 a 11:59 é `manha`, 13:00 a 17:59 é `tarde`, e fora disso (12h–13h, antes das 8h, a partir das 18h) não há turno vigente

#### AC-189 — Fim de semana e feriado nacional pausam

- **Dado** um sábado, um domingo e um feriado nacional da lista versionada
- **Quando** o domínio pergunta se a cadência pode liberar bloco ou virar o dia naquela data
- **Então** a resposta é "não" nos três casos, e "sim" num dia útil comum; o cálculo usa a data em `America/Sao_Paulo`, não em UTC

### US-053 — Iniciar a cadência e ver só o bloco do turno

Como SDR, quero iniciar a cadência de um card e ver apenas os 3 toques do turno vigente, para não me perder entre 18 tarefas.

#### AC-190 — Iniciar gera só o primeiro bloco

- **Dado** um card em "Entrada de leads" do tenant do usuário
- **Quando** ele chama `POST /api/oportunidades/:id/cadencia/iniciar` com a `version` atual
- **Então** o card vai para "1º dia de contato" (dia 1) e passam a existir exatamente 3 toques pendentes, os do primeiro bloco (de manhã, as sequências 1–3 — ver AC-756 para o início à tarde); os demais toques só nascem depois; a resposta traz o card e os toques

#### AC-191 — Iniciar respeita versão, tenant e sessão

- **Dado** uma versão desatualizada, um card de outra empresa e uma requisição sem login
- **Quando** cada um chama a rota de iniciar cadência
- **Então** a resposta é 409 (`CONFLITO_DE_VERSAO`), 404 (`OPORTUNIDADE_NAO_ENCONTRADA`) e 401 (`NAO_AUTENTICADO`), respectivamente, e nenhum toque é criado

#### AC-192 — Fila "Minhas tarefas" lista só o turno liberado

- **Dado** um usuário com cards em cadência com toques pendentes da manhã e da tarde
- **Quando** ele chama `GET /api/atividades` durante a manhã
- **Então** vê só os toques pendentes do turno vigente dos cards dos quais é responsável, no tenant dele; os da tarde só aparecem a partir das 13h e com a manhã concluída (Q1); fora de turno, dia não útil ou feriado a lista vem vazia

#### AC-756 — Iniciada à tarde, o primeiro bloco é o da tarde

- **Dado** um card em "Entrada de leads" e um dia útil, com a cadência iniciada pela tela (que informa o horário de São Paulo)
- **Quando** o horário é de 12h00 a 17h59
- **Então** os 3 primeiros toques são os do bloco da tarde do dia 1 (sequências 4–6: ligação, ligação, WhatsApp), o card aponta para "dia 1, tarde", e os toques 1–3 não existem (a cadência fica com 15 toques)
- **E** de 13h00 a 17h59 os toques valem desde já e aparecem na fila do turno; de 12h00 a 12h59 passam a valer às 13h
- **E** concluir esse bloco sem resposta não gera nada (como o bloco da tarde de sempre), a virada de dia gera a manhã do dia 2, e o dia 3 da tarde esgota a cadência como antes
- **E** de 8h00 a 11h59 o primeiro bloco continua o da manhã (sequências 1–3), valendo desde já; sem o horário informado, o comportamento é o de sempre (manhã, valendo desde já)

#### AC-757 — Iniciada fora do expediente, o primeiro bloco vale no próximo turno

- **Dado** uma cadência iniciada antes das 8h de um dia útil, depois das 18h, ou num fim de semana ou feriado nacional
- **Então** o primeiro bloco é o da manhã (sequências 1–3) e passa a valer às 8h do primeiro dia útil seguinte (no mesmo dia, se ainda não deu 8h) — assim ele aparece como o turno em andamento, e não como atrasado, quando o expediente começa
- **E** a regra é a mesma no banco e no domínio puro: os dois dão o mesmo turno e a mesma hora em qualquer instante

#### AC-758 — Entrar em "1º dia de contato" por qualquer caminho inicia a cadência

- **Dado** um card que ainda não teve nenhum toque de cadência
- **Quando** ele é movido para "1º dia de contato" por qualquer caminho da tela — arrastar no funil, "Mover Etapa" do card, "Mover Etapa em Lote" ou voltar de "Follow de longo prazo"
- **Então** é como clicar em "Iniciar Cadência": o card entra na etapa e passa a ter os 3 toques do primeiro bloco do turno (AC-756), o ponteiro da cadência e o evento "cadência iniciada", tudo numa transação só
- **E** versão desatualizada continua recusada (409) sem criar toque nenhum; um card que já teve toques (de uma cadência anterior) só muda de etapa, como antes; mover para qualquer outra etapa não mexe em toques

### US-054 — Concluir um toque e liberar o próximo bloco

Como SDR, quero registrar o resultado de cada toque e ter o próximo bloco liberado sozinho, para seguir a cadência sem controle externo.

#### AC-193 — Concluir com `sem_resposta` registra o fato

- **Dado** um toque pendente de um card do tenant, liberado para o turno
- **Quando** o usuário chama `POST /api/atividades/:id/concluir` com `resultado = sem_resposta`
- **Então** o toque fica com `resultado = sem_resposta`, `realizada_em` e `realizada_por` preenchidos, e um evento `atividade_concluida` é gravado no log do card

#### AC-194 — Terceiro `sem_resposta` do bloco libera o seguinte

- **Dado** um bloco de manhã com 2 toques concluídos `sem_resposta`
- **Quando** o terceiro é concluído `sem_resposta`
- **Então** os 3 toques do bloco da tarde do mesmo dia são gerados (sequências 4–6), mas só ficam visíveis na fila a partir das 13h (AC-192); concluído o bloco da tarde do dia 1 ou 2, o seguinte só nasce na virada de dia (AC-199)

#### AC-195 — `conectou` interrompe a cadência na hora

- **Dado** um card com toques pendentes
- **Quando** um toque é concluído com `resultado = conectou`
- **Então** os demais pendentes viram `cancelada`, `cadencia_encerrada_em` é preenchido e o card vai para "Qualificando" por `mover_oportunidade`, tudo na mesma transação, sem gerar novos blocos

#### AC-196 — Toque fora de ordem ou fora do turno é recusado

- **Dado** um toque cujo bloco ainda não foi liberado (turno da tarde antes das 13h, ou bloco anterior pendente)
- **Quando** o usuário tenta concluí-lo
- **Então** a resposta é 422 com `TURNO_NAO_LIBERADO` ou `BLOCO_ANTERIOR_PENDENTE`, e o toque continua pendente

#### AC-197 — Toque já concluído, cancelado ou de cadência encerrada não conclui de novo

- **Dado** um toque que não está `pendente`, ou de um card com `cadencia_encerrada_em` preenchido
- **Quando** o usuário tenta concluí-lo
- **Então** a resposta é 422 com `CADENCIA_ENCERRADA` (ou 409 se a versão do card estiver velha), e nada muda

#### AC-198 — Concluir exige sessão, tenant e versão

- **Dado** uma versão desatualizada do card, um toque de outra empresa e uma requisição sem login
- **Quando** cada um tenta concluir o toque
- **Então** a resposta é 409 (`CONFLITO_DE_VERSAO`), 404 e 401, e o toque não muda

### US-055 — Virada de dia e esgotamento

Como gestor comercial, quero que o dia da cadência avance por fato e que, esgotados os 18 toques, o card vá para Perdido, para que nenhum lead fique em cadência eterna nem pule etapa por tempo.

#### AC-199 — Virada de dia avança só quem concluiu o dia inteiro

- **Dado** um dia útil, um card em "1º dia" com os dois blocos do dia concluídos `sem_resposta` e outro card com toque pendente
- **Quando** o job diário de virada roda
- **Então** o primeiro vai para "2º dia" (ou "3º dia") com os 3 toques da manhã seguinte gerados; o segundo não muda de etapa e fica marcado como atrasado

#### AC-200 — Fim de semana e feriado não viram o dia

- **Dado** um sábado, um domingo ou um feriado nacional
- **Quando** o job diário roda
- **Então** nenhum card muda de dia, nenhum bloco é gerado e a execução é registrada em `cron_execucoes` com 0 itens processados

#### AC-201 — Esgotar os 18 toques manda para Perdido

- **Dado** um card no 3º dia com os toques 1–17 `sem_resposta`
- **Quando** o toque 18 (breakup) é concluído `sem_resposta`
- **Então** o card vai para "Perdido" com o motivo sistêmico "Cadência esgotada", `cadencia_encerrada_em` é preenchido e o evento registra `ator_tipo = sistema`; a resposta indica que a oferta de tarefa de revisita em 30–60 dias está disponível

#### AC-202 — Job é idempotente, protegido por segredo e auditável

- **Dado** a rota interna do job de virada
- **Quando** é chamada sem o segredo, com o segredo, e duas vezes seguidas com o segredo no mesmo dia
- **Então** sem segredo responde 401 e não toca em nada; com segredo roda e grava uma linha em `cron_execucoes` (`sucesso`, itens processados); a segunda chamada do mesmo dia não duplica toques nem avança de novo o mesmo card

#### AC-203 — Cada empresa só vê e vira os próprios cards

- **Dado** cards em cadência de duas empresas
- **Quando** a fila é consultada e o job roda
- **Então** a fila de cada usuário só traz toques da própria empresa, e o job vira os cards de ambas, sem nunca misturar toque ou evento entre tenants

## Fora de escopo

- A tela "Minhas tarefas" (UI da fila) — feature seguinte.
- Criar a `tarefa_agendada` de revisita em 30–60 dias: aqui só se sinaliza a oferta.
- Reatribuição em massa de responsável (Q-019: a cadência segue, só troca o dono).
- Reuniões, No-show, reabertura de Perdido/Ganho e campanhas.
- Aplicar migrations e agendar o job na VPS (só o código e a prova em CI).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-057 | Os feriados nacionais vêm de uma lista fixa versionada no repositório (anos 2026 e 2027), atualizada uma vez por ano; sem API externa. | confirmada | Decidido pelo usuário em 2026-10-14 (Q-018). |
| ASM-058 | O job diário roda como rota interna (`POST /api/cron/cadencia`) protegida por segredo (`CRON_SEGREDO`), chamada pelo agendador da VPS; registra em `cron_execucoes`. Sem processo worker novo. | confirmada | Decidido pelo usuário em 2026-10-14. |
| ASM-059 | "Atrasado" é um estado derivado (card em dia/turno anterior com toque pendente), não uma coluna nova; aparece na fila e na resposta, sem migration só para isso. | confirmada | Confirmada pelo usuário em 2026-10-14. |
| ASM-060 | Cada toque concluído, o início da cadência, a virada de dia e o esgotamento geram um evento em `oportunidade_eventos` (tipos `cadencia_iniciada`, `atividade_concluida`, `cadencia_dia_avancado`, `cadencia_esgotada`); a transição de etapa continua gerando `transicao_etapa` por `mover_oportunidade`. | confirmada | Confirmada pelo usuário em 2026-10-14. |
| ASM-061 | A fila e a conclusão valem para o responsável do card; MASTER, GERENTE e super admin também podem concluir toques de cards do tenant (para cobrir ausência), ATENDENTE só os próprios. | confirmada | Confirmada pelo usuário em 2026-10-14. |
| ASM-062 | O horário usado para turno e liberação é sempre o do servidor em `America/Sao_Paulo`; os testes injetam o relógio, nunca dependem de `Date.now()` real. | confirmada | Convenção do TDD-001 §4.5 e do domínio puro. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-018 | Qual a fonte dos feriados nacionais que pausam a cadência (TDD §17, pergunta 4)? | respondida | Lista fixa versionada no repositório (decidido pelo usuário em 2026-10-14). |
| Q-019 | O que acontece com um card em cadência quando o responsável muda ou sai de férias (TDD §17, pergunta 5)? | respondida | A cadência segue; só troca o dono e os toques pendentes passam para o novo responsável. Reatribuição em massa fica fora desta feature (decidido pelo usuário em 2026-10-14). |
| Q-020 | O bloco da tarde deve ficar visível a partir das 13h em ponto, ou o SDR pode antecipar se terminou a manhã cedo? | respondida | Só a partir das 13h e com a manhã concluída (TDD-001 §4.5 regra 3, Q1 do PRD); sem antecipação. |
