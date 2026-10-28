# Spec: Fase 4 — WhatsApp: caixa de entrada, nova mensagem, conexão e configuração (telas 16 a 19)

> feature: fase4-whatsapp
> status: rascunho

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

Continuação do roteiro que coloca o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. Esta feature entrega as
**telas 16 a 19 do inventário** (`docs/ui/inventario-telas.md`): a **caixa de
entrada** (`/whatsapp`), a **nova mensagem para número avulso** (`/whatsapp/nova`),
a **conexão e QR code** (`/whatsapp/conexao`) e a **configuração da instância**
(`/whatsapp/configuracao`).

Situação hoje (conferida no código em 28/10):

- O item "WhatsApp Inbox" do menu leva a `/whatsapp`, que **não existe** (404). As
  outras três rotas também não existem.
- O backend de WhatsApp já está no sistema novo e isolado por empresa: histórico de
  uma conversa (`GET /api/whatsapp/messages`), envio (`POST /api/whatsapp/send`, que
  já aceita número avulso), mensagens não lidas (`GET /api/whatsapp/unread`), marcar
  como lida (`POST /api/whatsapp/lidas`), estado da conexão (`GET /api/whatsapp/status`),
  QR code (`GET /api/whatsapp/qrcode`) e configuração (`GET/POST /api/whatsapp/config`,
  que guarda o nome da instância e as cinco mensagens automáticas).
- **Não existe** uma lista de conversas (só a de não lidas), nem marcar todas como
  lidas, nem a URL do webhook exposta à tela. Os componentes `whatsapp-inbox-chat.tsx`
  e `whatsapp-config-tab.tsx` são do sistema legado, não estão ligados a nenhuma página
  e não seguem o novo visual.
- A URL e a chave da Evolution são do **servidor** (variáveis de ambiente), não de cada
  empresa; só o nome da instância é da empresa.

Decisão do usuário (28/10): **uma feature só com as quatro telas**.

Regras herdadas: a marcação e as classes do `code.html` de cada tela são a
referência; **blocos que mostram dado inexistente no sistema são removidos** e
**ações sem backend aparecem visíveis e marcadas "em breve"**. Lições das features
anteriores: critérios de tela dizem o que a tela mostra; **todo item do menu aponta
para uma página que existe** (e um teste confere); a prova (`verify`) é gerada no código
final e commitada antes do merge.

## Histórias

### US-124 — Atender as conversas na caixa de entrada (tela 16)

Como atendente, gerente ou master, quero ver as conversas de WhatsApp, abrir uma,
responder e marcar como lida, para atender os leads sem sair do CRM.

#### AC-499 — A caixa de entrada abre dentro da casca, com o estado da conexão

- **Dado** um usuário com sessão
- **Quando** ele abre `/whatsapp` (ou clica em "WhatsApp Inbox" no menu)
- **Então** vê o menu e o topo da casca com "WhatsApp Inbox" marcado, o título "Central de Atendimento WhatsApp" e o selo da conexão ("Evolution API conectada" com o nome da instância, "Evolution API desconectada" ou "WhatsApp não configurado", lidos de `GET /api/whatsapp/status`); sem sessão vai ao login

#### AC-500 — O servidor lista as conversas com filtro, busca e contagens, só da empresa da sessão

- **Dado** mensagens de duas empresas, de leads com e sem card, lidas e não lidas
- **Quando** a tela pede `GET /api/whatsapp/conversas?filtro=nao_lidas|minhas|todas&busca=&responsavelId=`
- **Então** voltam só conversas da empresa da sessão, uma por lead (todos os telefones dele reunidos) ou por número avulso (as duas grafias do nono dígito contam como uma), da mais recente para a mais antiga, cada uma com nome do lead (ou o número), telefone, última mensagem, horário, quantidade de não lidas, etapa e responsável do card; a resposta traz também as contagens das três abas; sem sessão é 401

#### AC-501 — Quem vê o quê: atendente só as dos próprios cards e as avulsas

