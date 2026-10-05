# Spec: Fase 2c — Tempo real (SSE de card movido)

> feature: fase2c-sse
> status: rascunho

## Contexto

Hoje o board só reflete o que outro operador fez se a pessoa recarregar a página. O TDD-001 (§4.2, §4.6, D-S4) troca a releitura periódica por SSE alimentado por `LISTEN/NOTIFY` do Postgres. Esta feature entrega o canal `/api/stream` com o primeiro evento do contrato, `oportunidade.movida`, emitido pela própria função SQL `mover_oportunidade` (mesma transação do UPDATE e do evento de auditoria), e faz o board se atualizar sozinho quando outro operador da mesma empresa move um card. Quem recebe nunca vê evento de outra empresa.

## Histórias

### US-037 — Receber, em tempo real, o card que outro operador moveu

Como operador comercial, quero que o board se atualize quando um colega da minha empresa move um card, para que eu não trabalhe em cima de uma posição velha nem leve conflito de versão sem necessidade.

#### AC-108 — Mover um card emite `oportunidade.movida` com o contrato do TDD

- **Dado** um usuário conectado em `/api/stream` e um card do tenant dele
- **Quando** um card desse tenant é movido com sucesso (`POST /api/oportunidades/:id/transicao`)
- **Então** a conexão recebe um evento SSE `oportunidade.movida` cujo JSON traz `empresaId`, `oportunidadeId`, `etapaOrigemId`, `etapaDestinoId`, `atorId` e `ocorridoEm` (ISO 8601 UTC) com os valores reais da transição

#### AC-109 — Evento só chega a quem é do mesmo tenant

- **Dado** um usuário da empresa A e um da empresa B, ambos conectados em `/api/stream`
- **Quando** um card da empresa A é movido
- **Então** o usuário da A recebe o evento e o da B não recebe nada (nem o evento, nem o id do card)

#### AC-110 — Transição recusada não emite evento

- **Dado** um usuário conectado em `/api/stream`
- **Quando** uma transição falha (422 de regra de domínio, 409 de versão ou 404)
- **Então** nenhum evento `oportunidade.movida` é enviado

#### AC-111 — O evento nasce na mesma transação da escrita

- **Dado** a função SQL `mover_oportunidade` chamada dentro de uma transação
- **Quando** a transação é desfeita (rollback) depois da chamada
- **Então** nenhuma notificação é entregue a quem escuta; só após o commit a notificação existe

#### AC-112 — Board aberto aplica o evento sem recarregar

- **Dado** o board aberto com um card na etapa X
- **Quando** chega `oportunidade.movida` desse card para a etapa Y
- **Então** o card aparece na coluna Y sem recarga da página; um evento de card que o board não mostra (por filtro) é ignorado sem erro

### US-038 — Conexão de tempo real segura e resistente

Como responsável pela operação, quero que o canal exija login, sobreviva a quedas e não sobrecarregue o banco, para que o tempo real seja confiável em produção.

#### AC-113 — Sem login não há stream

- **Dado** uma requisição sem sessão válida
- **Quando** ela chama `GET /api/stream`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`) e nenhuma conexão com o banco é aberta para ela

#### AC-114 — Resposta é um `text/event-stream` sem cache e com batimento

- **Dado** um usuário autenticado
- **Quando** ele chama `GET /api/stream`
- **Então** a resposta é 200 com `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, e envia um comentário de batimento (`: ping`) a cada 25 s, para os proxies não derrubarem a conexão ociosa

#### AC-115 — Todas as conexões compartilham um único LISTEN

- **Dado** 50 usuários conectados em `/api/stream` na mesma instância da aplicação
- **Quando** se consulta o banco por conexões em `LISTEN`
- **Então** há exatamente 1 conexão de escuta dedicada da aplicação (não 50), e fechar uma conexão de usuário não derruba as outras

#### AC-116 — Cliente que fecha libera os recursos

- **Dado** um usuário conectado em `/api/stream`
- **Quando** ele fecha a conexão (aborta a requisição)
- **Então** o servidor remove o ouvinte dele e o timer de batimento; o número de conexões ativas cai em 1

#### AC-117 — Queda do LISTEN reconecta sozinha e avisa os clientes

- **Dado** a conexão de escuta do Postgres derrubada com usuários conectados
- **Quando** a aplicação reconecta
- **Então** ela volta a escutar e envia aos clientes um evento `stream.reconectado`, para o board recarregar a lista (eventos perdidos na queda não se recuperam)

#### AC-118 — Sem SSE o board continua se atualizando por polling

- **Dado** o board aberto e o `EventSource` falhando de forma repetida (3 erros seguidos)
- **Quando** isso acontece
- **Então** o board passa a reler a lista a cada 30 s (fallback D-S4) e volta ao SSE quando a conexão se restabelece

## Fora de escopo

- Eventos de atividade de cadência, mensagem de WhatsApp recebida e contador de não lidas (`atividade.concluida`, `mensagem.recebida`): entram com o motor de cadência e o WhatsApp (próximas features da f2c/f2b). O contrato de evento aqui é extensível, mas só `oportunidade.movida` é emitido.
- Mudança de campo sem mover etapa (editar valor, responsável) e criação de card.
- Replay de eventos perdidos (`Last-Event-ID`); a recuperação é recarregar a lista (AC-117).
- Métrica `sse.conexoes_ativas` exposta no `/api/health` e alertas.
- Aplicar a migration na VPS: o deploy segue manual.
- Escalar para mais de uma instância da aplicação com balanceamento sticky.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-028 | O NOTIFY sai de dentro de `mover_oportunidade` via `pg_notify('oportunidade', payload)` numa migration nova (`0007`), e não da rota HTTP, para valer também quando o worker mover cards no futuro e para só existir após o commit. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-029 | Um único canal Postgres `oportunidade` para todos os tenants; o isolamento é feito no servidor da aplicação, filtrando por `empresaId` do payload antes de escrever na conexão de cada usuário. O payload traz só ids, nunca nome do lead nem valor. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-030 | Uma conexão de escuta dedicada por instância da aplicação, usando a mesma `DATABASE_URL` do app (role `crm_app`, que pode `LISTEN`); o NOTIFY não passa por RLS. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-031 | Batimento de 25 s e fallback de polling de 30 s após 3 erros seguidos. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-032 | O board aplica o evento relendo o card (`GET /api/oportunidades/:id` ou a lista) em vez de confiar só no payload, para respeitar RLS e trazer os campos do card. | confirmada | Confirmada pelo usuário em 2026-10-05. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-010 | O operador que moveu o card também deve receber o próprio evento (e o board ignora por já estar atualizado) ou o servidor deve omitir o evento para o ator? | respondida | O ator recebe o próprio evento e o board ignora (decidido pelo usuário em 2026-10-05). |
