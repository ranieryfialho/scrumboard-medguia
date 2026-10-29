# Spec: Fase 5 — Ações rápidas: cancelar reunião, ligar e promover número avulso a lead

> feature: fase5-acoes-rapidas
> status: rascunho

## Contexto

Três ações que apareciam "em breve" nas telas da fase 4 e que o dono do produto decidiu entregar
(Q-049, Q-052, Q-054): **cancelar uma reunião** (o card volta para "Qualificado p/ reunião"),
**ligar** (abre o discador do aparelho com o telefone do lead) e **promover um número avulso do
WhatsApp a lead** (nasce um card em "Entrada de leads" com quem promoveu como responsável).

## Histórias

### US-150 — Cancelar uma reunião agendada

Como atendente ou gerente, quero cancelar uma reunião que ainda não aconteceu, para que o card volte
para a fila de quem precisa de nova data.

#### AC-640 — Cancelar leva o card de volta para "Qualificado p/ reunião"

- **Dado** uma reunião agendada para o futuro, cujo card está em "Reunião agendada"
- **Quando** o usuário cancela a reunião
- **Então** a reunião deixa de aparecer na agenda e o card volta para "Qualificado p/ reunião", com a mudança de etapa registrada no histórico do card (`POST /api/reunioes/[id]/cancelar`)

#### AC-641 — Só reunião agendada pode ser cancelada

- **Dado** uma reunião em andamento, aguardando resultado, realizada, com no-show ou já remarcada
- **Quando** o usuário tenta cancelar
- **Então** a ação é recusada (422) e a reunião e o card ficam como estavam

#### AC-642 — Quem pode cancelar

- **Dado** um atendente, um gerente e uma reunião de outra empresa
- **Quando** cada um tenta cancelar
- **Então** o gerente cancela qualquer reunião da empresa, o atendente só as dos próprios cards (nas dos outros recebe "não encontrada", 404), e a reunião de outra empresa é "não encontrada" para todos; sem sessão a resposta é 401

#### AC-643 — Botão "Cancelar" na agenda

- **Dado** uma reunião agendada na agenda
- **Quando** o usuário clica em "Cancelar"
- **Então** a tela pede confirmação ("O card volta para Qualificado p/ reunião"); ao confirmar, a reunião some da lista; se a ação for recusada, a tela mostra o motivo em português; "Cancelar" deixa de ser "em breve"

#### AC-644 — Nova transição permitida no funil

- **Dado** o grafo de etapas do funil
- **Quando** se consulta a transição "Reunião agendada" → "Qualificado p/ reunião"
- **Então** ela existe e vale para os três papéis (migration 0017), sem exigir justificativa; nenhuma outra transição muda

### US-151 — Ligar para o lead

Como atendente, quero tocar em "Ligar" e abrir o discador com o telefone do lead, para ligar sem digitar.

#### AC-645 — "Ligar Agora" na conversa do card

- **Dado** um card cujo lead tem telefone principal
- **Quando** o usuário abre a conversa de WhatsApp do card
- **Então** "Ligar Agora" é um link `tel:` com o telefone do lead em formato internacional (ex.: `tel:+5511999990000`); sem telefone, o botão não aparece

#### AC-646 — "Ligar para Clínica" na agenda

- **Dado** uma reunião aguardando resultado cujo lead tem telefone
- **Quando** o usuário olha as ações da reunião
- **Então** "Ligar para Clínica" é um link `tel:` com esse telefone; sem telefone o botão não aparece

### US-152 — Promover um número avulso a lead

Como atendente, quero transformar um número avulso do WhatsApp em lead, para que a conversa entre no funil.

#### AC-647 — Promover cria o lead, o card e liga as mensagens

- **Dado** um número que trocou mensagens e não é de nenhum lead
- **Quando** o usuário informa o nome e promove (`POST /api/whatsapp/promover`)
- **Então** nasce um lead com esse nome, o número como telefone e origem "WhatsApp", mais um card em "Entrada de leads" tendo o usuário como responsável; as mensagens do número (inclusive a variação com ou sem o nono dígito) passam a ser do lead; a resposta (201) traz o id do card

#### AC-648 — Recusas

- **Dado** nome vazio, número inválido, número que já é de um lead da empresa, ou ausência de sessão
- **Quando** o usuário tenta promover
- **Então** a resposta é 400 (nome ou número), 409 (número já é de um lead) ou 401, e nada é criado

#### AC-649 — Promover é separado por empresa

- **Dado** o mesmo número com mensagens avulsas em duas empresas
- **Quando** a empresa A promove o número
- **Então** só as mensagens da empresa A passam para o novo lead; as da empresa B continuam avulsas

#### AC-650 — Botão "Promover a Lead" nas conversas avulsas

- **Dado** uma conversa avulsa aberta no WhatsApp, ou um disparo avulso na tela "Nova mensagem"
- **Quando** o usuário digita o nome e clica em "Promover a Lead"
- **Então** o lead é criado e a tela leva ao card dele; o item genérico "Promover a Lead (em breve)" deixa de existir

## Fora de escopo

- Registrar a ligação feita (duração, resultado): o discador só abre; o CRM não registra a chamada (decisão do dono do produto).
- Cancelar com motivo, avisar o lead do cancelamento e desfazer o cancelamento.
- Cancelar reunião de card que não esteja em "Reunião agendada".
- "Reenviar" de disparo avulso, que continua "em breve".

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-222 | Cancelar apaga a linha da reunião (não existe coluna de situação); o que fica registrado é a mudança de etapa do card no histórico (`oportunidade_eventos`). Se a reunião cancelada era um reagendamento, a anterior perde o status "remarcada" | aberta | Evita migration de coluna; a perda do histórico da reunião em si é aceita |
| ASM-223 | Quem cancela segue a regra das demais ações da agenda: gerente, master e super admin em qualquer reunião da empresa; atendente só nas dos próprios cards | aberta | Mesma regra de `podeAgirNoCard` |
| ASM-224 | "Reunião agendada" → "Qualificado p/ reunião" também passa a valer para quem arrasta o card no funil, não só pelo botão de cancelar | aberta | O grafo é uma tabela só; a regra de domínio é a mesma |
| ASM-225 | O telefone do `tel:` é `leads.telefone_e164` (o principal), com `+` na frente | aberta | Telefones extras ficam fora desta entrega |
| ASM-226 | Promover cria o lead com origem fixa "WhatsApp" e o nome informado; o responsável é quem promove, mesmo gerente | aberta | Atendente só vê seus cards; evita lead órfão |
| ASM-227 | Um número "já é de um lead" se algum lead da empresa tem esse telefone principal (qualquer variação do nono dígito) | aberta | Telefones extras de `lead_telefones` não são conferidos |

## Perguntas em aberto

Nenhuma.
