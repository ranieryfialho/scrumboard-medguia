# Spec: Fase 1 — Repositórios + isolamento

> feature: fase1-repositorios-isolamento
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

A `fase1-schema-drizzle` provou que o banco isola tenants por RLS (AC-019,
AC-020) e deixou explícito, em comentário no schema, que "aplicar
`SET LOCAL app.empresa_id` a partir do código Next.js" é escopo desta feature.
A `fase1-auth-rbac` entregou `resolverContextoTenant` (T-031), que resolve
`empresa_id`/papel a partir da sessão — mas nada no código hoje usa esse
contexto para consultar o banco: não existe camada de dados no servidor. Esta
feature entrega essa camada — repositórios para `leads` e `oportunidades` que
só aceitam o contexto de tenant já resolvido (nunca um `empresa_id` cru vindo
do chamador), abrem cada operação numa transação com
`SET LOCAL app.empresa_id` do contexto, e são provados por teste de
integração com dois tenants reais que a aplicação — não só o banco — nunca
deixa vazar dado entre empresas (TDD-001 §4.7/§7, defesa em profundidade
camada 2 de 3: sessão → **repositório** → RLS).

## Histórias

<!-- História de usuário: quem precisa, o que precisa e por quê. -->

### US-026 — Toda operação de repositório roda sob o tenant do contexto

Como desenvolvedor consumindo a camada de dados, quero que toda função de
repositório receba o contexto de tenant já resolvido da sessão (nunca um
`empresa_id` solto) e sete `app.empresa_id` antes de qualquer consulta, para
que seja estruturalmente impossível esquecer o filtro de tenant numa query.

#### AC-065 — Contexto de tenant define `app.empresa_id` antes de qualquer query

- **Dado** um `ContextoTenant` válido (resolvido por `resolverContextoTenant`)
  com `empresaId` = X
- **Quando** uma função de repositório é chamada com esse contexto
- **Então** a operação roda dentro de uma transação onde
  `SET LOCAL app.empresa_id` foi executado com o valor X antes de qualquer
  `SELECT`/`INSERT`/`UPDATE`

#### AC-066 — Repositório sem contexto de tenant não executa nenhuma query

- **Dado** nenhuma chamada a uma função de repositório informa um
  `ContextoTenant`
- **Quando** o código tenta compilar uma chamada de repositório sem esse
  parâmetro
- **Então** a assinatura das funções de repositório não aceita a chamada sem
  contexto (erro de tipo — nenhuma função de repositório tem `empresaId`
  opcional ou `db` cru como parâmetro alternativo de acesso)

#### AC-067 — Conexão do repositório usa a role de aplicação, sem bypass de RLS

- **Dado** o pool de conexão usado pelos repositórios
- **Quando** se inspeciona a role usada para autenticar
- **Então** é a role `crm_app` (nunca `crm_migrator` nem um usuário
  administrador) — a mesma role que, sem `SET LOCAL app.empresa_id`, o
  AC-020 já prova que não lê nem escreve nenhuma linha

### US-027 — Isolamento entre empresas provado pela aplicação, não só pelo banco

Como responsável pela segurança de dados, quero que os repositórios de
`leads` e `oportunidades` sejam provados, por teste de integração com dois
tenants reais, a nunca ler ou escrever dado de uma empresa a partir do
contexto de outra — mesmo quando o chamador tenta forçar isso — para que a
defesa em profundidade do TDD-001 §4.7 não dependa só do RLS.

#### AC-068 — Listagem só retorna registros do tenant do contexto

- **Dado** leads e oportunidades cadastrados para a empresa A e para a
  empresa B
- **Quando** o repositório lista leads (ou oportunidades) usando o contexto
  de tenant da empresa A
- **Então** somente registros da empresa A retornam — nenhum de B aparece,
  mesmo que B tenha registros criados antes ou depois

#### AC-069 — Busca por id de outro tenant não retorna nada (fail closed)

- **Dado** uma oportunidade (ou lead) que pertence à empresa B, com um `id`
  conhecido
- **Quando** o repositório busca esse `id` usando o contexto de tenant da
  empresa A
- **Então** a busca não retorna a linha (resultado vazio/nulo), não lança
  erro que revele que o registro existe em outra empresa

#### AC-070 — Atualização por id de outro tenant não altera nada

- **Dado** uma oportunidade que pertence à empresa B, com um `id` conhecido
- **Quando** o repositório tenta atualizar essa oportunidade (ex.: `valor`,
  `responsavelId`) usando o contexto de tenant da empresa A
- **Então** nenhuma linha é alterada — a oportunidade em B permanece com os
  valores originais, e a operação reporta zero linhas afetadas (não lança
  como se tivesse sucesso)

#### AC-071 — Criação ignora `empresaId` vindo do chamador e usa o do contexto

