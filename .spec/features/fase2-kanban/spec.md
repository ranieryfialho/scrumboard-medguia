# Spec: Fase 2 — Kanban de 15 etapas

> feature: fase2-kanban
> status: auditada

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - US-xxx = história de usuário · AC-xxx = critério de aceite
    ASM-xxx = suposição · Q-xxx = pergunta em aberto
    São códigos de rastreio: ligam a especificação às tarefas e aos testes.
  - Toda história de usuário precisa de pelo menos um critério de aceite.
  - Todo critério de aceite precisa de Dado/Quando/Então completos.
  - Os códigos são únicos no projeto inteiro (nunca reutilize um número).
  - Suposições e Perguntas em aberto são OBRIGATÓRIAS: se não há nenhuma,
    escreva "Nenhuma." — mas desconfie: quase toda feature esconde uma.
-->

## Contexto

O domínio das transições (fase1-dominio-pipeline: grafo + papel + guards) e o
repositório de oportunidades com isolamento por tenant (fase1-repositorios-
isolamento) já existem, mas nada os conecta a uma tela nem a uma rota HTTP —
hoje não há nenhum jeito de mover um card. Esta é a "f2a" do roadmap do
TDD-001 §18 ("Kanban de 15 etapas + modais de trava"): entrega as rotas
HTTP que compõem domínio + repositório numa escrita real, e o board visual
(TDD-001 §4.6) onde o time comercial vê e move os cards pelas 15 etapas do
playbook, sendo barrado por um modal sempre que faltar um dado obrigatório —
nunca por um erro genérico sem explicação.

## Fora de escopo

- Motor de cadência (geração de blocos, virada de dia, 18 toques, fila de
  turno) e a rota `/api/oportunidades/:id/cadencia/iniciar` — feature futura
  (TDD-001 §18, f2b).
- Regras específicas de reunião (duração mínima, resumo, remarcação com 24h,
  integração com Calendar) e as rotas `/api/reunioes/*` — feature futura
  (f2b). Consequência direta: a transição para a etapa "Reunião realizada"
  (id 10, `exige_evidencia=true`) fica **bloqueada nesta feature** — ela
  exige um `anexoId` e não há como gerar um sem upload (ver ASM-020). O board
  mostra a coluna, mas nenhum card chega lá até a feature de anexos existir.
- Upload/colagem de print (`/api/anexos`) — feature futura (f2c, junto com
  WhatsApp). Decisão do usuário nesta conversa (2026-09-25): fora de escopo
  agora, mesmo sabendo da consequência acima.
- WhatsApp, SSE (`/api/stream`), conexão automática por mensagem — feature
  futura (f2c).
- Relatórios, KPIs, campanhas, admin, espelho no Sheets — features futuras
  (f2d/f2e).
- Autenticação/sessão/RBAC em si (login, convite, troca de empresa) — já
  entregues por fase1-auth-rbac; esta feature só CONSOME
  `resolverContextoTenant`.
- Alterar o grafo, os guards ou o cálculo de papel — já entregues por
  fase1-dominio-pipeline; esta feature só CHAMA `validarTransicao`.

## Histórias

### US-029 — Ver o board agrupado pelas 15 etapas do playbook

Como usuário comercial autenticado, quero ver os cards da minha empresa
organizados pelas 15 etapas do pipeline, para saber de relance onde cada
negociação está.

#### AC-074 — Board só mostra cards do tenant da sessão

- **Dado** duas empresas com cards em etapas diferentes
- **Quando** um usuário autenticado da empresa A pede o board
  (`GET /api/oportunidades`)
- **Então** a resposta só contém cards da empresa A — nenhum card da empresa
  B aparece, mesmo que o chamador tente influenciar isso via query string

#### AC-075 — Cada card do board traz os dados básicos pra exibição

- **Dado** um card com lead, responsável e valor preenchidos
- **Quando** o board é consultado
- **Então** o card retornado inclui nome do lead, nome do responsável (ou
  nulo, se sem responsável) e valor (ou nulo)

#### AC-076 — Filtro por etapa restringe o resultado a essa etapa

- **Dado** cards em etapas diferentes
- **Quando** o board é consultado com `etapaId` de uma etapa específica
- **Então** só voltam cards daquela etapa

#### AC-077 — Filtro por responsável restringe o resultado a esse responsável

- **Dado** cards com responsáveis diferentes
- **Quando** o board é consultado com `responsavelId` de um usuário
  específico
- **Então** só voltam cards daquele responsável

#### AC-078 — Sem sessão válida, o board é recusado antes de tocar no banco

- **Dado** uma requisição sem cookie de sessão válido (ausente, expirado ou
  revogado)
- **Quando** `GET /api/oportunidades` é chamado
- **Então** a resposta é `401` e nenhuma query é feita ao banco

#### AC-094 — Board expõe as etapas de destino alcançáveis a partir de cada etapa

- **Dado** o grafo cadastrado em `pipeline_transicoes`
- **Quando** o board é consultado
- **Então** a resposta inclui, para cada uma das 15 etapas, a lista de ids
  das etapas de destino alcançáveis a partir dela (decisão do usuário nesta
  conversa, 2026-09-25: o frontend usa essa lista para restringir
  visualmente o drag-and-drop só às colunas alcançáveis — ver Q-009)

