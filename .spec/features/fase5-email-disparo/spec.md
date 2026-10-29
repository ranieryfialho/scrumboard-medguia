# Spec: Fase 5 — E-mail das campanhas, parte 2: disparo no CRM e pausar

> feature: fase5-email-disparo
> status: rascunho

## Contexto

A parte 1 (`fase5-email-config`) entregou a chave do Resend por empresa (cifrada), o remetente e as
variáveis do corpo. Esta parte traz o **disparo para dentro do CRM**, no lugar do motor Python
(`worker-medguia-hub`), que lê o Supabase e não enxerga o `crm_prod`. Um worker novo (`crm-worker-email`,
mesma imagem do CRM) pega os envios `PENDENTE` das campanhas em andamento, manda pelo Resend com a chave
de cada empresa e grava o resultado; e a campanha ganha **pausar e retomar** (Q-055), feitos no próprio CRM
(o motor só envia o que está `PENDENTE`).

## Histórias

### US-171 — Disparar as campanhas pelo worker do CRM

Como gerente, quero que a campanha iniciada seja enviada sozinha, com a chave da minha empresa, e que cada envio fique registrado.

#### AC-701 — Pegar, enviar e registrar

- **Dado** uma campanha em andamento com destinatários `PENDENTE` e a chave do Resend da empresa configurada
- **Quando** o worker roda um ciclo
- **Então** ele pega até 10 envios por empresa, marcando-os `ENVIANDO` na mesma transação (dois ciclos nunca pegam o mesmo envio), manda cada um com a chave e o remetente da empresa, com o corpo já preenchido com o nome do destinatário, com o rodapé e os cabeçalhos de descadastro (`fase5-email-descadastro`) e as tags `envio_id` e `empresa_id` (as duas, porque o webhook do Resend as exige); o envio vira `ENVIADO` com `enviado_em` e `tentativas` + 1

#### AC-702 — Ritmo entre os envios

- **Dado** vários envios no mesmo ciclo
- **Quando** o worker os envia
- **Então** espera 2 segundos entre um e outro (e não espera depois do último); o ciclo roda a cada 10 segundos

#### AC-703 — A falha de um envio não derruba os outros

- **Dado** o Resend recusando um destinatário (resposta fora de 2xx) ou a rede falhando
- **Quando** o worker tenta enviar
- **Então** aquele envio vira `ERRO` com `tentativas` + 1 e o motivo (`RESEND_RECUSOU` ou `FALHA_DE_REDE`), e os demais seguem

#### AC-704 — Empresa sem chave

- **Dado** uma empresa com campanha em andamento e sem chave do Resend (ou com a chave que não decifra)
- **Quando** o worker chega nos envios dela
- **Então** os pendentes viram `ERRO` com o motivo `SEM_CHAVE_RESEND` e `tentativas` inalteradas (depois de configurar a chave, "Reenviar falhas" os devolve à fila); as outras empresas não são afetadas

#### AC-705 — Só campanha em andamento envia

- **Dado** envios `PENDENTE` de uma campanha em rascunho, pausada ou finalizada
- **Quando** o worker roda
- **Então** nada deles é enviado

#### AC-706 — A campanha termina sozinha

- **Dado** uma campanha em andamento sem mais envios `PENDENTE` nem `ENVIANDO`
- **Quando** o worker roda
- **Então** a campanha vira `FINALIZADA` (sem depender de alguém abrir a tela)

#### AC-707 — Envio interrompido não é repetido

- **Dado** um envio `ENVIANDO` há mais de 10 minutos (o worker caiu no meio)
- **Quando** o worker roda
- **Então** ele vira `ERRO` com o motivo `INTERROMPIDO` e **não** é reenviado sozinho (pode já ter saído; quem decide é o gerente, em "Reenviar falhas")

#### AC-708 — Ponto de entrada do worker

- **Dado** o comando `npm run worker:email`
- **Quando** o worker sobe
- **Então** só exige `DATABASE_URL` e `SEGREDO_CONFIGURACOES` (não as variáveis do Sheets e da LP), roda um ciclo a cada 10 s, um ciclo que falha não derruba o processo, e ao receber SIGTERM termina o ciclo em curso antes de sair

### US-172 — Pausar e retomar uma campanha

Como gerente, quero pausar uma campanha em andamento e retomá-la depois, sem perder quem ainda não recebeu.

#### AC-709 — Pausar

- **Dado** uma campanha em andamento
- **Quando** o gerente (ou master) pausa (`POST /api/campanhas/[id]/pausar`)
- **Então** a campanha vira `PAUSADA` e os destinatários `PENDENTE` viram `PAUSADO` na mesma transação (os que já estão `ENVIANDO` terminam); a resposta traz quantos foram pausados; campanha que não está em andamento dá 422 `CAMPANHA_NAO_PROCESSANDO`; de outra empresa 404; atendente 403

#### AC-710 — Retomar

