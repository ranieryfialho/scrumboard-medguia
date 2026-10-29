# Spec: Fase 5 — WhatsApp em lote, parte 1 (base): consentimento, templates e regras

> feature: fase5-whatsapp-lote-base
> status: rascunho

## Contexto

O dono do produto decidiu (Q-050) que o WhatsApp em lote só existe com quatro regras: **limite por
disparo** (50 leads), **intervalo** de 15 a 45 segundos entre mensagens, **consentimento** do lead e
**só templates aprovados**. Esta primeira parte entrega a base — sem enviar nada: o consentimento
no lead, o cadastro e a aprovação de templates, as regras e a **prévia** de um lote (quem receberia,
quem fica de fora e por quê). A tela e a fila de envio são a parte 2 (`fase5-whatsapp-lote-disparo`).

## Histórias

### US-159 — Registrar o consentimento do lead para WhatsApp

Como atendente, quero registrar que o lead aceitou receber WhatsApp, para que ele possa entrar em lotes.

#### AC-667 — Registrar e revogar o consentimento

- **Dado** um lead da empresa sem consentimento
- **Quando** o usuário o marca como "autoriza receber WhatsApp" (`PUT /api/leads/[id]/consentimento` com `consentimento: true`)
- **Então** o lead passa a ter consentimento com a data e quem registrou (`GET` devolve `consentimento`, `em` e `porNome`); marcar `false` apaga o consentimento, a data e o autor

#### AC-668 — Só o lead da empresa; sem sessão não entra

- **Dado** um lead de outra empresa, um id inválido e uma chamada sem sessão
- **Quando** se tenta ler ou mudar o consentimento
- **Então** a resposta é 404 (lead de outra empresa ou id inválido) ou 401 (sem sessão), e nada muda

#### AC-669 — Bloco de consentimento no card

- **Dado** o card de um lead
- **Quando** o usuário o abre
- **Então** vê "Autoriza receber WhatsApp": sem consentimento mostra "Sem consentimento" e o botão "Registrar consentimento"; com consentimento mostra "Consentido por Fulano em 29/10/2026" e o botão "Revogar"; uma falha da API aparece como aviso

### US-160 — Cadastrar e aprovar templates de mensagem

Como gerente, quero cadastrar mensagens-modelo e aprová-las, para que só texto aprovado seja usado em lote.

#### AC-670 — Criar um template

- **Dado** um gerente (ou master) da empresa A
- **Quando** cria um template com nome (2 a 60 caracteres) e corpo (1 a 1000 caracteres) usando só as variáveis `{{nome}}` e `{{primeiro_nome}}`
- **Então** o template nasce como rascunho; nome repetido na empresa (sem diferenciar maiúsculas) dá 409 `TEMPLATE_JA_EXISTE`; outra variável (`{{cidade}}`) ou tamanho inválido dá 400 com o campo; atendente recebe 403

#### AC-671 — Aprovar, arquivar e editar

- **Dado** um template em rascunho, um aprovado e um arquivado
- **Quando** o gerente aprova, arquiva ou edita
- **Então** aprovar grava quem aprovou e quando; arquivar tira o template de uso; editar nome ou corpo de um aprovado devolve-o a rascunho (precisa de nova aprovação); arquivado não pode ser editado nem aprovado (422 `TEMPLATE_ARQUIVADO`); template de outra empresa é "não encontrado" (404)

#### AC-672 — Quem vê o quê

- **Dado** templates em todas as situações em duas empresas
- **Quando** um gerente e um atendente da empresa A abrem a lista
- **Então** o gerente vê todos os da A (rascunho, aprovado e arquivado), o atendente vê só os aprovados da A, e ninguém vê os da B

#### AC-673 — Tela de templates e menu