### US-030 — Criar um card manualmente em "Entrada de leads"

Como usuário comercial, quero criar um card a partir de um lead já
cadastrado, para começar a trabalhar uma oportunidade que não veio por
importação automática.

#### AC-079 — Card novo nasce em "Entrada de leads", version 1

- **Dado** um lead existente no tenant da sessão
- **Quando** `POST /api/oportunidades` é chamado com esse `leadId`
- **Então** o card criado tem `etapaId = 1` (Entrada de leads) e `version = 1`

#### AC-080 — Card novo pertence ao tenant da sessão, nunca ao do corpo

- **Dado** uma sessão da empresa A
- **Quando** `POST /api/oportunidades` é chamado (mesmo que o corpo tente
  incluir um `empresaId` de outra empresa)
- **Então** o card criado tem `empresaId` da sessão — o valor do corpo é
  ignorado (mesma convenção de AC-043, fase1-auth-rbac)

#### AC-081 — Lead inexistente ou de outro tenant é rejeitado

- **Dado** um `leadId` que não existe no tenant da sessão (não existe em
  lugar nenhum, ou existe só em outra empresa)
- **Quando** `POST /api/oportunidades` é chamado com esse `leadId`
- **Então** a resposta é um erro nomeado (`LEAD_NAO_ENCONTRADO`) e nenhum
  card é criado

### US-031 — Mover um card respeitando grafo, papel e dados obrigatórios

Como sistema, quero que o único jeito de mudar a etapa de um card seja
através da validação de domínio já existente, gravando etapa e dados
obrigatórios juntos ou nada, para que o board nunca mostre um card em estado
inconsistente com o playbook.

#### AC-082 — Transição permitida grava etapa, dados de guard e evento atomicamente

- **Dado** uma transição dentro do grafo, com papel permitido e todos os
  dados obrigatórios da etapa de destino presentes e válidos (ex.: mover
  para "Proposta" com `valor > 0` e `proximaAcaoEm` futura)
- **Quando** `POST /api/oportunidades/:id/transicao` é chamado
- **Então** a resposta é `200`, o card responde com a nova etapa, o `valor`/
  `motivoPerdaId`/`proximaAcaoEm` enviados ficam gravados na mesma linha, a
  `version` incrementou em 1, e um evento `transicao_etapa` foi gravado — tudo
  na mesma transação (se qualquer parte falhar, nada é gravado)

#### AC-083 — Transição fora do grafo não move o card

- **Dado** um card na etapa X
- **Quando** `POST /api/oportunidades/:id/transicao` pede uma etapa de
  destino sem linha correspondente em `pipeline_transicoes` a partir de X
- **Então** a resposta é `422` com `codigo: "TRANSICAO_NAO_PERMITIDA"`, e o
  card continua na etapa X com a mesma `version`

#### AC-084 — Transição com papel sem permissão não move o card

- **Dado** uma transição cujo `papeisPermitidos` não inclui o papel do ator
  da sessão (e o ator não é super admin)
- **Quando** `POST /api/oportunidades/:id/transicao` é chamado
- **Então** a resposta é `422` com `codigo: "PAPEL_NAO_PERMITIDO"`, e o card
  não muda

#### AC-085 — Transição com dado obrigatório faltante não move o card

- **Dado** uma transição para uma etapa com `exigeValor=true` e a requisição
  não informa `valor` (ou informa `valor <= 0`)
- **Quando** `POST /api/oportunidades/:id/transicao` é chamado
- **Então** a resposta é `422` com `codigo: "VALOR_OBRIGATORIO"` (mesmo
  padrão para `MOTIVO_PERDA_OBRIGATORIO`, `PROXIMA_ACAO_OBRIGATORIA`,
  `EVIDENCIA_OBRIGATORIA`, `JUSTIFICATIVA_OBRIGATORIA`), e o card não muda

#### AC-086 — Conflito de versão é rejeitado sem sobrescrever

- **Dado** um card na `version` 3, e uma requisição de transição informando
  `version: 2` (desatualizada — outro ator já moveu o card antes)
- **Quando** `POST /api/oportunidades/:id/transicao` é chamado
- **Então** a resposta é `409` (ou `422`, ver ASM-021) com
  `codigo: "CONFLITO_DE_VERSAO"`, e o card permanece exatamente como estava
  (etapa, dados e version 3 inalterados)

#### AC-087 — Card de outro tenant não é encontrado (fail closed)

- **Dado** um card que existe, mas pertence a outra empresa
- **Quando** `POST /api/oportunidades/:id/transicao` é chamado por uma
  sessão de empresa diferente
- **Então** a resposta é `404` (o card "não existe" do ponto de vista do
  chamador) — nunca `403` revelando que o id existe em outro tenant

### US-032 — Preencher o dado que falta antes de mover (modal de trava)

Como usuário comercial, quando tento mover um card e falta um dado
obrigatório daquela etapa, quero que a tela me peça exatamente esse dado num
modal, para completar a informação sem perder o movimento que eu já fiz.