- **Dado** um contexto de tenant da empresa A
- **Quando** o repositório cria um lead (ou uma oportunidade) recebendo, no
  payload de entrada, um `empresaId` diferente de A (ou nenhum)
- **Então** o registro criado tem `empresa_id = A` — o valor do payload é
  ignorado, nunca lido para essa coluna

### US-028 — Listagem de oportunidades com filtro e paginação

Como desenvolvedor consumindo a camada de dados, quero listar oportunidades
filtrando por etapa e/ou responsável e paginando o resultado, para que o
Kanban e as futuras rotas HTTP não precisem carregar todas as oportunidades
do tenant de uma vez.

#### AC-072 — Filtro por etapa e por responsável restringe o resultado

- **Dado** oportunidades da empresa A em etapas e responsáveis diferentes
- **Quando** o repositório lista oportunidades do contexto da empresa A
  informando `etapaId` e/ou `responsavelId`
- **Então** só retornam oportunidades de A que casam com os filtros
  informados — os filtros combinam com E (ambos, quando os dois são
  informados)

#### AC-073 — Paginação limita o tamanho da página e permite avançar

- **Dado** mais oportunidades da empresa A do que o tamanho de página pedido
- **Quando** o repositório lista oportunidades do contexto da empresa A
  informando um limite de página
- **Então** a resposta traz no máximo esse limite de itens e uma forma de
  buscar a página seguinte (deslocamento/cursor), sem repetir nem pular
  itens entre páginas consecutivas

## Fora de escopo

- Rotas HTTP (`/api/oportunidades/*`, `/api/leads/*`) — esta feature entrega
  a camada de dados que essas rotas vão consumir, não os endpoints em si
  (fica para a próxima fatia: rotas HTTP + SSE).
- Chamar a função SQL `mover_oportunidade` ou orquestrar
  `validarTransicao` (`fase1-dominio-pipeline`) + persistência — isso é
  escopo da feature de rotas HTTP, que vai compor domínio + repositório.
- Repositórios para as demais tabelas do pipeline (`cadencia_atividades`,
  `oportunidade_eventos`, `tarefas_agendadas`, `anexos`, `reunioes`,
  `whatsapp_mensagens`, `campanhas`, `envios_campanha`) — ficam para quando a
  funcionalidade que as consome for especificada (motor de cadência, anexos,
  campanhas), reaproveitando o mesmo padrão (`comTenant`/`SET LOCAL`) desta
  feature.
- Cache, paginação ou índices adicionais além dos já previstos no TDD-001
  §4.3 (schema já criado pela `fase1-schema-drizzle`).
- Testar RLS a nível de SQL cru (`pg_tables`/`pg_policies`,
  "role sem `SET LOCAL` não lê nada") — já provado em AC-019/AC-020 da
  `fase1-schema-drizzle`; esta feature prova o comportamento **através da
  API dos repositórios**, não repete o teste de infraestrutura.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-016 | Os testes desta feature sobem seu próprio Postgres 15 efêmero (mesmo harness `test/support/postgres-efemero.ts` de `fase1-schema-drizzle`/`fase1-auth-rbac`), conectando como `crm_app` via `appUrl` para os repositórios e como `crm_migrator` só para popular dados de teste (dois tenants) — sem tocar `crm_staging`/`crm_prod` da VPS | confirmada | Mesmo padrão já usado em duas features anteriores (`fase1-schema-drizzle`, `fase1-auth-rbac`) — sem indicação de mudança. |
| ASM-017 | O padrão de acesso é "uma transação por operação de repositório" (abre transação, `SET LOCAL app.empresa_id`, executa a query, comita) — não uma transação de vida longa compartilhada entre várias chamadas de repositório numa mesma requisição HTTP | confirmada | Confirmado pelo usuário (Raniery) em 2026-09-25: se uma rota precisar compor várias operações atomicamente, isso vira decisão da feature de rotas HTTP, não desta. |
| ASM-018 | Nesta feature, os repositórios cobrem apenas as operações que a próxima fatia (rotas HTTP) precisa de imediato: `leads` (criar, buscar por id, listar simples) e `oportunidades` (buscar por id, listar com filtro/paginação, atualizar campos simples) — sem `excluir` (delete), que não aparece em nenhum critério do PRD-001 para essas duas tabelas | confirmada | Confirmado pelo usuário (Raniery) em 2026-09-25: sem delete nesta feature. |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-008 | A listagem de oportunidades desta feature já precisa de filtros (por etapa, por responsável) e paginação, ou uma listagem simples (todas as oportunidades do tenant) é suficiente até a feature de rotas HTTP/Kanban definir os filtros reais? | respondida | Decidido pelo usuário (Raniery) em 2026-09-25: já com paginação completa e filtro por etapa/responsável (AC-072, AC-073). Listagem de `leads` continua simples (sem filtro/paginação) — não fazia parte da pergunta. |
