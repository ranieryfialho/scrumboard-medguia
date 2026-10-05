# Spec: Fase 2c — Anexos (upload, URL assinada e evidência de etapa)

> feature: fase2c-anexos
> status: rascunho

## Contexto

O Kanban (fase2-kanban) já exige evidência para entrar em "Reunião realizada" (etapa 10), mas não existe como enviar um anexo — por isso essa etapa está inatingível. Esta feature entrega o armazenamento de prints/PDF em volume Docker, a emissão de URL assinada de curta duração com checagem de tenant (TDD-001 §rotas `/api/anexos`) e o uso do anexo como evidência na transição de etapa. A tabela `anexos` já existe (fase1-schema-drizzle).

## Histórias

### US-034 — Enviar um print ou PDF para um card

Como vendedor, quero enviar (ou colar) um print de conversa ou um PDF no card, para que a evidência fique registrada junto à oportunidade.

#### AC-095 — Imagem válida é guardada e registrada

- **Dado** um usuário autenticado e um card do seu tenant
- **Quando** ele envia um PNG de 1 MB para esse card (`POST /api/anexos`, multipart com `oportunidadeId` e arquivo)
- **Então** a resposta é 201 com o `anexoId`, e fica um registro em `anexos` com a empresa do usuário, o card, o tipo `image/png`, o tamanho em bytes, o hash SHA-256 do conteúdo e o usuário que enviou; os bytes ficam gravados no volume de anexos

#### AC-096 — O tipo é decidido pelo conteúdo, não pelo que o navegador diz

- **Dado** um arquivo executável (ou texto) renomeado para `foto.png` e enviado com `Content-Type: image/png`
- **Quando** o upload é feito
- **Então** o envio é recusado com 415 (`TIPO_NAO_PERMITIDO`), nada é gravado no volume nem em `anexos`; só PNG, JPEG, WebP e PDF reais são aceitos

#### AC-097 — Limite de tamanho: imagem até 5 MB, PDF até 10 MB

- **Dado** um usuário autenticado e um card do seu tenant
- **Quando** ele envia uma imagem de 5 MB + 1 byte, ou um PDF de 10 MB + 1 byte
- **Então** o envio é recusado com 413 (`ARQUIVO_GRANDE_DEMAIS`) e nada é gravado; já um PDF de 8 MB (acima do limite de imagem, abaixo do de PDF) é aceito com 201

#### AC-098 — Nome do arquivo enviado nunca decide onde o arquivo fica

- **Dado** um upload cujo nome original é `../../etc/passwd.png` (conteúdo PNG válido)
- **Quando** o upload é feito
- **Então** o arquivo é gravado dentro do volume de anexos com um nome gerado pelo servidor (sem nenhum trecho do nome original) e nenhum arquivo aparece fora desse volume

#### AC-099 — Card de outro tenant não aceita anexo

- **Dado** um card que pertence a outra empresa (ou que não existe)
- **Quando** o usuário tenta enviar um anexo para ele
- **Então** a resposta é 404 (`OPORTUNIDADE_NAO_ENCONTRADA`), sem 403 que revele existência, e nada é gravado

#### AC-100 — Sem login não há upload

- **Dado** uma requisição sem sessão válida
- **Quando** ela chama `POST /api/anexos` ou `GET /api/anexos/:id`
- **Então** a resposta é 401 (`NAO_AUTENTICADO`) e nenhum dado de negócio é lido nem gravado

### US-035 — Abrir um anexo por link de curta duração

Como vendedor, quero abrir o print de um card, para que eu confira a evidência sem que o link possa ser guardado e reaproveitado por quem não deveria.

#### AC-101 — Dono do tenant é redirecionado para uma URL assinada que expira em 60 s

- **Dado** um anexo do tenant do usuário
- **Quando** ele chama `GET /api/anexos/:id`
- **Então** a resposta é 302 para uma URL assinada (HMAC) cuja validade é de 60 segundos a partir da emissão

#### AC-102 — Anexo de outro tenant não gera link