- **Dado** conversas de cards de responsáveis diferentes e conversas de número avulso
- **Quando** um ATENDENTE, e depois um GERENTE, pedem a lista
- **Então** o atendente recebe só as conversas dos leads cujo card é dele e as avulsas, mesmo que passe o `responsavelId` de outra pessoa; o gerente (ou master) recebe todas e pode filtrar por `responsavelId`; "Minhas" é sempre as dos cards do próprio usuário

#### AC-502 — A tela mostra as abas, a busca e a lista

- **Dado** a lista de conversas carregada
- **Quando** o usuário olha a coluna da esquerda e usa as abas "Não Lidas (N)", "Minhas (N)" e "Todas (N)" e o campo "Buscar conversas..."
- **Então** cada aba mostra só as conversas do seu filtro, a busca restringe por nome do lead ou número, e cada linha mostra avatar com iniciais, nome, horário, última mensagem cortada, a bolinha com as não lidas e o selo da etapa; sem resultado diz "Nenhuma conversa encontrada"; o filtro "Atendente" só aparece para gerente e master

#### AC-503 — Abrir uma conversa mostra o histórico e a marca como lida

- **Dado** uma conversa com mensagens não lidas
- **Quando** o usuário clica nela
- **Então** o painel da direita mostra o nome, o telefone, o histórico (enviadas à direita, recebidas à esquerda, com horário) lido de `GET /api/whatsapp/messages`, a conversa é marcada como lida (`POST /api/whatsapp/lidas`), a bolinha some, o contador do menu atualiza e nenhuma outra conversa é alterada

#### AC-504 — Responder pela caixa de entrada

- **Dado** uma conversa aberta
- **Quando** o usuário digita e usa "Enviar" (ou Enter; Shift+Enter quebra a linha)
- **Então** a mensagem vai por `POST /api/whatsapp/send` (com o `leadId`, ou o `numero` se for avulsa), aparece no histórico e a lista sobe a conversa; mensagem vazia não envia; se a API recusar (WhatsApp não configurado, falha de envio, lead sem telefone), a tela mostra o motivo em português e o texto digitado continua lá

#### AC-505 — Marcar todas como lidas

- **Dado** várias conversas com mensagens não lidas
- **Quando** o usuário usa "Marcar todas como lidas" (`POST /api/whatsapp/lidas` com `{ "todas": true }`)
- **Então** todas as mensagens recebidas não lidas da empresa da sessão passam a lidas, o servidor responde quantas foram marcadas, nada de outra empresa muda, a lista e o contador do menu zeram, e o corpo sem `todas`, `leadId` ou `numero` continua sendo recusado como hoje

#### AC-506 — Os indicadores do topo vêm dos dados

- **Dado** mensagens de hoje e não lidas
- **Quando** a caixa de entrada é aberta
- **Então** o cartão "Conversas ativas hoje" mostra quantas conversas tiveram mensagem hoje (dia em São Paulo) e "Mensagens não lidas" mostra o total com o texto "Aguardando resposta"; "Tempo da 1ª resposta" e "Taxa de resposta" do protótipo **não aparecem** (sem meta nem fonte oficial, Q-053)

#### AC-507 — O contexto do pipeline mostra só o que existe do card

- **Dado** uma conversa aberta de um lead com card, e outra de número avulso
- **Quando** o painel de contexto é renderizado
- **Então** a conversa do lead mostra nome, valor do card ("/mês"), responsável, etapa atual e o botão "Abrir card" (`/pipeline/[id]`); a de número avulso mostra "Sem card no pipeline"; CNPJ, cidade, régua de cadência e "Card #MED" do protótipo **não aparecem**

#### AC-508 — A lista se atualiza sozinha

- **Dado** a caixa de entrada aberta
- **Quando** passam 15 segundos, ou chega uma mensagem nova de um lead
- **Então** a lista, as contagens e o histórico da conversa aberta são relidos sem recarregar a página, sem apagar o que o usuário está digitando

#### AC-509 — Itens do protótipo sem backend aparecem "em breve"

