# Spec: Fase 2c — WhatsApp conexão (config, QR code e status)

> feature: fase2c-whatsapp-conexao
> status: auditada

## Contexto

Entrada e conversa do WhatsApp já rodam no Postgres novo. Faltam as três rotas que conectam a empresa à Evolution: `/api/whatsapp/config` (nome da instância e mensagens automáticas), `/api/whatsapp/qrcode` (criar instância, registrar webhook e mostrar o QR) e `/api/whatsapp/status` (conectado ou não). Hoje elas ainda usam Supabase com service role, sem tenant e sem papel: qualquer usuário logado troca a instância, e o webhook é registrado **sem o segredo** que o webhook novo exige, então reconectar pelo legado quebraria a entrada. Esta feature porta as três para sessão Better Auth + `comTenant`, restringe a mudança a MASTER e GERENTE e faz o servidor gerar e registrar o segredo do webhook.

## Histórias

### US-048 — Ver a configuração do WhatsApp da minha empresa

Como operador, quero abrir a configuração do WhatsApp e ver o nome da instância e as mensagens automáticas da minha empresa, para saber como está configurado sem pedir ajuda.

#### AC-167 — Sem login, as três rotas são recusadas

- **Dado** uma chamada sem sessão válida
- **Quando** ela faz GET em `/api/whatsapp/config`, `/api/whatsapp/status` ou `/api/whatsapp/qrcode`, ou POST em `/api/whatsapp/config`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`), a Evolution não é chamada e nada é gravado

#### AC-168 — A configuração devolvida traz só as chaves permitidas

- **Dado** uma empresa com `evolution_instance_name`, duas mensagens automáticas e o segredo do webhook cadastrados
- **Quando** qualquer usuário da empresa (inclusive atendente) faz GET em `/api/whatsapp/config`
- **Então** a resposta é 200 com `{ empresaId, config }`, onde `config` tem o nome da instância e as mensagens automáticas cadastradas, e **nunca** o segredo do webhook nem outra chave

#### AC-169 — A configuração de outra empresa não aparece

- **Dado** duas empresas, cada uma com seu nome de instância
- **Quando** um usuário da empresa A lê a configuração
- **Então** vê só o nome da empresa A; a empresa B não aparece em nenhum campo

### US-049 — Salvar a configuração do WhatsApp

Como gerente, quero definir o nome da instância e as mensagens automáticas, para que o CRM fale com o WhatsApp certo da minha empresa.

#### AC-170 — MASTER e GERENTE salvam a configuração

- **Dado** um usuário MASTER (e, em outro caso, um GERENTE) logado
- **Quando** ele faz POST em `/api/whatsapp/config` com `evolution_instance_name` e algumas mensagens automáticas
- **Então** a resposta é 200 `{ success: true }` e um GET seguinte devolve os valores salvos; salvar de novo a mesma chave atualiza em vez de duplicar

#### AC-171 — Atendente não altera a configuração

- **Dado** um usuário ATENDENTE logado
- **Quando** ele faz POST em `/api/whatsapp/config`
- **Então** a resposta é 403 (`SEM_PERMISSAO`) e nada é gravado

#### AC-172 — Só as chaves permitidas são gravadas

- **Dado** um corpo com uma chave permitida, `evolution_webhook_secret`, uma chave qualquer e um `empresa_id` de outra empresa
- **Quando** o GERENTE faz POST
- **Então** só a chave permitida é gravada, na empresa da sessão; o segredo do webhook existente não muda, a chave qualquer é ignorada e o `empresa_id` do corpo não é lido

#### AC-173 — Nome de instância já usado por outra empresa é recusado

- **Dado** que a empresa B já usa o nome `clinica-b`
- **Quando** o GERENTE da empresa A tenta salvar `evolution_instance_name = "clinica-b"`
- **Então** a resposta é 409 (`INSTANCIA_EM_USO`), nada muda na empresa A, e salvar o nome que a própria empresa A já usa continua funcionando

#### AC-174 — Corpo ou nome de instância inválido é recusado

- **Dado** um GERENTE logado
- **Quando** o corpo não é um objeto JSON, algum valor não é texto, ou `evolution_instance_name` está vazio, tem mais de 64 caracteres ou tem caracteres fora de letras, números, `-` e `_`
- **Então** a resposta é 400 (`REQUISICAO_INVALIDA`) e nada é gravado (inclusive as outras chaves do mesmo pedido)

### US-050 — Saber se o WhatsApp está conectado

Como operador, quero ver se o WhatsApp da empresa está conectado, para saber se posso responder leads por ele.

#### AC-175 — Sem instância cadastrada, o status avisa

- **Dado** uma empresa sem `evolution_instance_name`
- **Quando** o usuário faz GET em `/api/whatsapp/status` (ou `/api/whatsapp/qrcode?action=status`)
- **Então** a resposta é 200 `{ state: "not_configured", instance: null }` e a Evolution não é chamada

#### AC-176 — Com instância, o status vem da Evolution

- **Dado** uma empresa com instância cadastrada e a Evolution informando `open`
- **Quando** qualquer usuário (inclusive atendente) faz GET em `/api/whatsapp/status`
- **Então** a resposta é 200 `{ state: "open", instance: "<nome>" }`; a consulta usa o nome da instância da empresa da sessão

#### AC-177 — Evolution fora do ar aparece como desconectado

- **Dado** uma empresa com instância cadastrada e a Evolution respondendo erro ou fora do ar
- **Quando** o usuário consulta o status
- **Então** a resposta é 200 com `state: "close"` (como no legado) e nada quebra

### US-051 — Conectar o WhatsApp lendo o QR code

Como gerente, quero gerar o QR code da minha instância, para conectar o celular da empresa ao CRM.

#### AC-178 — Atendente não gera QR code

- **Dado** um usuário ATENDENTE logado
- **Quando** ele faz GET em `/api/whatsapp/qrcode` sem `action=status`
- **Então** a resposta é 403 (`SEM_PERMISSAO`) e a Evolution não é chamada (a consulta `?action=status` continua permitida, AC-175/AC-176)

#### AC-179 — Sem instância cadastrada, não há o que conectar

- **Dado** uma empresa sem `evolution_instance_name`
- **Quando** o GERENTE pede o QR code
- **Então** a resposta é 409 (`WHATSAPP_NAO_CONFIGURADO`) e a Evolution não é chamada

#### AC-180 — O QR code vem depois de criar a instância e registrar o webhook

- **Dado** uma empresa com instância cadastrada e a Evolution desconectada
- **Quando** o GERENTE pede o QR code
- **Então** a Evolution recebe, nesta ordem, a criação da instância, o registro do webhook e o pedido de conexão; a resposta é 200 com `base64` do QR code e `webhookRegistrado: true`

#### AC-181 — O webhook registrado leva a empresa e o segredo

- **Dado** uma empresa com segredo de webhook já cadastrado
- **Quando** o GERENTE pede o QR code
- **Então** a URL registrada na Evolution é `<URL pública do app>/api/whatsapp/webhook?empresa_id=<id da empresa>&secret=<segredo>`, e o mesmo segredo continua valendo para o webhook de entrada

#### AC-182 — Empresa sem segredo recebe um gerado pelo servidor

- **Dado** uma empresa sem `evolution_webhook_secret`
- **Quando** o GERENTE pede o QR code
- **Então** o servidor gera um segredo aleatório de pelo menos 32 bytes, grava na empresa (JSON string, mesma chave do legado), usa-o na URL do webhook, e um pedido seguinte reutiliza o mesmo segredo sem trocá-lo; o webhook de entrada aceita esse segredo e recusa qualquer outro

#### AC-183 — O segredo nunca sai nas respostas

- **Dado** qualquer chamada às três rotas (sucesso ou erro)
- **Quando** a resposta é devolvida
- **Então** o corpo não contém o segredo do webhook nem a chave da Evolution

#### AC-184 — Instância já conectada não pede QR code

- **Dado** uma instância que a Evolution já informa como `open`
- **Quando** o GERENTE pede o QR code
- **Então** a resposta é 200 `{ state: "open" }`, sem `base64`

#### AC-185 — Falha ao registrar o webhook não esconde o QR, mas avisa

- **Dado** uma Evolution que cria a instância mas recusa o registro do webhook
- **Quando** o GERENTE pede o QR code
- **Então** a resposta é 200 com o QR code e `webhookRegistrado: false`, para a tela poder avisar que a entrada de mensagens não está ativa

#### AC-186 — Falha ao criar a instância é devolvida como erro

- **Dado** uma Evolution que recusa a criação da instância (erro diferente de "já existe")
- **Quando** o GERENTE pede o QR code
- **Então** a resposta é 502 (`FALHA_EVOLUTION`), o webhook não é registrado e nenhum segredo novo fica gravado sem uso; uma instância que já existia (409 da Evolution) segue o fluxo normal

## Fora de escopo

- Mudar telas (`whatsapp-config-tab.tsx`, `whatsapp-chat.tsx`): as respostas mantêm os nomes de campo do legado (`config`, `state`, `instance`, `base64`) para elas continuarem funcionando; só acrescentamos `webhookRegistrado`.
- Enviar as mensagens automáticas (`evolution_auto_msg_*`): esta feature só guarda e devolve o texto.
- Apagar, desconectar ou renomear a instância antiga na Evolution ao trocar o nome.
- Rotas `/api/empresas/[id]/configuracoes` (super admin) e `/api/sheets`, que também leem `empresa_configuracoes` via Supabase.
- Webhook de status de entrega (`messages.update`) e eventos além de `MESSAGES_UPSERT`.
- Migrar os nomes de instância e segredos existentes do Supabase: é o ETL do cutover.
- Aplicar a migration nova e configurar variáveis na VPS: o deploy segue manual.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-048 | Permissão: MASTER, GERENTE e super admin alteram a configuração e geram o QR code; ATENDENTE só consulta configuração e status. | confirmada | Decidido pelo usuário em 2026-10-07. |
| ASM-049 | O segredo do webhook é gerado pelo servidor na primeira conexão (≥32 bytes aleatórios, hex) e gravado em `empresa_configuracoes` com `chave = 'evolution_webhook_secret'`; depois é reaproveitado, nunca rotacionado por esta feature. | confirmada | Decidido pelo usuário em 2026-10-07. |
| ASM-050 | As seis chaves `evolution_instance_name` e `evolution_auto_msg_*` do legado são as únicas gravadas por `config`; as mensagens automáticas só são guardadas e devolvidas. | confirmada | Decidido pelo usuário em 2026-10-07. |
| ASM-051 | A unicidade do nome da instância entre empresas vem de um índice único parcial no banco (migration `0010`, sobre `valor` onde `chave = 'evolution_instance_name'`); como a RLS esconde as outras empresas, a rota não consegue checar por SELECT, e traduz a violação 23505 em 409. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-052 | Nome de instância válido: 1 a 64 caracteres entre letras, números, `-` e `_` (vira parte da URL da Evolution, então espaço, `/` e `?` são recusados). | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-053 | A URL pública do webhook vem de `NEXT_PUBLIC_APP_URL`; sem ela, usa o host da requisição, como no legado. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-054 | Nos testes a Evolution é o servidor HTTP falso local já usado em `fase2c-whatsapp-conversa`, estendido com criar instância, registrar webhook, conectar e estado da conexão. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-055 | Erro ou indisponibilidade da Evolution na consulta de status vira `state: "close"`, como no legado, em vez de um erro HTTP. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |
| ASM-056 | Salvar a configuração roda tudo numa transação: se uma chave falha (por exemplo nome em uso), nenhuma é gravada. | confirmada | Confirmada pelo usuário em 2026-10-13, conforme implementado. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-017 | A mensagem 409 de nome em uso pode revelar que o nome existe em outra empresa (como no legado), ou deve ser genérica? | respondida | Pode ser claro: `INSTANCIA_EM_USO` com mensagem "nome já em uso", sem dizer de qual empresa (decidido pelo usuário em 2026-10-07). |
