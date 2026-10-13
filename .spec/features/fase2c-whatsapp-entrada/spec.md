# Spec: Fase 2c — WhatsApp de entrada (webhook + conexão)

> feature: fase2c-whatsapp-entrada
> status: auditada

## Contexto

Hoje o webhook da Evolution API (`/api/whatsapp/webhook`) ainda é o legado em Supabase: aceita POST sem segredo quando a empresa não cadastrou nenhum, grava `lead_id = null` e nunca avisa o pipeline. O PRD-001 (§5.3, regra de ouro) e o TDD-001 (§4.4, §4.5 item 8) pedem que a mensagem recebida de um lead em cadência interrompa a cadência na hora e leve o card para **Qualificando**. Esta feature porta só a **entrada**: webhook autenticado por segredo da empresa, mensagem gravada no Postgres novo e vinculada ao lead pelo telefone, e conexão automática (`conexao_whatsapp`) com a transição do card feita pelo sistema. Envio, histórico, não lidas, QR code e configuração ficam para as próximas features.

## Histórias

### US-039 — Só a Evolution da minha empresa consegue entregar mensagem

Como responsável pela operação, quero que o webhook recuse qualquer chamada sem o segredo da empresa, para que ninguém de fora injete mensagens falsas nem dispare a transição de cards.

#### AC-119 — Sem segredo cadastrado ou segredo errado, o webhook recusa

- **Dado** uma empresa com segredo `evolution_webhook_secret` cadastrado, e outra empresa sem nenhum segredo cadastrado
- **Quando** chega um POST em `/api/whatsapp/webhook?empresa_id=…` sem `secret`, com `secret` errado, ou para a empresa sem segredo cadastrado
- **Então** a resposta é 401 e nada é gravado (nenhuma mensagem, nenhum evento, nenhuma transição)

#### AC-120 — Segredo correto é aceito

- **Dado** uma empresa com segredo cadastrado
- **Quando** chega um POST com o `secret` correto e um evento de mensagem válido
- **Então** a resposta é 200 e a mensagem é processada

#### AC-121 — Parâmetros e corpo inválidos são recusados com erro claro

- **Dado** o webhook ativo
- **Quando** o POST vem sem `empresa_id`, com `empresa_id` que não é UUID ou inexistente, ou com corpo que não é JSON
- **Então** a resposta é 400 (sem `empresa_id` válido, ou JSON inválido) ou 401 (empresa inexistente, sem revelar que ela não existe) e nada é gravado

### US-040 — Mensagem recebida fica registrada e ligada ao lead

Como operador comercial, quero que cada mensagem que o lead mandar fique guardada e ligada ao lead certo, para que o histórico da conversa exista dentro do CRM.

#### AC-122 — Mensagem recebida é gravada com número normalizado e texto extraído

- **Dado** uma empresa com segredo válido
- **Quando** chega um evento `messages.upsert` de um contato individual com texto (`conversation`, `extendedTextMessage.text` ou legenda de imagem/vídeo/documento)
- **Então** é gravada uma linha em `whatsapp_mensagens` com `empresa_id` da URL, `direcao = recebida`, `numero` só com dígitos (sem `@s.whatsapp.net` nem sufixo de device `:2`), o texto extraído e o `evolution_message_id`; áudio vira `[áudio]`, figurinha `[figurinha]` e qualquer outra mídia `[mídia]`

#### AC-123 — Mensagem enviada por nós, de grupo ou de outro tipo de evento é ignorada

- **Dado** uma empresa com segredo válido
- **Quando** chega mensagem com `fromMe = true`, de grupo (`@g.us`), sem número extraível, ou evento que não é de mensagem (ex.: `connection.update`)
- **Então** a resposta é 200 e nenhuma mensagem, evento ou transição é gerado

#### AC-124 — Mensagem repetida não duplica

- **Dado** uma mensagem já gravada com um `evolution_message_id`
- **Quando** a Evolution reenvia o mesmo evento (retentativa)
- **Então** a resposta é 200, continua existindo uma única linha para aquele `evolution_message_id` na empresa e nenhum evento de conexão é gerado de novo

#### AC-125 — O telefone do lead é reconhecido, inclusive com a variação do nono dígito

- **Dado** um lead da empresa com `telefone_e164` `+5585999985587`
- **Quando** chega mensagem do número `558599985587` (sem o nono dígito, como a Evolution costuma entregar) ou de `5585999985587`
- **Então** a mensagem é gravada com `lead_id` desse lead; número que não casa com nenhum lead da empresa é gravado com `lead_id` nulo

#### AC-126 — A mensagem só se liga a lead da mesma empresa

- **Dado** o mesmo telefone cadastrado como lead na empresa A e na empresa B
- **Quando** chega mensagem pelo webhook da empresa A
- **Então** a mensagem é gravada na empresa A, ligada ao lead da A, e nada é lido, gravado ou alterado na empresa B

### US-041 — Resposta do lead no WhatsApp interrompe a cadência

Como operador comercial, quero que o card vá para Qualificando assim que o lead responder no WhatsApp, para eu parar de ligar para quem já está conversando.

#### AC-127 — Mensagem de lead em cadência move o card para Qualificando

- **Dado** uma oportunidade do lead nas etapas 2, 3 ou 4 (1º, 2º ou 3º dia de contato), com cadência ativa
- **Quando** chega mensagem recebida desse lead
- **Então** o card vai para a etapa 5 (Qualificando) pela mesma função `mover_oportunidade`, com `ator_tipo = sistema`, a `version` incrementada, e o evento `oportunidade.movida` é emitido no SSE