- **Dado** a caixa de entrada
- **Quando** o usuário olha "Respostas rápidas", o anexo, o emoji, o microfone e o filtro de status (Pipeline / Pré-venda / Suporte)
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação

### US-125 — Enviar mensagem para um número que não é lead (tela 17)

Como atendente, quero mandar uma mensagem para um número avulso, para contatos de
fora do funil, sabendo que isso não cria card.

#### AC-510 — A tela abre dentro da casca com o aviso de governança

- **Dado** um usuário com sessão
- **Quando** ele abre `/whatsapp/nova`
- **Então** vê o título "Nova Mensagem Avulsa (Número Externo)", o aviso de que a conversa vai para um número não vinculado a lead, que não gera card nem régua de 18 toques e não conta nos indicadores, e o botão "Voltar para Caixa de Entrada" (`/whatsapp`); sem sessão vai ao login

#### AC-511 — O número e a mensagem são validados antes de enviar

- **Dado** o formulário "Parâmetros do Envio"
- **Quando** o usuário digita o número e a mensagem
- **Então** o número é conferido pela mesma regra do servidor (só dígitos, com ou sem DDI, normalizado para 55...) e mostra "Formato WhatsApp válido" ou "Número inválido"; a mensagem mostra o contador de caracteres (máximo 4096); o botão "Enviar Mensagem pelo WhatsApp" fica desabilitado sem número válido e sem mensagem

#### AC-512 — Os modelos vêm das mensagens configuradas da empresa

- **Dado** uma empresa com mensagens automáticas configuradas e outra sem nenhuma
- **Quando** o usuário olha "Modelos de Mensagem"
- **Então** cada mensagem configurada (`GET /api/whatsapp/config`) aparece como um modelo com o nome do tipo (em contato, recontato, reunião agendada, aguardando ativação, logins ativados), e clicar nele preenche a mensagem sem apagar o número; sem nenhuma configurada, mostra "Nenhum modelo configurado" com o atalho para `/whatsapp/configuracao`

#### AC-513 — Enviar manda para o número e leva à conversa

- **Dado** número válido e mensagem preenchida
- **Quando** o usuário usa "Enviar Mensagem pelo WhatsApp"
- **Então** a tela chama `POST /api/whatsapp/send` com o `numero` normalizado e a `mensagem`, mostra "Mensagem enviada" com o atalho "Abrir conversa" (`/whatsapp?numero=...`) e limpa o formulário; durante o envio o botão fica desabilitado

#### AC-514 — O envio recusado explica o motivo e não perde o que foi digitado

- **Dado** um envio que a API recusa
- **Quando** a resposta é 409 `WHATSAPP_NAO_CONFIGURADO`, 502 `FALHA_ENVIO`, 400 ou falha de rede
- **Então** a tela mostra o motivo em português (no caso de não configurado, com o atalho para `/whatsapp/configuracao`), nenhuma mensagem aparece como enviada e o número e a mensagem continuam preenchidos

#### AC-515 — A pré-visualização e os últimos disparos usam dados reais

- **Dado** o formulário e as conversas avulsas já existentes
- **Quando** o usuário digita e olha as colunas da direita
- **Então** "Pré-visualização no Destinatário" mostra o texto digitado como balão do WhatsApp; "Últimos Disparos Avulsos" lista as últimas 4 conversas de número avulso (`GET /api/whatsapp/conversas?filtro=avulsas&limite=4`) com o número, a última mensagem, quando foi, o selo "Respondido" (há mensagem recebida) ou "Aguardando" e o atalho "Abrir Chat"; sem nenhuma, mostra "Nenhum disparo avulso ainda"

#### AC-516 — Itens do protótipo sem backend aparecem "em breve"

- **Dado** a nova mensagem avulsa
- **Quando** o usuário olha "Nome do destinatário", "Motivo / Categoria", "Anexo complementar", "Criar lead se houver resposta", "Salvar como Rascunho", "Promover a Lead" e "Reenviar"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; a "Instância de envio" aparece só como a instância da empresa (somente leitura), sem seletor

### US-126 — Conectar o WhatsApp da empresa (tela 18)

