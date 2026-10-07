# Spec: Fase 2c — WhatsApp conversa (envio, histórico, não lidas e telefones do lead)

> feature: fase2c-whatsapp-conversa
> status: rascunho

## Contexto

A entrada do WhatsApp já grava as mensagens recebidas no Postgres novo (fase2c-whatsapp-entrada). Falta o resto da conversa: `/api/whatsapp/send`, `/messages` e `/unread` ainda são o legado em Supabase (service role, sem tenant, sem RLS, "não lidas" = recebidas dos últimos 7 dias sem nunca zerar). Esta feature porta as três rotas para sessão Better Auth + `comTenant`, acrescenta estado de leitura real (`marcar como lida`) e permite que um lead tenha **vários telefones** (recepção, sócio, financeiro), todos ligados ao mesmo lead e à mesma cadência. O envio vale para lead da empresa e para número avulso. `config`, `qrcode` e `status` continuam legados.

## Histórias

### US-043 — Responder um lead pelo WhatsApp do CRM

Como operador comercial, quero enviar uma mensagem de texto a um lead pelo WhatsApp da minha empresa, para conversar sem sair do CRM e deixar o registro no histórico.

#### AC-135 — Sem login, o envio é recusado

- **Dado** uma chamada sem sessão válida
- **Quando** ela faz POST em `/api/whatsapp/send`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`), a Evolution não é chamada e nada é gravado

#### AC-136 — Mensagem ao lead é enviada e registrada

- **Dado** um lead da empresa com telefone principal e uma instância WhatsApp configurada
- **Quando** o operador envia `{ leadId, mensagem }`
- **Então** a Evolution recebe o texto para o telefone do lead (só dígitos, com DDI 55 quando o número brasileiro vem com 10 ou 11 dígitos), é gravada uma linha em `whatsapp_mensagens` com `direcao = enviada`, `lead_id` do lead, o `numero` enviado e o `evolution_message_id`, e a resposta é 200 com `success: true`, `messageId` e `mensagemId`

#### AC-137 — Lead de outra empresa ou inexistente não recebe mensagem

- **Dado** um `leadId` de outra empresa, inexistente ou que não é UUID
- **Quando** o operador tenta enviar
- **Então** a resposta é 404 (`LEAD_NAO_ENCONTRADO`, idêntica para os três casos), a Evolution não é chamada e nada é gravado

#### AC-138 — Lead sem telefone não recebe mensagem

- **Dado** um lead da empresa sem telefone principal nem telefone extra
- **Quando** o operador envia `{ leadId, mensagem }`
- **Então** a resposta é 422 (`LEAD_SEM_TELEFONE`), a Evolution não é chamada e nada é gravado

#### AC-139 — Dá para escolher qual telefone do lead recebe

- **Dado** um lead com telefone principal e um telefone extra cadastrado
- **Quando** o operador envia `{ leadId, telefoneId, mensagem }` com o id do telefone extra
- **Então** a Evolution recebe o número do telefone extra, a mensagem é gravada com esse `numero` e com o `lead_id`; um `telefoneId` que não pertence àquele lead (ou à empresa) devolve 404 (`TELEFONE_NAO_ENCONTRADO`) sem enviar nada

#### AC-140 — Envio sem escolher telefone usa o principal

- **Dado** um lead com telefone principal e telefones extras
- **Quando** o operador envia `{ leadId, mensagem }` sem `telefoneId`
- **Então** a Evolution recebe o telefone principal do lead

### US-044 — Mandar mensagem para um número que não é lead

Como operador comercial, quero enviar mensagem para um número avulso, para responder a quem chamou de um número que ainda não está cadastrado.

#### AC-141 — Número avulso é aceito e gravado sem lead

- **Dado** um número que não casa com nenhum lead nem telefone extra da empresa
- **Quando** o operador envia `{ numero, mensagem }`
- **Então** a mensagem é enviada, gravada com `lead_id` nulo e a resposta é 200

#### AC-142 — Número avulso que pertence a um lead da empresa é ligado a ele

- **Dado** um lead com telefone principal `+5585999985587` e outro lead com um telefone extra `5585988887777`
- **Quando** o operador envia `{ numero }` com `558599985587` (sem o nono dígito) ou com `5585988887777`
- **Então** cada mensagem é gravada com o `lead_id` do lead dono daquele telefone; o número de lead de outra empresa nunca liga (fica `lead_id` nulo)

#### AC-143 — Pedido de envio mal formado é recusado

- **Dado** um operador logado
- **Quando** o pedido vem sem `mensagem`, com mensagem só de espaços, com mais de 4096 caracteres, sem `leadId` nem `numero`, com `leadId` e `numero` juntos, ou com `numero` que não tem entre 10 e 15 dígitos
- **Então** a resposta é 400 (`REQUISICAO_INVALIDA`), a Evolution não é chamada e nada é gravado

#### AC-144 — Sem instância configurada, nada é enviado

- **Dado** uma empresa que não cadastrou `evolution_instance_name`
- **Quando** o operador tenta enviar
- **Então** a resposta é 409 (`WHATSAPP_NAO_CONFIGURADO`), a Evolution não é chamada e nada é gravado

#### AC-145 — Falha na Evolution não deixa mensagem fantasma

- **Dado** uma Evolution que responde erro, fica fora do ar, ou diz que o número não está no WhatsApp
- **Quando** o operador tenta enviar
- **Então** a resposta é 502 (`FALHA_ENVIO`) ou, para número sem WhatsApp, 422 (`NUMERO_SEM_WHATSAPP`), e nenhuma linha `enviada` é gravada

#### AC-146 — Enviar mensagem não mexe no card nem na cadência

- **Dado** um lead com oportunidade em cadência na etapa 3
- **Quando** o operador envia uma mensagem a ele
- **Então** a etapa, a `version` do card, `cadencia_encerrada_em` e as atividades pendentes continuam exatamente iguais e nenhum evento novo é gravado em `oportunidade_eventos`

### US-045 — Ver a conversa de um lead ou de um número

Como operador comercial, quero abrir o histórico de uma conversa, para saber o que já foi dito antes de responder.

#### AC-147 — Sem login, o histórico é recusado

- **Dado** uma chamada sem sessão válida
- **Quando** ela faz GET em `/api/whatsapp/messages`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`) e nenhuma mensagem é lida

