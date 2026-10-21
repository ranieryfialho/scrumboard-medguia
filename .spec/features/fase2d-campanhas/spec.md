# Spec: Fase 2d — Campanhas (Mala Direta) no modelo novo

> feature: fase2d-campanhas
> status: auditada

## Contexto

A "Mala Direta" (campanhas de e-mail em massa) é uma das áreas que o CRM antigo faz e que precisa sobreviver ao cutover (TDD-001 §4.3, RFC-001 D2). Hoje as telas gravam direto no Supabase pelo navegador, o webhook do Resend usa a chave de serviço do Supabase e a empresa vem de `user_metadata`. No modelo novo, as tabelas `campanhas` e `envios_campanha` já existem com `empresa_id` e RLS (schema legado reescrito); falta a camada que a operação usa: rotas do CRM com sessão, empresa e papel resolvidos no servidor, e as telas falando com essas rotas. O envio em si continua com o **motor em Python** externo (container `motor-medguia`), que consome os destinatários `PENDENTE` e grava o resultado — o CRM gerencia a fila e acompanha o andamento, mas não envia e-mail.

## Histórias

### US-064 — Criar e editar uma campanha em rascunho com seus destinatários

Como gerente comercial, quero criar uma campanha com assunto e corpo do e-mail e escolher os destinatários (planilha ou etapa do pipeline), para preparar o disparo sem enviar nada ainda.

#### AC-234 — Criar campanha em rascunho com destinatários de uma planilha

- **Dado** um usuário MASTER ou GERENTE autenticado e uma lista de contatos lida da planilha (nome e e-mail)
- **Quando** ele salva a campanha com nome, assunto e corpo (`POST /api/campanhas`)
- **Então** a campanha nasce com status RASCUNHO na empresa dele, com um destinatário RASCUNHO por contato, e a resposta traz o `id` e a quantidade de destinatários

#### AC-235 — Criar campanha com os cards de uma etapa do pipeline

- **Dado** cards da empresa na etapa "Qualificando", alguns com e-mail no lead e outros sem
- **Quando** o usuário cria a campanha escolhendo essa etapa como origem
- **Então** só os leads com e-mail viram destinatários (nome do lead e e-mail sem espaços nas pontas), e os cards de outra etapa ou de outra empresa não entram

#### AC-236 — E-mails inválidos e repetidos são descartados e contados

- **Dado** uma lista com e-mails mal formados e o mesmo e-mail repetido (sem diferenciar maiúsculas)
- **Quando** a campanha é criada
- **Então** cada e-mail válido vira um único destinatário, e a resposta informa quantos foram descartados por inválidos e por repetidos

#### AC-237 — Editar nome, assunto e corpo só enquanto é rascunho

- **Dado** uma campanha em RASCUNHO e outra já PROCESSANDO ou FINALIZADA
- **Quando** o usuário edita nome, assunto ou corpo (`PATCH /api/campanhas/:id`)
- **Então** a edição da campanha em rascunho é gravada; a das outras volta 409 `CAMPANHA_NAO_EDITAVEL` e nada muda

#### AC-238 — Campos obrigatórios e permissão

- **Dado** pedidos de criação sem nome, sem assunto ou sem corpo, e um usuário ATENDENTE
- **Quando** a rota é chamada
- **Então** faltando campo a resposta é 400 `PARAMETRO_INVALIDO` com mensagem em português; ATENDENTE recebe 403 `SEM_PERMISSAO`; sem sessão, 401 `NAO_AUTENTICADO`; em nenhum caso algo é gravado

### US-065 — Iniciar os envios, reenviar falhas e finalizar

Como gerente comercial, quero dar o "Play" na campanha e reenviar os que falharam, para que o motor de envio processe a fila.

#### AC-239 — Play libera a fila para o motor

- **Dado** uma campanha em RASCUNHO com destinatários RASCUNHO
- **Quando** o usuário inicia os envios (`POST /api/campanhas/:id/iniciar`)
- **Então** a campanha vira PROCESSANDO e todos os destinatários RASCUNHO viram PENDENTE, na mesma transação; os demais status não mudam