Como gerente ou master, quero ver se o WhatsApp está conectado e ler o QR code, para
reconectar sem chamar o suporte.

#### AC-517 — A conexão abre dentro da casca e mostra o estado real

- **Dado** um usuário com sessão
- **Quando** ele abre `/whatsapp/conexao`
- **Então** vê o título "Conexão de Instância WhatsApp & QR Code", o selo "Sessão ativa: Instância <nome>" (conectado), "Sessão desconectada" ou "WhatsApp não configurado", lidos de `GET /api/whatsapp/status`, e o botão "Atualizar Status" que relê o estado; sem sessão vai ao login

#### AC-518 — Os cartões mostram só dados que o sistema tem

- **Dado** a tela de conexão
- **Quando** os cartões do topo são renderizados
- **Então** "Status da conexão" mostra Conectado, Desconectado ou Não configurado, e "Mensagens de hoje" mostra as quantidades de recebidas e enviadas hoje (de `GET /api/whatsapp/conversas`, campo `resumo`); latência, aparelho pareado, tempo sem interrupções, taxa de entrega, auditoria, diagnóstico e IP **não aparecem** (a Evolution não os entrega ao CRM)

#### AC-519 — Gerar o QR code e acompanhar a conexão

- **Dado** um MASTER ou GERENTE com a instância configurada e desconectada
- **Quando** ele usa "Gerar Novo QR Code" (`GET /api/whatsapp/qrcode`)
- **Então** o QR code aparece com os três passos de leitura, a tela passa a consultar o estado a cada 3 segundos e, quando a conexão abrir, troca o QR por "Conectado" e para de consultar; se já estava conectada, diz que a sessão já está ativa sem mostrar QR

#### AC-520 — Os erros do QR explicam o que fazer

- **Dado** um pedido de QR que falha
- **Quando** a resposta é 409 `WHATSAPP_NAO_CONFIGURADO`, 502 `FALHA_EVOLUTION`, 403 (ATENDENTE) ou falha de rede
- **Então** a tela mostra o motivo em português (não configurado, com o atalho para `/whatsapp/configuracao`; Evolution indisponível; sem permissão), sem QR antigo na tela; se o webhook não foi registrado (`webhookRegistrado: false`), mostra o aviso de que a entrada de mensagens não está ativa

#### AC-521 — A tela de conexão se atualiza sozinha

- **Dado** a tela aberta
- **Quando** passam 15 segundos
- **Então** o estado é relido sem recarregar e o selo e o cartão refletem a mudança (conectou ou caiu)

#### AC-522 — Itens do protótipo sem backend aparecem "em breve"; a instância é uma só

- **Dado** a tela de conexão
- **Quando** o usuário olha "Desconectar Sessão", "Código Numérico (Pairing)", "Nova Instância" e as ações de várias instâncias
- **Então** os três primeiros aparecem visíveis, marcados "em breve", sem disparar ação; a lista "Instâncias da Clínica" mostra só a instância da empresa (nome, estado, e "Gerar QR"/"Reconectar" que usam o mesmo fluxo do AC-519), com o atalho "Configurações Evolution" para `/whatsapp/configuracao`

### US-127 — Configurar a instância (tela 19)

Como gerente ou master, quero ver e ajustar a configuração da Evolution da empresa,
para manter o WhatsApp funcionando.

#### AC-523 — A configuração abre dentro da casca

- **Dado** um usuário com sessão
- **Quando** ele abre `/whatsapp/configuracao`
- **Então** vê o título "Configurações Técnicas da Evolution API" e as seções de conexão com o servidor, webhook e diretrizes; sem sessão vai ao login

#### AC-524 — O servidor devolve a configuração sem expor segredo

- **Dado** uma empresa com instância e segredo de webhook gravados
- **Quando** a tela pede `GET /api/whatsapp/config`
- **Então** a resposta continua trazendo `empresaId` e `config` como hoje e passa a trazer `servidor` (URL base da Evolution e se a chave está configurada, nunca a chave), `webhookUrl` (`<app>/api/whatsapp/webhook?empresa_id=...&secret=` com o segredo **mascarado**, nunca o valor real) e `eventos` (a lista dos eventos que o CRM registra, hoje só `MESSAGES_UPSERT`); só da empresa da sessão; sem sessão é 401