#### AC-088 — Rejeição por dado obrigatório abre o modal correspondente

- **Dado** um card sendo arrastado para uma etapa que exige um dado ausente
- **Quando** a tentativa de transição é rejeitada com um dos códigos
  `VALOR_OBRIGATORIO`, `MOTIVO_PERDA_OBRIGATORIO`, `PROXIMA_ACAO_OBRIGATORIA`
  ou `JUSTIFICATIVA_OBRIGATORIA`
- **Então** a tela abre um modal pedindo especificamente o campo indicado
  pelo código (não um erro genérico), e o card volta visualmente pra coluna
  de origem até o modal ser resolvido

#### AC-089 — Preencher e confirmar o modal reenvia a transição com o dado

- **Dado** o modal de AC-088 aberto
- **Quando** o usuário preenche o campo pedido e confirma
- **Então** a tela reenvia `POST /api/oportunidades/:id/transicao` com o
  mesmo destino mais o dado preenchido, e o card se move para a nova etapa
  ao suceder

#### AC-090 — Cancelar o modal não faz nenhuma chamada

- **Dado** o modal de AC-088 aberto
- **Quando** o usuário cancela
- **Então** nenhuma requisição de transição é enviada, e o card permanece na
  etapa original

#### AC-091 — Rejeição por grafo ou papel mostra mensagem, sem abrir modal de dado

- **Dado** um card sendo arrastado para um destino inválido
- **Quando** a tentativa de transição é rejeitada com `TRANSICAO_NAO_PERMITIDA`
  ou `PAPEL_NAO_PERMITIDO`
- **Então** a tela mostra uma mensagem explicando a causa (não um modal de
  preenchimento, já que não há campo que resolva) e o card volta pra coluna
  de origem

### US-033 — Ver o detalhe de um card

Como usuário comercial, quero abrir um card e ver seus dados completos, para
decidir o próximo passo sem depender só do que cabe no cartão do board.

#### AC-092 — Detalhe traz os dados do card

- **Dado** um card existente no tenant da sessão
- **Quando** `GET /api/oportunidades/:id` é chamado
- **Então** a resposta inclui lead, responsável, etapa atual, valor, motivo
  de perda (quando houver) e próxima ação (quando houver)

#### AC-093 — Detalhe de card de outro tenant não é acessível

- **Dado** um card que existe, mas pertence a outra empresa
- **Quando** `GET /api/oportunidades/:id` é chamado por uma sessão de outra
  empresa
- **Então** a resposta é `404` (fail closed, mesmo padrão de AC-087)

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-019 | `mover_oportunidade` precisa ganhar parâmetros novos (`p_valor`, `p_motivo_perda_id`, `p_proxima_acao_em`) e passar a gravá-los no mesmo `UPDATE` que muda a etapa — decisão do usuário nesta conversa (2026-09-25), ver AC-082. Isso é uma migration nova (`000X_fn_mover_oportunidade_guards.sql`), não uma edição da 0003 (convenção já usada no projeto: mudança de função = `CREATE OR REPLACE`, versionada por migration nova). | confirmada | Decidido pelo usuário: estender a função em vez de orquestrar duas escritas na API. |
| ASM-020 | A transição para "Reunião realizada" (id 10) fica inatingível nesta feature porque exige `anexoId` e o upload de anexo está fora de escopo — decisão explícita do usuário (2026-09-25), aceitando a consequência. | confirmada | Usuário confirmou o recorte sem incluir upload de anexo. |
| ASM-021 | O código HTTP de `CONFLITO_DE_VERSAO` é `409 Conflict` (mais correto semanticamente que o `422` que o TDD-001 usa para os demais erros de domínio, já que não é "dado inválido" e sim "estado mudou embaixo do pé") — a Q-005/Q-006 de fase1-auth-rbac já usou o mesmo raciocínio de escolher o código HTTP mais preciso quando o TDD não especifica. | confirmada | Confirmado pelo usuário (Raniery) em 2026-10-02: manter 409 Conflict. |
| ASM-022 | O `GET /api/oportunidades` desta feature não implementa o filtro `busca` (texto livre por nome do lead) do contrato do TDD-001 §4.6 — é um filtro de UX que pode ser adicionado depois sem quebrar o contrato (query param a mais, opcional); os filtros centrais para o Kanban funcionar são etapa e responsável. | confirmada | Confirmado pelo usuário (Raniery) em 2026-10-02: corte mantido; busca por nome fica para feature futura. |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-009 | O board precisa suportar drag-and-drop tocando etapas fora do grafo permitido (deixando o usuário arrastar pra qualquer coluna e só descobrir o erro depois), ou o frontend deve restringir visualmente o drop só às etapas alcançáveis a partir da etapa atual (calculado a partir de `pipeline_transicoes`, que já dá pra buscar)? Afeta se esta feature expõe uma rota de leitura do grafo (`GET /api/pipeline/etapas` ou embutir no board) ou não. | respondida | Decidido pelo usuário (2026-09-25): restringir visualmente. O board (AC-094) passa a incluir as etapas de destino alcançáveis por etapa, embutidas na própria resposta — sem rota nova. |
