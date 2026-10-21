# Spec: Fase 2d — KPIs e relatório do funil comercial

> feature: fase2d-kpis
> status: auditada

## Contexto

A liderança comercial (Alana, Erivelton) hoje não consegue confiar nas métricas: as telas `/relatorios` e `/relatorios-comerciais` leem os leads legados e contam "o que a planilha diz". O modelo novo já grava um log append-only de tudo o que acontece com cada card (`oportunidade_eventos`: transições de etapa, cadência iniciada, toques concluídos, conexão, cadência esgotada). Esta feature calcula os indicadores do PRD-001 §6 sobre esse log, expõe a rota `GET /api/relatorios/kpis` (TDD-001 §4.5) e entrega a página **Indicadores** do CRM novo, para que a liderança acompanhe o funil sem planilha. As telas legadas de relatórios não são alteradas aqui.

## Histórias

### US-061 — Calcular os indicadores do funil a partir do log de eventos

Como liderança comercial, quero que os indicadores do PRD §6 sejam calculados sobre o log de eventos, para que o número que eu vejo seja auditável e não dependa de preenchimento manual.

#### AC-221 — Taxa de conexão (reach rate)

- **Dado** 10 cards criados no período, dos quais 4 têm um evento de conexão (toque concluído como "Conectou" ou conexão por WhatsApp)
- **Quando** a liderança consulta os KPIs desse período
- **Então** a taxa de conexão é 40% (numerador 4, denominador 10), e cada card conta uma única vez mesmo com várias conexões

#### AC-222 — Cumprimento da régua de 18 toques

- **Dado** 5 cards que iniciaram a cadência no período, dos quais 2 tiveram a cadência esgotada (os 18 toques concluídos sem conexão)
- **Quando** a liderança consulta os KPIs
- **Então** o cumprimento da cadência é 40% (numerador 2, denominador 5)

#### AC-223 — Taxas de agendamento, no-show, proposta e conversão

- **Dado** cards do período que passaram pelas etapas do funil (conectados, "Reunião agendada", "No-show", "Reunião realizada", "Proposta", "Contrato (Ganho)")
- **Quando** a liderança consulta os KPIs
- **Então** a resposta traz: agendamento = com "Reunião agendada" ÷ conectados; no-show = com "No-show" ÷ com "Reunião agendada"; proposta = com "Proposta" ÷ com "Reunião realizada"; conversão (win rate) = com "Contrato (Ganho)" ÷ com "Proposta"

#### AC-224 — Divisão por zero não vira número falso

- **Dado** um período em que o denominador de um indicador é zero (por exemplo, nenhuma reunião agendada)
- **Quando** a liderança consulta os KPIs
- **Então** esse indicador volta sem valor (`valor: null`, numerador 0, denominador 0) — nunca 0% nem erro — e os demais indicadores são calculados normalmente

#### AC-225 — Cada indicador traz numerador e denominador

- **Dado** qualquer consulta de KPIs bem-sucedida
- **Quando** a resposta é lida
- **Então** cada um dos indicadores (conexão, cumprimento da cadência, agendamento, no-show, proposta, ativação do trial, conversão) traz `valor`, `numerador` e `denominador`, para que a liderança confira a conta

### US-062 — Filtrar por período e por responsável, só dentro da própria empresa

Como gerente comercial, quero filtrar os indicadores por período e por responsável, para comparar semanas e pessoas sem ver dados de outra empresa.

#### AC-226 — Filtro de período

- **Dado** cards criados dentro e fora do intervalo `de`–`ate`
- **Quando** a rota é chamada com `de` e `ate` (datas, fuso `America/Sao_Paulo`, `ate` inclusivo)
- **Então** só entram na conta os cards criados no intervalo; sem `de`/`ate`, o padrão é o mês corrente

#### AC-227 — Filtro por responsável

- **Dado** cards de dois responsáveis diferentes no período
- **Quando** a rota é chamada com `responsavelId`
- **Então** os indicadores consideram só os cards desse responsável

#### AC-228 — Isolamento entre empresas

- **Dado** cards de duas empresas no mesmo período
- **Quando** um usuário da empresa A consulta os KPIs
- **Então** nenhum card da empresa B entra na conta, nem passando o `empresaId` de B na query (a empresa vem só da sessão)

#### AC-229 — Quem pode ver

- **Dado** usuários de uma empresa com os papéis MASTER, GERENTE e ATENDENTE, e um visitante sem sessão
- **Quando** cada um chama `GET /api/relatorios/kpis`
- **Então** MASTER, GERENTE e super admin recebem 200; ATENDENTE recebe 403 `SEM_PERMISSAO`; sem sessão, 401 `NAO_AUTENTICADO`

#### AC-230 — Parâmetros inválidos são recusados