#### AC-525 — Salvar o nome da instância

- **Dado** um MASTER ou GERENTE na seção "Conexão com o Servidor Evolution API"
- **Quando** ele altera "Nome da Instância Ativa (Slug)" e usa "Salvar Alterações" (`POST /api/whatsapp/config`)
- **Então** o nome é gravado e a tela confirma; nome fora do formato (1 a 64 letras, números, `-` e `_`) mostra o erro de formato e não envia; nome já usado por outra empresa mostra "Esse nome de instância já está em uso" (409); o ATENDENTE vê os campos desabilitados e sem o botão ativo, e a API recusa com 403

#### AC-526 — A URL base e a chave aparecem só como informação

- **Dado** a seção de conexão com o servidor
- **Quando** o usuário olha "URL Base do Servidor" e "Global API Token"
- **Então** a URL base aparece somente leitura e a chave aparece mascarada com o texto "Configurada no servidor" (ou "Não configurada"), sem botão de revelar; "Regenerar Chave" aparece "em breve"

#### AC-527 — Verificar a conexão com o servidor

- **Dado** a seção de conexão com o servidor
- **Quando** o usuário usa "Verificar Conexão com o Servidor"
- **Então** a tela chama `GET /api/whatsapp/status`, mede o tempo da resposta e mostra "Servidor respondeu em N ms" com o estado da instância, ou "Não foi possível verificar" em caso de falha

#### AC-528 — O webhook aparece somente leitura, com os eventos que existem

- **Dado** a seção "Configuração de Webhooks & Eventos"
- **Quando** ela é renderizada
- **Então** mostra a URL do webhook com o segredo mascarado e o botão "Copiar" (copia a URL mascarada), e a lista dos eventos registrados vinda da API (hoje só `MESSAGES_UPSERT`, "Essencial"), sem caixas editáveis; `MESSAGES_UPDATE`, `CONNECTION_UPDATE` e `SEND_MESSAGE` do protótipo **não aparecem** (o CRM não os registra); "Testar Disparo de Webhook" e "Simular Evento de Teste (Ping)" aparecem "em breve"

#### AC-529 — As diretrizes anti-ban aparecem "em breve"

- **Dado** a seção "Diretrizes de Segurança Anti-Ban & Cadência"
- **Quando** ela é renderizada
- **Então** os quatro controles (intervalo mínimo, limite por hora, digitação simulada, auto-reconexão) e "Restaurar Padrões de Fábrica" aparecem visíveis, marcados "em breve", sem alterar nada; "Versão do adaptador" e "janela de manutenção" do protótipo **não aparecem**

### US-128 — Navegar pelo WhatsApp sem 404 e com estados de verdade

Como usuário, quero que todo item do menu de WhatsApp abra uma tela de verdade, com
carregando, vazio e erro, para nunca cair numa página quebrada.

#### AC-530 — O menu tem os três itens de WhatsApp e todos apontam para páginas que existem

- **Dado** o grupo "Comunicação" do menu lateral
- **Quando** o teste lê os itens
- **Então** existem "WhatsApp Inbox" (`/whatsapp`, com o contador de não lidas), "Conexão & QR Code" (`/whatsapp/conexao`) e "Configuração Evolution" (`/whatsapp/configuracao`), visíveis aos três papéis, cada um com a página do Next correspondente dentro de `src/app/(app)`, e a casca marca o item certo em cada rota (inclusive `/whatsapp/nova`, que marca "WhatsApp Inbox")

#### AC-531 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das quatro telas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo ("Nenhuma conversa ainda", "Nenhum disparo avulso ainda", "WhatsApp não configurado") e uma mensagem de erro com "Tentar de novo"

## Fora de escopo

