# Spec: Fase 5 — WhatsApp em lote, parte 2 (disparo)

> feature: fase5-whatsapp-lote-disparo
> status: rascunho

## Contexto

A parte 1 (`fase5-whatsapp-lote-base`) entregou o consentimento do lead, os templates aprovados e a
prévia de quem receberia um lote. Esta parte **envia**: o gerente seleciona cards na lista, escolhe um
template aprovado, confere a prévia e confirma; o sistema cria um **lote** com os elegíveis e um
**worker** (acionado pelo cron) manda **uma mensagem por vez**, com 15 a 45 segundos entre elas
(Q-050). A tela `/whatsapp/lote` acompanha cada lote e permite cancelar o que ainda não saiu.

## Histórias

### US-162 — Criar um lote de WhatsApp

Como gerente, quero disparar um template aprovado para os cards que selecionei, para falar com muitos leads sem passar das regras.

#### AC-677 — Criar o lote com os elegíveis

- **Dado** cards selecionados de leads com e sem consentimento e um template aprovado
- **Quando** o gerente (ou master) confirma o disparo (`POST /api/whatsapp/lote` com `templateId` e `oportunidadeIds` ou `leadIds`)
- **Então** o servidor recalcula a prévia (nunca confia no navegador) e cria um lote em andamento só com os elegíveis, guardando a mensagem já preenchida de cada um; a resposta (201) traz o id do lote, quantos entram e a lista dos que ficaram de fora com o motivo; atendente recebe 403 e sem sessão 401

#### AC-678 — Recusas na criação

- **Dado** um template em rascunho, de outra empresa, ou lista sem nenhum elegível, ou WhatsApp da empresa sem instância configurada, ou já existindo um lote em andamento
- **Quando** o gerente tenta criar o lote
- **Então** a criação é recusada sem gravar nada: 422 `TEMPLATE_NAO_APROVADO`, 404 (template de outra empresa), 422 `SEM_DESTINATARIOS`, 409 `WHATSAPP_NAO_CONFIGURADO` ou 409 `LOTE_EM_ANDAMENTO` (um lote por empresa de cada vez)

### US-163 — Enviar com intervalo e sem derrubar o lote

Como gerente, quero que as mensagens saiam espaçadas e que uma falha não pare o lote.

#### AC-679 — Um envio por vez, com 15 a 45 segundos entre eles

- **Dado** um lote em andamento com várias mensagens pendentes
- **Quando** o worker roda
- **Então** envia o próximo pendente, grava a mensagem na conversa do lead, marca o item como enviado e só libera o envio seguinte depois de um intervalo sorteado de 15 a 45 segundos; ao enviar o último, o lote vira concluído

#### AC-680 — A falha de um número não para o lote

- **Dado** um número sem WhatsApp ou uma falha da Evolution no meio do lote
- **Quando** o worker tenta enviar
- **Então** o item fica "falhou" com o motivo (`NUMERO_SEM_WHATSAPP` ou `FALHA_ENVIO`), nada é gravado na conversa, o intervalo continua valendo e os demais itens seguem

#### AC-681 — Consentimento revogado antes do envio

- **Dado** um item pendente cujo lead teve o consentimento revogado depois de o lote ser criado
- **Quando** chega a vez dele
- **Então** o item é cancelado com o motivo `SEM_CONSENTIMENTO` e nada é enviado

#### AC-682 — O worker só roda com o segredo do cron

- **Dado** a rota `POST /api/cron/whatsapp-lote`
- **Quando** é chamada sem o segredo (ou com segredo errado) e depois com o segredo certo
- **Então** a primeira dá 401 sem mexer em nada, e a segunda processa os lotes em andamento de todas as empresas dentro de um limite de tempo e registra a execução em `cron_execucoes`

### US-164 — Acompanhar e cancelar

Como gerente, quero ver quantas mensagens saíram e parar um lote.

#### AC-683 — Lista e detalhe dos lotes

- **Dado** lotes da empresa A e da empresa B
- **Quando** o gerente da A consulta (`GET /api/whatsapp/lote` e `GET /api/whatsapp/lote/[id]`)
- **Então** vê só os da A, do mais novo para o mais antigo, com template, quem criou, situação e as contagens de enviados, falhas, pendentes e cancelados; o detalhe lista cada destinatário com situação e motivo; lote da B é 404 e o atendente recebe 403

#### AC-684 — Cancelar um lote

- **Dado** um lote em andamento com itens enviados e pendentes
- **Quando** o gerente cancela (`POST /api/whatsapp/lote/[id]/cancelar`)
- **Então** os pendentes viram cancelados, o lote vira cancelado, os já enviados ficam como estão e o worker não envia mais nada dele; cancelar um lote concluído ou já cancelado dá 422 `LOTE_ENCERRADO`

### US-165 — Telas

Como gerente, quero disparar a partir da lista e acompanhar numa tela.

#### AC-685 — Diálogo de disparo na lista

- **Dado** cards selecionados na lista do pipeline
- **Quando** o gerente clica em "Disparar WhatsApp" (antes "em breve")
- **Então** abre um diálogo com os templates aprovados; ao escolher um, mostra a prévia (quantos receberão, quantos ficam de fora com o motivo em português e a duração estimada); "Confirmar envio" só habilita com pelo menos um elegível; ao confirmar, mostra "Lote criado" com o atalho "Acompanhar envio"; o botão não aparece para o atendente

#### AC-686 — Tela de acompanhamento e menu

- **Dado** o menu de Comunicação e a tela `/whatsapp/lote`
- **Quando** o gerente a abre
- **Então** "Envio em Lote" está no menu (só gerente e master) e leva a uma página que existe; a tela lista os lotes com barra de progresso e as contagens, abre o detalhe dos destinatários, mostra "Cancelar envio" nos lotes em andamento e atualiza sozinha enquanto houver lote em andamento; o atendente é barrado

## Fora de escopo

- Reenviar os que falharam, agendar o lote para uma data e repetir um lote.
- Mais de um lote por empresa ao mesmo tempo e limite diário ou mensal de envio.
- Configurar limite e intervalo por empresa (valores do sistema, parte 1).
- Mídia, botões e respostas automáticas; relatório de resposta do lote.
- O agendamento do cron em si (quem chama a rota a cada minuto é infraestrutura, item do cutover).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-246 | Uma empresa tem no máximo um lote em andamento; o seguinte só nasce quando o anterior conclui ou é cancelado | aberta | Mantém o intervalo valendo por instância do WhatsApp |
| ASM-247 | Quem cria, acompanha e cancela lote é gerente, master ou super admin; o atendente não vê nem o menu | aberta | Disparo em massa é decisão de gestão |
| ASM-248 | O worker roda por `POST /api/cron/whatsapp-lote` com o segredo do cron, chamado a cada minuto por um agendador externo; cada chamada trabalha até 55 segundos, dormindo o intervalo sorteado entre envios, e o lote seguinte da empresa espera `proximo_envio_em` | aberta | Item de infraestrutura no cutover |
| ASM-249 | A mensagem de cada item é gravada já preenchida na criação do lote; editar ou arquivar o template depois não muda o que vai sair | aberta | O que o gerente viu na prévia é o que sai |
| ASM-250 | O consentimento é conferido de novo na hora do envio; o item cancelado por isso não conta para o intervalo | aberta | Consentimento revogado vale a qualquer momento |
| ASM-251 | Item que falha não é repetido (sem retry automático); o gerente vê o motivo e decide | aberta | Evita insistir num número sem WhatsApp |

## Perguntas em aberto

Nenhuma.