- **Dado** um anexo que pertence a outra empresa (ou id inexistente)
- **Quando** o usuário chama `GET /api/anexos/:id`
- **Então** a resposta é 404 (`ANEXO_NAO_ENCONTRADO`) e nenhuma URL assinada é emitida

#### AC-103 — A URL assinada válida entrega o arquivo com o tipo correto

- **Dado** uma URL assinada emitida há menos de 60 s
- **Quando** ela é aberta (mesmo sem cookie de sessão — a assinatura é a credencial)
- **Então** a resposta é 200 com os mesmos bytes enviados e o `Content-Type` gravado, com `X-Content-Type-Options: nosniff`

#### AC-104 — URL expirada ou adulterada é recusada

- **Dado** uma URL assinada com mais de 60 s, ou com a assinatura/expiração/id alterados
- **Quando** ela é aberta
- **Então** a resposta é 403 (`LINK_INVALIDO`) e nenhum byte do arquivo é entregue

### US-036 — Usar o anexo como evidência para mover o card

Como vendedor, quero anexar a evidência e mover o card para "Reunião realizada", para que a etapa 10 deixe de ficar inatingível.

#### AC-105 — Mover para "Reunião realizada" com anexo do próprio card funciona

- **Dado** um card em etapa que alcança a etapa 10 e um anexo enviado para esse mesmo card
- **Quando** o usuário move o card para a etapa 10 informando `anexoId`
- **Então** a transição é aceita (200) e o card passa a estar na etapa 10

#### AC-106 — Anexo que não é do card não vale como evidência

- **Dado** um `anexoId` inexistente, de outro tenant ou de outra oportunidade do mesmo tenant
- **Quando** o usuário tenta mover o card para a etapa 10 com ele
- **Então** a resposta é 422 (`EVIDENCIA_OBRIGATORIA`), o card não se move e nenhum evento é gravado

#### AC-107 — O modal permite escolher ou colar o print e então confirmar

- **Dado** o modal de dado faltante aberto com `EVIDENCIA_OBRIGATORIA`
- **Quando** o usuário escolhe um arquivo ou cola uma imagem (Ctrl+V) e o envio dá certo
- **Então** o modal mostra o nome do arquivo anexado, o botão de confirmar fica habilitado e a confirmação manda o `anexoId` da transição; se o envio falha, o modal mostra o motivo e o botão continua desabilitado

## Fora de escopo

- SSE (`/api/stream`) e WhatsApp/webhook da Evolution — ficam para uma feature seguinte da f2c.
- Registro de reunião (`reunioes`: início, fim, duração ≥ 10 min, resumo) — esta feature só exige o anexo como evidência.
- Anexo em atividade da cadência (`cadencia_atividades.anexo_id`) e listagem de anexos no detalhe do card.
- Exclusão de anexo, limpeza de arquivos órfãos, antivírus e deduplicação por hash.
- Aplicar a infra na VPS (volume em produção): o deploy segue manual.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-023 | Tipos aceitos: PNG, JPEG, WebP (até 5 MB) e PDF (até 10 MB); URL assinada vale 60 s. | confirmada | Decidido pelo usuário em 2026-10-02. |
| ASM-024 | A assinatura é HMAC-SHA256 de `id + empresa + expiração` (a empresa vai na URL, para ler a linha sob o RLS do tenant certo) com um segredo próprio do servidor (variável `ANEXOS_SEGREDO`), e o arquivo é servido por uma rota da própria aplicação (`/api/anexos/arquivo/:id`), sem proxy externo. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-025 | O diretório do volume vem de `ANEXOS_DIR` (padrão `/data/anexos`) e o `docker-compose.yml` ganha o volume `anexos`; nada é aplicado na VPS nesta feature. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-026 | Para a etapa 10, a evidência exigida é só `anexoId` válido do próprio card; duração da reunião e resumo ficam para a feature de reuniões. | confirmada | Confirmada pelo usuário em 2026-10-05. |
| ASM-027 | Qualquer papel autenticado do tenant pode enviar e abrir anexos de cards do seu tenant (sem restrição por responsável do card). | confirmada | Confirmada pelo usuário em 2026-10-05. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| — | Nenhuma. | — | — |