#### AC-128 — A conexão é registrada no log e a cadência é encerrada

- **Dado** a transição do AC-127
- **Quando** ela é concluída
- **Então** existe um evento append-only `conexao_whatsapp` em `oportunidade_eventos` (com `ator_tipo = sistema` e o `evolution_message_id` no payload), `cadencia_encerrada_em` fica preenchida, as atividades pendentes viram `cancelada` e nenhuma atividade vira `conectou`

#### AC-129 — Fora da cadência, a mensagem não move card nenhum

- **Dado** um lead cuja oportunidade está na etapa 1 (Entrada de leads), ou da etapa 5 em diante, ou que não tem oportunidade
- **Quando** chega mensagem recebida dele
- **Então** a mensagem é gravada com o `lead_id`, mas nenhuma transição, evento `conexao_whatsapp` ou alteração de cadência acontece

#### AC-130 — Segunda mensagem não repete a conexão

- **Dado** um card que já foi levado para Qualificando pela primeira mensagem
- **Quando** chegam mais mensagens do mesmo lead
- **Então** todas são gravadas, mas existe um único evento `conexao_whatsapp` e a `version` do card não muda de novo

#### AC-131 — Mensagem e conexão são atômicas

- **Dado** uma mensagem de lead em cadência
- **Quando** a transição falha no meio (erro do banco simulado)
- **Então** nem a mensagem, nem o evento, nem o cancelamento das atividades ficam gravados e a resposta é 500, para a Evolution retentar sem deixar estado pela metade

#### AC-132 — Card com versão conflitante não derruba o webhook

- **Dado** um card em cadência que outro operador acabou de mover (a `version` mudou entre a leitura e a escrita)
- **Quando** chega mensagem do lead
- **Então** o sistema relê o card e decide de novo com o estado atual (se já saiu das etapas 2–4, só grava a mensagem), sem devolver 409 para a Evolution

### US-042 — O tempo real avisa que chegou mensagem

Como operador comercial, quero ser avisado em tempo real quando um lead da minha empresa responde, para eu abrir a conversa sem recarregar a tela.

#### AC-133 — Mensagem recebida emite `mensagem.recebida` só para o tenant

- **Dado** usuários da empresa A e da empresa B conectados em `/api/stream`
- **Quando** chega uma mensagem pelo webhook da empresa A
- **Então** o usuário da A recebe o evento `mensagem.recebida` com `empresaId`, `leadId` (ou nulo), `mensagemId` e `ocorridoEm`, sem o texto da mensagem e sem o número; o usuário da B não recebe nada

#### AC-134 — Mensagem ignorada ou duplicada não emite evento

- **Dado** um usuário conectado em `/api/stream`
- **Quando** o webhook ignora a mensagem (AC-123) ou a recebe repetida (AC-124)
- **Então** nenhum `mensagem.recebida` é enviado

## Fora de escopo

- Envio de mensagem (`/api/whatsapp/send`), histórico (`/messages`), contador de não lidas (`/unread`), `config`, `qrcode` e `status`: continuam legados em Supabase; entram em feature seguinte.
- Tela do WhatsApp e qualquer mudança de UI; o board só muda por causa do `oportunidade.movida` que já existe.
- Motor de cadência e geração dos 18 toques; esta feature só **encerra** uma cadência existente.
- Mídia: nada é baixado nem guardado, só o rótulo (`[áudio]`, `[figurinha]`, `[mídia]`).
- Cadastro/rotação do segredo pela interface: o segredo é inserido na configuração da empresa fora desta feature.
- Aplicar migration e configurar o webhook na Evolution da VPS: o deploy segue manual.
- Replay de mensagens perdidas se o app ficar fora do ar.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-033 | O segredo da empresa fica em `empresa_configuracoes` com `chave = 'evolution_webhook_secret'` e `valor` JSON string, mesma chave do legado. A comparação é em tempo constante. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-034 | O webhook não tem sessão: resolve a empresa pelo `empresa_id` da URL e roda dentro de `comTenant` (RLS ligada) usando a role `crm_app`, nunca uma role que ignora RLS. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-035 | A conexão só dispara nas etapas 2, 3 e 4, as únicas origens com transição permitida para Qualificando (5) no grafo semeado; a etapa 1 não tem cadência iniciada. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-036 | A conexão roda numa função SQL nova (`registrar_conexao_whatsapp`, migration `0008`) que trava o card, chama `mover_oportunidade`, grava `conexao_whatsapp`, cancela atividades pendentes e preenche `cadencia_encerrada_em` numa transação só; a decisão de etapa vem do banco, não de um SELECT prévio da rota. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-037 | Idempotência por índice único parcial em `(empresa_id, evolution_message_id)` onde o id não é nulo; mensagem sem `evolution_message_id` é gravada sempre. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-038 | O `mensagem.recebida` sai por `pg_notify` no mesmo canal `oportunidade`, com `tipo` distinguindo os eventos, e o barramento passa a repassar os dois tipos; só ids e o instante, nunca o texto nem o número. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-039 | Lead é casado pelos dígitos de `telefone_e164`; se houver mais de um lead com o mesmo telefone na empresa, vale o de oportunidade mais recente em cadência, senão o mais recente criado. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-011 | O número do lead pode ir em claro no evento SSE `mensagem.recebida`? | respondida | Não: o evento leva só `leadId` e `mensagemId` (decidido pelo usuário em 2026-10-05). |
| Q-012 | Se o lead tem várias oportunidades, qual é movida pela mensagem? | respondida | Só a que está em cadência (etapas 2–4); as demais não são tocadas (decidido pelo usuário em 2026-10-05). |