#### AC-240 — Play recusado quando não há o que enviar ou já foi iniciada

- **Dado** uma campanha sem nenhum destinatário, e outra que já está PROCESSANDO ou FINALIZADA
- **Quando** o usuário tenta iniciar cada uma
- **Então** a primeira volta 422 `SEM_DESTINATARIOS` e a segunda 409 `CAMPANHA_JA_INICIADA`, sem alterar nada (e dois cliques simultâneos iniciam uma única vez)

#### AC-241 — Reenviar falhas devolve os erros para a fila

- **Dado** uma campanha FINALIZADA com destinatários ENVIADO e ERRO
- **Quando** o usuário pede para reenviar as falhas (`POST /api/campanhas/:id/reenviar-falhas`)
- **Então** só os destinatários ERRO viram PENDENTE, a campanha volta a PROCESSANDO e a resposta traz quantos foram devolvidos; sem nenhum ERRO, volta 422 `SEM_FALHAS`

#### AC-242 — A campanha finaliza quando a fila acaba

- **Dado** uma campanha PROCESSANDO cujos destinatários não têm mais nenhum PENDENTE nem RASCUNHO
- **Quando** o detalhe da campanha é consultado (`GET /api/campanhas/:id`)
- **Então** a campanha passa a FINALIZADA no servidor e a resposta já mostra esse status; com ao menos um PENDENTE, continua PROCESSANDO

### US-066 — Acompanhar e excluir campanhas

Como gerente comercial, quero ver a lista de campanhas e o andamento de cada uma, para saber quantos e-mails saíram, abriram ou falharam.

#### AC-243 — Listar as campanhas da empresa

- **Dado** campanhas de duas empresas
- **Quando** um usuário MASTER ou GERENTE chama `GET /api/campanhas`
- **Então** recebe só as da própria empresa (a empresa vem da sessão, nunca da query), da mais nova para a mais antiga, cada uma com nome, assunto, status e total de destinatários

#### AC-244 — Detalhe com destinatários e contagem por status

- **Dado** uma campanha com destinatários em vários status (PENDENTE, ENVIADO, ABERTO, CLICADO, ERRO)
- **Quando** o usuário abre o detalhe (`GET /api/campanhas/:id`)
- **Então** a resposta traz a campanha, os destinatários ordenados por nome e a contagem por status; campanha de outra empresa ou inexistente volta 404 `CAMPANHA_NAO_ENCONTRADA`

#### AC-245 — Excluir a campanha apaga os envios

- **Dado** uma campanha com destinatários
- **Quando** o usuário a exclui (`DELETE /api/campanhas/:id`)
- **Então** a campanha e todos os seus destinatários deixam de existir; uma campanha PROCESSANDO não pode ser excluída (409 `CAMPANHA_EM_ENVIO`)

### US-067 — Registrar abertura e clique vindos do Resend

Como gerente comercial, quero que a abertura e o clique do e-mail apareçam no relatório da campanha, para medir o interesse dos destinatários.

#### AC-246 — Abertura e clique atualizam o destinatário

- **Dado** destinatários ENVIADO e um webhook do Resend com o `envio_id` nas tags
- **Quando** chega `email.opened` ou `email.clicked`
- **Então** abertura leva ENVIADO a ABERTO (e nunca rebaixa um CLICADO), clique leva ENVIADO ou ABERTO a CLICADO, e a resposta é 200

#### AC-247 — Webhook sem assinatura válida é recusado

- **Dado** uma chamada ao webhook sem a assinatura do Resend, ou com assinatura que não confere
- **Quando** o webhook recebe o pedido
- **Então** responde 401 `ASSINATURA_INVALIDA` e nenhum destinatário é alterado

#### AC-248 — Eventos desconhecidos ou sem envio são ignorados com 200

- **Dado** um evento de tipo não tratado, ou sem `envio_id`, ou com `envio_id` que não existe
- **Quando** o webhook o recebe (com assinatura válida)
- **Então** responde 200 sem alterar nada, para o Resend não reenviar o mesmo evento

### US-068 — Telas de Mala Direta sem acesso direto ao Supabase