- **Receber mensagens em tempo real por SSE:** a entrada continua pelo webhook; a tela relê a lista a cada 15 s (AC-508). Evento próprio de mensagem fica para depois.
- **Respostas rápidas, anexos, áudio, emoji e filtro por status de pipeline** na caixa de entrada: sem backend; "em breve".
- **Desconectar sessão, código de pareamento, várias instâncias e "Nova Instância":** o sistema tem uma instância por empresa; "em breve".
- **Eventos de webhook além de `MESSAGES_UPSERT`, teste/ping de webhook, regenerar chave, anti-ban e restaurar padrões:** o CRM não os implementa; "em breve" ou removidos.
- **Categoria da abordagem, nome do destinatário, anexo, rascunho e "criar lead se houver resposta"** na mensagem avulsa; **promover conversa avulsa a lead:** "em breve".
- **Tempo da 1ª resposta e taxa de resposta, latência, aparelho pareado, IP, certificado, diagnóstico:** sem fonte de dados; não aparecem (Q-053).
- **Edição das cinco mensagens automáticas:** continua pela rota `POST /api/whatsapp/config`; a tela nova só as usa como modelos (AC-512).
- Os componentes legados `whatsapp-inbox-chat.tsx` e `whatsapp-config-tab.tsx` e os testes deles **ficam como estão** (sem apagar prova de outras features).

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-171 | A "conversa" é a mesma unidade já usada pelas não lidas: uma por lead (todos os telefones) ou por número avulso canônico (as duas grafias do nono dígito) | aberta | Reaproveita `chaveCanonicaNumero` de `src/repositories/whatsapp.ts` |
| ASM-172 | "Minhas" = conversas dos leads cujo card tem o usuário como responsável; conversa avulsa não tem responsável e aparece em "Todas" (e "Não lidas") para todos os papéis | aberta | O protótipo mostra "Minhas (12)" sem dizer o critério |
| ASM-173 | ATENDENTE vê as conversas dos próprios cards e as avulsas; MASTER, GERENTE e super admin veem todas | aberta | Mesma regra de visibilidade das telas anteriores (ASM-163), estendida às avulsas |
| ASM-174 | "Conversas ativas hoje" = conversas com pelo menos uma mensagem (enviada ou recebida) no dia de hoje em São Paulo | aberta | O protótipo não define "ativa" |
| ASM-175 | A tela relê tudo a cada 15 segundos (polling); não há evento SSE de mensagem | aberta | O webhook grava a mensagem mas não emite evento; criar o evento seria outra feature |
| ASM-176 | A URL e a chave da Evolution são do servidor (ambiente), não da empresa; a tela só mostra a URL e se a chave existe, nunca a chave; o segredo do webhook aparece sempre mascarado | aberta | `buildConfig` lê `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` do ambiente |
| ASM-177 | O "tempo da resposta" do servidor na verificação é medido no navegador (duração da chamada a `/api/whatsapp/status`), não um ping à Evolution | aberta | A Evolution não devolve latência ao CRM |
| ASM-178 | Os modelos da tela de mensagem avulsa são as cinco mensagens automáticas já gravadas em `/api/whatsapp/config` | aberta | É o único texto pré-pronto que existe por empresa |
| ASM-179 | Reconectar uma instância desconectada é o mesmo fluxo de "Gerar Novo QR Code" (`GET /api/whatsapp/qrcode`) | aberta | Não há rota de reconexão separada |
| ASM-180 | O item "WhatsApp Inbox" continua marcado em `/whatsapp/nova` (a tela é filha da caixa de entrada) | aberta | O protótipo tem "Nova Conversa Externa" como botão da caixa de entrada |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-053 | Existem metas oficiais para "Tempo da 1ª resposta" (o protótipo diz "meta < 5 min") e "Taxa de resposta" (meta 90%)? E como medir a 1ª resposta de uma conversa que o lead puxa fora do horário? Enquanto isso, os dois cartões não aparecem | aberta | — |
| Q-054 | A conversa de número avulso que recebe resposta deve poder virar lead/card pelo CRM ("Promover a Lead" do protótipo)? Qual etapa e qual responsável? Enquanto isso, fica "em breve" | aberta | — |