- **Dado** o menu de Comunicação e a tela `/whatsapp/templates`
- **Quando** o usuário a abre
- **Então** "Templates" está no menu e leva a uma página que existe; a tela lista os templates com a situação e uma prévia com um nome de exemplo; gerente e master veem "Novo template", "Aprovar", "Arquivar" e "Editar"; o atendente só lê; erros da API aparecem junto do campo

### US-161 — Regras do lote e prévia de quem receberia

Como gerente, quero ver quem receberia um lote antes de enviar, para não passar das regras.

#### AC-674 — As regras

- **Dado** o sistema
- **Quando** se consulta as regras do lote (`GET /api/whatsapp/lote/regras`)
- **Então** vêm o limite de 50 leads por disparo e o intervalo entre mensagens de 15 a 45 segundos; sortear um intervalo nunca sai dessa faixa

#### AC-675 — Prévia do lote

- **Dado** uma lista de leads (com e sem consentimento, com e sem telefone, com telefone repetido, e mais de 50) e um template aprovado
- **Quando** o usuário pede a prévia (`POST /api/whatsapp/lote/previa` com `leadIds` e `templateId`)
- **Então** a resposta separa os **elegíveis** (têm telefone e consentimento, até o limite de 50, na ordem enviada, com a mensagem já preenchida com o nome) dos **excluídos**, cada um com o motivo: `SEM_CONSENTIMENTO`, `SEM_TELEFONE`, `TELEFONE_REPETIDO` (inclusive as duas grafias do nono dígito), `ACIMA_DO_LIMITE` ou `LEAD_NAO_ENCONTRADO` (id de outra empresa); a resposta traz também a duração estimada

#### AC-676 — Só template aprovado da empresa

- **Dado** um template em rascunho, um arquivado, um de outra empresa e um que não existe
- **Quando** se pede a prévia com cada um
- **Então** rascunho e arquivado dão 422 `TEMPLATE_NAO_APROVADO`, o de outra empresa e o inexistente dão 404, e nada é calculado; sem sessão dá 401

## Fora de escopo

- **Enviar** as mensagens, a fila, o intervalo real entre envios e a tela de envio em lote: parte 2.
- Aprovação do template pela Meta/WhatsApp (a aprovação aqui é interna, da gestão).
- Limite e intervalo configuráveis por empresa (valores fixos no sistema nesta parte).
- Consentimento em massa (importar lista) e histórico das mudanças de consentimento.
- Templates com mais variáveis, mídia, botões ou idiomas; usar template na conversa avulsa ("Templates" segue "em breve" lá).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-240 | Consentimento é do lead (não do telefone): colunas `consentimento_whatsapp_em` e `consentimento_whatsapp_por` em `leads`; vazio = sem consentimento. Qualquer papel que enxerga o lead registra ou revoga | aberta | Quem coletou o aceite registra; fica o autor e a data |
| ASM-241 | A aprovação do template é interna: gerente, master ou super admin; não exige pessoa diferente de quem criou | aberta | O dono do produto pediu "só templates aprovados", sem dupla checagem |
| ASM-242 | Variáveis suportadas: `{{nome}}` (nome completo do lead) e `{{primeiro_nome}}`; qualquer outra `{{...}}` é recusada | aberta | Resolve Q-055 só no lado do CRM; o motor externo de e-mail é outro assunto |
| ASM-243 | Limite de 50 leads por disparo e intervalo de 15 a 45 segundos são constantes do sistema nesta parte; a duração estimada usa o intervalo médio (30 s) × (elegíveis − 1) | aberta | Configuração por empresa fica para depois |
| ASM-244 | A prévia aceita até 500 ids por chamada (acima disso 400); só ela corta em 50 e marca o excedente `ACIMA_DO_LIMITE` | aberta | Evita payload gigante |
| ASM-245 | Telefone repetido = mesmo número em qualquer grafia do nono dígito; fica o primeiro lead da lista | aberta | Evita mandar duas vezes para a mesma pessoa |

## Perguntas em aberto

Nenhuma.