Como operador, quero usar a Mala Direta com as mesmas telas de hoje, para não ter que reaprender nada depois do cutover.

#### AC-249 — A lista de campanhas usa a rota nova

- **Dado** a aba "Mala Direta" aberta por MASTER ou GERENTE
- **Quando** a lista carrega
- **Então** a tela busca `GET /api/campanhas` e mostra nome, status, destinatários e as ações (Ver e Iniciar / Ver Relatório / Excluir); falha da rota mostra mensagem com "Tentar de novo"; ATENDENTE não vê o item no menu

#### AC-250 — Nova campanha pela tela grava pela rota

- **Dado** o modal "Nova campanha" preenchido (planilha ou etapa do pipeline)
- **Quando** o usuário salva
- **Então** a tela chama `POST /api/campanhas` (ou `PATCH` na edição) e mostra o resultado em português, incluindo quantos e-mails foram descartados; erro da rota é explicado sem perder o que foi digitado

#### AC-251 — Play, reenviar e acompanhamento usam as rotas novas

- **Dado** o detalhe de uma campanha aberta
- **Quando** o usuário clica em Play ou em reenviar falhas, e enquanto a campanha está PROCESSANDO
- **Então** a tela chama as rotas de iniciar e de reenviar, e atualiza o detalhe a cada 5 segundos enquanto PROCESSANDO; nenhum arquivo de `src/components/campanhas` importa o cliente do Supabase

## Fora de escopo

- O motor de envio em Python: continua externo, com o contrato de status `PENDENTE` → `ENVIADO`/`ERRO`. Apontá-lo para o Postgres novo é tarefa do cutover (fase 3).
- Migração dos dados antigos de campanhas (ETL, fase 3).
- Envio de e-mail pelo próprio CRM, fila própria, agendamento de disparo, templates/editor visual, descadastro (unsubscribe) e segmentação avançada.
- Campanhas por WhatsApp (o PRD §7.2 veta o disparo em massa).
- Administração de usuários e convites (feature própria da fase 2d).
- Alterar `campanhas`/`envios_campanha` no schema, salvo um índice se a consulta pedir.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-075 | O contrato com o motor Python é só o status do destinatário: o CRM grava PENDENTE; o motor grava ENVIADO ou ERRO e incrementa `tentativas`. O CRM nunca grava ENVIADO/ERRO. | confirmada | Confirmada pelo dono do produto em 2026-10-19. |
| ASM-076 | Só MASTER, GERENTE e super admin acessam campanhas; ATENDENTE não (mesma regra dos indicadores, ASM-074). | confirmada | Confirmada pelo dono do produto em 2026-10-19. |
| ASM-077 | A planilha é lida no navegador (XLSX, como hoje) e a lista de contatos vai no corpo do `POST`; a rota não recebe o arquivo. | confirmada | Confirmada pelo dono do produto em 2026-10-19. |
| ASM-078 | A origem "etapa do pipeline" lê `leads.email` dos cards da etapa escolhida (substitui a coluna "situacao" do Kanban legado). | confirmada | Confirmada pelo dono do produto em 2026-10-19. |
| ASM-079 | A verificação de assinatura do webhook usa o padrão Svix do Resend com o segredo `RESEND_WEBHOOK_SECRET`; sem o segredo configurado, o webhook recusa tudo (falha fechada). | confirmada | Confirmada pelo dono do produto em 2026-10-19. |
| ASM-080 | A finalização automática (AC-242) acontece na consulta do detalhe, como o "auto-healing" atual do navegador, mas gravada no servidor; sem job agendado. | confirmada | Confirmada pelo dono do produto em 2026-10-19. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-025 | O webhook do Resend em produção já tem um segredo de assinatura (Svix) configurado? Hoje o endpoint aceita qualquer chamada. | respondida | Sim, já há segredo Svix em produção; ligar `RESEND_WEBHOOK_SECRET` no ambiente novo (falha fechada sem ele). |
| Q-026 | Existe limite de destinatários por campanha (por causa do plano do Resend)? Sem resposta, esta feature não impõe limite. | respondida | Sem limite nesta feature; limite fica para depois. |