#### AC-148 — Histórico por número traz enviadas e recebidas em ordem

- **Dado** mensagens enviadas e recebidas do mesmo número na empresa
- **Quando** o operador consulta `?numero=…`
- **Então** a resposta traz `mensagens` da mais antiga para a mais recente, cada uma com `id`, `mensagem`, `direcao`, `created_at`, `numero` e `status` (nomes do legado, para a tela atual continuar funcionando), limitadas às 200 mais recentes

#### AC-149 — O número é reconhecido com DDI e com a variação do nono dígito

- **Dado** mensagens gravadas para `5585999985587` e outras para `558599985587`
- **Quando** o operador consulta `?numero=85999985587`, `?numero=5585999985587` ou `?numero=558599985587`
- **Então** as três consultas devolvem o mesmo conjunto, com as mensagens das duas grafias

#### AC-150 — Histórico por lead reúne todos os telefones do lead

- **Dado** um lead com telefone principal e um telefone extra, e mensagens trocadas com cada um
- **Quando** o operador consulta `?leadId=…`
- **Então** a resposta traz as mensagens de todos os telefones do lead (e as ligadas por `lead_id`), em ordem cronológica, sem repetir nenhuma

#### AC-151 — Histórico nunca mostra mensagens de outra empresa

- **Dado** o mesmo número com conversa na empresa A e na empresa B
- **Quando** o operador da A consulta o histórico por número ou por `leadId` da B
- **Então** só vê as mensagens da A (e `leadId` da B devolve lista vazia, sem revelar que ele existe)

#### AC-152 — Consulta sem número nem lead é recusada

- **Dado** um operador logado
- **Quando** ele consulta o histórico sem `numero` e sem `leadId`, com `numero` sem dígitos, ou com `leadId` que não é UUID
- **Então** a resposta é 400 (`REQUISICAO_INVALIDA`)

### US-046 — Saber quem me respondeu e ainda não vi

Como operador comercial, quero ver o contador de conversas não lidas e zerá-lo ao abrir a conversa, para não perder resposta de lead.

#### AC-153 — Mensagens antigas não viram "não lidas" na virada

- **Dado** mensagens recebidas já existentes antes da migration de leitura
- **Quando** a migration é aplicada
- **Então** todas ficam marcadas como lidas e `/api/whatsapp/unread` não lista nenhuma conversa por causa delas

#### AC-154 — Não lidas lista só recebidas ainda não lidas, por conversa

- **Dado** mensagens recebidas não lidas de dois leads e de um número avulso, mais mensagens enviadas e mensagens recebidas já lidas
- **Quando** o operador abre `/api/whatsapp/unread`
- **Então** `conversas` traz uma linha por conversa com `numero`, `leadId` (ou nulo), `lastMessage`, `lastAt` e `count` só das não lidas, da mais recente para a mais antiga; mensagens enviadas e já lidas não entram na conta