- **Dado** uma consulta com `de` maior que `ate`, data mal formada ou `responsavelId` que não é UUID
- **Quando** a rota é chamada
- **Então** responde 400 com `PARAMETRO_INVALIDO` e uma mensagem em português, sem consultar o banco

### US-063 — Ver os indicadores em uma página própria

Como liderança comercial, quero abrir uma página "Indicadores" com os números do funil, para acompanhar o desempenho sem montar planilha.

#### AC-231 — A página exige login e tem item no menu

- **Dado** o menu lateral do CRM
- **Quando** MASTER, GERENTE ou super admin o abre, e quando alguém sem sessão acessa `/indicadores`
- **Então** o menu mostra "Indicadores" levando a `/indicadores` (oculto para ATENDENTE); sem sessão, o acesso vai ao login e nenhum número é carregado

#### AC-232 — A página mostra cada indicador com a conta

- **Dado** uma resposta de KPIs com valores
- **Quando** a página é exibida
- **Então** cada indicador aparece como cartão com o percentual, o nome por extenso e a conta ("4 de 10"); indicador sem valor mostra "—" e "sem dados no período"

#### AC-233 — Filtros da página recarregam os números

- **Dado** a página aberta no mês corrente
- **Quando** o usuário muda o período ou escolhe um responsável
- **Então** a página consulta a rota com os novos filtros, mostra o estado de carregando e substitui os números; falha da rota mostra mensagem de erro com botão "Tentar de novo", sem apagar os números anteriores

## Fora de escopo

- Campanhas (feature própria da fase 2d) e administração de usuários/convites.
- Reescrever ou remover as telas legadas `/relatorios` e `/relatorios-comerciais`.
- Exportação (CSV/PDF), gráficos de série temporal, forecast e comparação entre períodos.
- Mudar o modelo de eventos ou as regras de transição/cadência — a feature só LÊ o log.
- Cache e materialização dos números (calcula na hora; reavaliar se ficar lento).
- Regra de no-show "sem aviso prévio de 24h": depende das rotas de reunião (`/api/reunioes/:id/remarcar`), ainda não entregues.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-069 | O período filtra pela data de criação do card (coorte): todos os indicadores respondem "dos cards criados no período, quantos chegaram a X". Os eventos de cada card são lidos sem limite de data. | confirmada | Confirmada pelo usuário em 2026-10-16 (resposta a Q-024: coorte). |
| ASM-070 | "Chegou à etapa X" = existe evento `transicao_etapa` com `etapa_destino_id = X`. Etapas: 8 Reunião agendada, 9 No-show, 10 Reunião realizada, 11 Proposta, 15 Contrato (Ganho). Reabertura e retorno não contam duas vezes (distinct por card). | confirmada | Confirmada pelo usuário em 2026-10-16. |
| ASM-071 | "Conectado" = card com evento `atividade_concluida` de resultado `conectou` OU evento `conexao_whatsapp`. "Cadência esgotada" = evento `cadencia_esgotada`. "Iniciou cadência" = evento `cadencia_iniciada`. | confirmada | Confirmada pelo usuário em 2026-10-16. |
| ASM-072 | O no-show do PRD ("sem aviso prévio de 24h") é aproximado, nesta feature, por "card que chegou à etapa No-show ÷ card que chegou a Reunião agendada", pois a regra de 24h ainda não existe no sistema. | confirmada | Confirmada pelo usuário em 2026-10-16. |
| ASM-073 | A resposta da rota usa `{ valor, numerador, denominador }` por indicador (em vez de números soltos como no esboço do TDD-001 §4.5), e `valor` é fração 0–1 (a tela formata em %). | confirmada | Confirmada pelo usuário em 2026-10-16. |
| ASM-074 | Só MASTER, GERENTE e super admin acessam os indicadores; ATENDENTE não (relatório gerencial). | confirmada | Confirmada pelo usuário em 2026-10-16. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-023 | "Ativação no trial" (% de leads em teste que efetivamente usam o sistema) não tem fonte de dados no CRM: o uso do sistema acontece fora dele. Como medir? Enquanto não houver resposta, o indicador volta `valor: null` com denominador = cards que chegaram a "Teste (Trial)" e numerador 0. | respondida | Fica sem valor por ora (decidido pelo usuário em 2026-10-16): `valor: null`, denominador = cards que chegaram a "Teste (Trial)", numerador 0; a fonte de dados será definida depois com a liderança. |
| Q-024 | A liderança prefere o período por coorte (cards criados no período, ASM-069) ou por evento (conversões que ocorreram no período, qualquer que seja a data de criação do card)? | respondida | Por coorte: cards criados no período (decidido pelo usuário em 2026-10-16; ASM-069). |