- **Dado** uma campanha pausada
- **Quando** o gerente a retoma (`POST /api/campanhas/[id]/retomar`)
- **Então** a campanha volta a `PROCESSANDO` e os `PAUSADO` voltam a `PENDENTE`; campanha que não está pausada dá 422 `CAMPANHA_NAO_PAUSADA`; de outra empresa 404; atendente 403

#### AC-711 — O que a pausa protege

- **Dado** uma campanha pausada
- **Quando** alguém abre a tela, tenta excluí-la ou usa "Reenviar falhas"
- **Então** ela não finaliza sozinha; a exclusão é recusada como a de uma campanha em andamento (422); "Reenviar falhas" é recusado (422 `CAMPANHA_PAUSADA`), para não despausar sem querer

### US-173 — Telas e o aviso de chave

Como gerente, quero ver a campanha pausada, o motivo de cada falha e ser avisado quando falta a chave.

#### AC-722 — Quem saiu da lista não recebe

- **Dado** um destinatário `PENDENTE` cujo e-mail a empresa descadastrou (inclusive depois de a campanha ser criada)
- **Quando** chega a vez dele no worker
- **Então** nada é enviado e o envio vira `DESCADASTRADO` (um estado próprio, que **não** volta com "Reenviar falhas" e não conta como falha); o descadastro de outra empresa não o afeta

#### AC-712 — Detalhe e lista com pausa e motivo

- **Dado** o detalhe e a lista de campanhas
- **Quando** a campanha está em andamento, pausada ou tem falhas
- **Então** em andamento mostra "Pausar", pausada mostra "Retomar" e o selo "Pausada" (também na lista), os contadores incluem "Pausados" e "Descadastrados", e cada falha mostra o motivo em português (`SEM_CHAVE_RESEND`: "Chave do Resend não configurada" com o atalho para `/configuracoes/email`; `RESEND_RECUSOU`, `FALHA_DE_REDE` e `INTERROMPIDO` com texto próprio)

#### AC-713 — Não iniciar sem chave

- **Dado** uma empresa sem a chave do Resend configurada
- **Quando** o gerente tenta iniciar uma campanha (`POST /api/campanhas/[id]/iniciar`)
- **Então** a API recusa com 409 `CHAVE_RESEND_NAO_CONFIGURADA` e nada muda; a tela avisa "A empresa ainda não tem a chave do Resend" com o atalho para configurar

## Fora de escopo

- Verificar o domínio (SPF e DKIM) e tratar `bounce`/`complaint` do Resend; hoje só aberto e clicado voltam pelo webhook.
- Retentar sozinho, agendar a campanha, limite diário por empresa e variáveis no assunto.
- Desligar o motor Python (item do cutover) e rotacionar o token que está versionado no repositório dele.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-261 | O disparo roda num segundo container, `crm-worker-email`, com a mesma imagem do CRM e o comando `npm run worker:email` (ponto de entrada `src/worker/email.ts`); assim uma rajada de e-mails não ocupa o worker da ingestão e ele não exige as variáveis do Sheets e da LP | aberta | Entra no `docker-compose.yml` e no cutover; vale o mesmo pré-requisito do `crm-worker` (a imagem precisa incluir `src/worker` e `tsx`) |
| ASM-262 | O ritmo é o do motor atual: até 10 envios por empresa por ciclo, 2 s entre envios, ciclo a cada 10 s (cerca de 300 e-mails por minuto por empresa no máximo) | aberta | Constantes do sistema; configurar por empresa é evolução |
| ASM-263 | Estados novos são texto, sem enum: envio `ENVIANDO` e `PAUSADO`, campanha `PAUSADA`; a migration 0024 acrescenta a coluna `envios_campanha.erro` (motivo curto, anulável); `DESCADASTRADO` também é um estado de envio e um índice parcial dos envios pendentes | aberta | Evita varrer a tabela inteira a cada ciclo |
| ASM-264 | Não há retentativa automática: o envio que falha fica `ERRO` e o gerente decide em "Reenviar falhas" (que já existe e volta `ERRO` para `PENDENTE`) | aberta | Igual ao WhatsApp em lote (ASM-251) |
| ASM-265 | Pausar, retomar e iniciar são de gerente, master e super admin (a regra das ações de campanha de hoje) | aberta | — |
| ASM-266 | O motor Python segue servindo o sistema legado até o cutover e é desligado nele; os dois nunca leem o mesmo banco | aberta | O motor lê o Supabase; o novo lê o `crm_prod` |
| ASM-272 | O descadastro (link, página, lista e rodapé) é a feature `fase5-email-descadastro`, que vem **antes** do disparo; aqui só se usa: o worker confere a lista na hora do envio e leva o rodapé e os cabeçalhos | aberta | Ordem de entrega: config, descadastro, disparo |
| ASM-267 | O envio usa a API HTTP do Resend (`POST https://api.resend.com/emails`) com `fetch`, como o e-mail transacional; o transporte é injetável nos testes (sem Resend real) | aberta | — |

## Perguntas em aberto

Nenhuma.