#### AC-155 — Telefones diferentes do mesmo lead contam como uma conversa só

- **Dado** um lead que mandou mensagens não lidas do telefone principal e de um telefone extra, e duas grafias (com e sem nono dígito) do mesmo número
- **Quando** o operador abre `/api/whatsapp/unread`
- **Então** o lead aparece em uma única conversa com `count` somando todas, e cada número avulso aparece uma única vez mesmo com as duas grafias

#### AC-156 — Sem login, não lidas e marcar como lida são recusados

- **Dado** uma chamada sem sessão válida
- **Quando** ela faz GET em `/api/whatsapp/unread` ou POST em `/api/whatsapp/lidas`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`) e nada é lido nem alterado

#### AC-157 — Abrir a conversa marca as recebidas como lidas

- **Dado** uma conversa com mensagens recebidas não lidas
- **Quando** o operador faz POST em `/api/whatsapp/lidas` com `{ leadId }` ou `{ numero }`
- **Então** todas as recebidas daquela conversa (todos os telefones do lead, ou as duas grafias do número) ficam lidas, a resposta traz quantas foram marcadas e a conversa some de `/api/whatsapp/unread`

#### AC-158 — Marcar como lida é idempotente e nunca toca em outra conversa nem em outra empresa

- **Dado** mensagens não lidas de outro número da mesma empresa e do mesmo número em outra empresa
- **Quando** o operador marca uma conversa como lida duas vezes seguidas
- **Então** a primeira chamada devolve o total marcado e a segunda devolve 0; as outras conversas e a outra empresa continuam com suas não lidas

#### AC-159 — Mensagem nova depois de lida volta a contar

- **Dado** uma conversa já marcada como lida
- **Quando** chega uma nova mensagem recebida dela pelo webhook
- **Então** a conversa volta a `/api/whatsapp/unread` com `count` 1 (só a nova)

### US-047 — Vários telefones para o mesmo lead

Como operador comercial, quero cadastrar outros telefones do mesmo lead (recepção, sócio, financeiro), para falar com quem atende e ter tudo ligado a um único card.

#### AC-160 — Cadastrar um telefone extra no lead

- **Dado** um lead da empresa e um operador logado
- **Quando** ele faz POST em `/api/leads/{id}/telefones` com `{ numero, rotulo }`
- **Então** a resposta é 201 com o telefone guardado só com dígitos (DDI 55 quando vier com 10 ou 11 dígitos), o `rotulo` (opcional, até 60 caracteres) e o `id`

#### AC-161 — Telefone repetido é recusado, inclusive com a variação do nono dígito

- **Dado** um lead com principal `+5585999985587` e um extra `5585988887777`
- **Quando** o operador tenta cadastrar `558599985587`, `85999985587` ou `5585988887777`
- **Então** a resposta é 409 (`TELEFONE_DUPLICADO`) e nenhum telefone novo é gravado

#### AC-162 — Número inválido ou lead alheio é recusado

- **Dado** um operador logado
- **Quando** ele cadastra telefone com menos de 10 ou mais de 15 dígitos, com rótulo maior que 60 caracteres, ou em um lead de outra empresa, inexistente, ou sem sessão
- **Então** a resposta é 400 (`REQUISICAO_INVALIDA`), 404 (`LEAD_NAO_ENCONTRADO`, igual para alheio e inexistente) ou 401 (`NAO_AUTENTICADO`), e nada é gravado

#### AC-163 — Listar e remover telefones do lead

- **Dado** um lead com principal e dois extras
- **Quando** o operador faz GET em `/api/leads/{id}/telefones` e depois DELETE em `/api/leads/{id}/telefones/{telefoneId}` de um extra
- **Então** o GET traz o principal (marcado `principal: true`, não removível) e os extras com `id`, `numero` e `rotulo`; o DELETE remove só aquele extra (204) e um DELETE de telefone de outro lead ou de outra empresa devolve 404 sem apagar nada

#### AC-164 — Telefones de uma empresa não aparecem para outra

- **Dado** o mesmo número cadastrado como telefone extra de leads de duas empresas
- **Quando** cada operador lista, cadastra ou remove telefones, ou o banco é consultado pela role da aplicação com o tenant da outra
- **Então** cada empresa só enxerga e altera os seus (RLS), e cadastrar o número na empresa B nunca acusa duplicidade da A

#### AC-165 — Resposta no telefone extra liga ao lead e encerra a cadência

- **Dado** um lead em cadência (etapa 2, 3 ou 4) com um telefone extra cadastrado
- **Quando** chega pelo webhook uma mensagem recebida desse telefone extra
- **Então** a mensagem é gravada com o `lead_id` do lead e o card vai para Qualificando pelo mesmo caminho da mensagem do telefone principal (evento `conexao_whatsapp`, cadência encerrada)

#### AC-166 — Desempate quando o mesmo número aparece em mais de um lead

- **Dado** o mesmo número como telefone principal de um lead e como extra de outro da mesma empresa, ou extra de dois leads
- **Quando** chega uma mensagem desse número
- **Então** vale a regra já adotada (o lead com oportunidade em cadência mais recente, senão o lead criado mais recentemente) e a mensagem é gravada uma única vez

## Fora de escopo

- Qualquer mudança nas telas (`whatsapp-chat.tsx`, `whatsapp-inbox-chat.tsx`, contexto de não lidas): as respostas mantêm os nomes de campo do legado para elas continuarem funcionando; trocar a UI vem depois.
- Envio de mídia, áudio, figurinha ou documento; só texto.
- `config`, `qrcode` e `status`: continuam legados em Supabase.
- Envio em massa, agendamento de mensagem, respostas automáticas e templates.
- Status de entrega/leitura vindos da Evolution (`messages.update`): `status` continua o valor padrão.
- Tela para gerenciar os telefones extras: só as rotas.
- Unificar ou mesclar leads duplicados.
- Evento SSE para mensagem enviada ou marcação de leitura (várias abas/operadores só sincronizam ao recarregar).
- Aplicar migration 0009 e configurar variáveis na VPS: o deploy segue manual.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-040 | O nome da instância vem de `empresa_configuracoes` (`chave = 'evolution_instance_name'`, valor string, como no legado); URL e chave da Evolution vêm das variáveis `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`. Nos testes a Evolution é um servidor HTTP falso local. | aberta | — |
| ASM-041 | O envio chama a Evolution **fora** da transação do banco e só grava a linha `enviada` depois do aceite; se a Evolution aceitou e a gravação falha, a resposta é 500 (`ENVIADO_SEM_REGISTRO`) e a mensagem já foi entregue — risco aceito, sem desfazer. | aberta | — |
| ASM-042 | As respostas mantêm os nomes do legado (`mensagens[].mensagem/direcao/created_at/numero/status`, `conversas[].numero/lastMessage/lastAt/count`, `{ success, messageId }` no envio) com campos novos só acrescentados (`leadId`, `mensagemId`), para a UI atual não quebrar. | aberta | — |
| ASM-043 | O telefone principal continua em `leads.telefone_e164`; os extras ficam numa tabela nova `lead_telefones` (migration 0009, RLS por `empresa_id`, `numero` só dígitos, `rotulo` opcional, único por lead + número); nada é migrado do principal para a tabela nova. | aberta | — |
| ASM-044 | O estado de leitura é uma coluna `lida_em` (nula = não lida) em `whatsapp_mensagens`, relevante só para `direcao = recebida`; a migration marca todas as recebidas já existentes como lidas (`lida_em = criado_em`). | aberta | — |
| ASM-045 | "Conversa" é o lead quando a mensagem tem `lead_id`; sem lead, é o número normalizado com as duas grafias do nono dígito tratadas como o mesmo contato. | aberta | — |
| ASM-046 | Normalização de número: só dígitos; 10 ou 11 dígitos recebem DDI 55; 12 a 15 dígitos ficam como estão; fora de 10–15 é inválido. O limite de 4096 caracteres vem do limite do WhatsApp para texto. | aberta | — |
| ASM-047 | A busca de lead por telefone (webhook, envio por número avulso, histórico, não lidas) passa a considerar o principal **e** os extras, com a mesma tolerância ao nono dígito, num único ponto do repositório. | aberta | — |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-013 | O envio vale só para lead ou também para número avulso? | respondida | Para lead da empresa, para número avulso e, além disso, o lead pode ter vários telefones (decidido pelo usuário em 2026-10-06). |
| Q-014 | Como funciona "não lidas"? | respondida | Estado de leitura real com "marcar como lida" (decidido pelo usuário em 2026-10-06). |
| Q-015 | Quais papéis podem enviar e ler o histórico? | respondida | Qualquer papel logado do tenant (decidido pelo usuário em 2026-10-06). |
| Q-016 | O estado de leitura é da empresa (um operador abrir zera para todos) ou individual por usuário? | respondida | Da empresa toda: abrir a conversa zera o contador para todos (decidido pelo usuário em 2026-10-06). |
