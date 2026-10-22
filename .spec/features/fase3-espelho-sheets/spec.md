# Spec: Fase3 espelho sheets

> feature: fase3-espelho-sheets
> status: rascunho

## Contexto

Depois do cutover o app **para de escrever status na planilha** (RFC-001 §5 D2 passo 4) e a liderança comercial perde a visão que tinha no Google Sheets. O RFC-001 (Q7) e o TDD-001 §3 decidiram por um **espelho somente leitura**: o `crm-worker` grava, a cada 15 minutos, o estado atual dos cards numa aba do Sheets só para consulta. O espelho também reduz a perda em caso de desastre (o backup tem RPO de 24h; o espelho guarda etapa, dia de cadência, tentativas e próxima ação com no máximo 15 min de atraso). Esta feature reaproveita o `crm-worker` e o registro em `cron_execucoes` da `fase3-ingestao-continua`. A ingestão (leitura do Sheets) já existe e **não pode** reler o espelho como se fosse lead.

## Histórias

### US-094 — A liderança consulta o funil no Sheets

Como liderança comercial, quero ver numa aba do Google Sheets o estado atual de todos os cards, para acompanhar o funil sem entrar no CRM.

#### AC-329 — Cada card aparece como uma linha da aba do espelho

- **Dado** cards em várias etapas (inclusive Contrato (Ganho) e Perdido) da empresa que usa o Sheets
- **Quando** o espelho roda
- **Então** a aba "Espelho CRM" tem uma linha por card, com nome, telefone, e-mail, etapa, responsável, valor, motivo de perda, data de criação e data da última atualização
- **E** a primeira linha é um cabeçalho fixo com esses nomes de coluna

#### AC-330 — O espelho traz o estado da cadência

- **Dado** um card em cadência no 3º dia, com 5 atividades já registradas e 2 pendentes, e próxima ação marcada
- **Quando** o espelho roda
- **Então** a linha do card mostra o dia da cadência, o turno, a quantidade de tentativas feitas (atividades que não estão pendentes) e a data/hora da próxima ação
- **E** um card sem cadência mostra essas colunas em branco

#### AC-331 — Só os cards da empresa do Sheets entram

- **Dado** cards da empresa `medguia` e de outra empresa sem integração com o Sheets
- **Quando** o espelho roda
- **Então** a aba só tem cards da `medguia`
- **E** nenhum dado da outra empresa é gravado na planilha

### US-095 — O espelho é sempre o retrato atual e ninguém o corrompe

Como liderança comercial, quero que a aba reflita sempre o estado atual do CRM, mesmo que alguém edite a aba por engano, para confiar no que vejo.

#### AC-332 — Cada execução substitui o conteúdo inteiro da aba

- **Dado** a aba com linhas de uma execução anterior, um card que mudou de etapa e um card que deixou de existir
- **Quando** o espelho roda de novo
- **Então** a aba mostra só o estado atual: o card na etapa nova e sem a linha do card removido
- **E** não sobra linha antiga abaixo do fim dos dados

#### AC-333 — Edições manuais na aba são sobrescritas e nunca chegam ao CRM

- **Dado** alguém que apagou uma linha e digitou outro valor numa célula da aba "Espelho CRM"
- **Quando** o espelho roda e, depois, a ingestão de leads roda
- **Então** a aba volta a mostrar o estado do CRM
- **E** nenhum lead, card ou etapa do CRM muda por causa dessa edição

#### AC-334 — A ingestão de leads nunca lê a aba do espelho

- **Dado** a planilha 1, que tem a aba "Espelho CRM" ao lado das abas de leads
- **Quando** o ciclo de importação do Sheets roda
- **Então** só as quatro abas de leads e a aba `Agenda` são lidas, e nenhuma linha do espelho vira lead

#### AC-335 — Texto que parece fórmula não é executado

- **Dado** um lead cujo nome começa com `=`, `+`, `-` ou `@` (por exemplo `=HYPERLINK(...)`)
- **Quando** o espelho grava a linha
- **Então** a célula é gravada como texto literal, sem ser interpretada como fórmula pelo Sheets

### US-096 — Saber se o espelho está atualizado

Como responsável técnico, quero ver se o espelho rodou e quando, para ser avisado antes da liderança olhar dados velhos (alerta do TDD-001 §8: mais de 45 min).

#### AC-336 — Cada execução fica registrada em `cron_execucoes`

- **Dado** o worker ligado
- **Quando** o espelho roda com sucesso, ou falha
- **Então** existe uma linha em `cron_execucoes` com o job `espelho-sheets`, início, fim, status e quantidade de cards gravados
- **E** em caso de falha a mensagem guardada não contém chave nem credencial

#### AC-337 — O espelho roda a cada 15 minutos, sem sobrepor execuções

- **Dado** o worker com o intervalo do espelho configurado (padrão 15 minutos)
- **Quando** o tempo passa por mais de um intervalo, ou um disparo chega com a execução anterior ainda em andamento
- **Então** o espelho roda uma vez por intervalo
- **E** o disparo sobreposto é pulado, sem gravar duas vezes ao mesmo tempo

#### AC-338 — A saúde do worker acusa espelho atrasado

- **Dado** que a última execução bem-sucedida de `espelho-sheets` tem mais de 45 minutos (ou nunca houve)
- **Quando** a verificação de saúde do worker roda
- **Então** ela sai com código de falha e diz que o espelho está atrasado
- **E** com uma execução bem-sucedida há menos de 45 minutos ela não reclama do espelho

#### AC-339 — Falha do Sheets não derruba o worker nem apaga o espelho

- **Dado** o Google Sheets fora do ar, ou uma planilha sem permissão de escrita
- **Quando** o espelho roda
- **Então** a execução termina como falha registrada, sem derrubar o worker nem as importações
- **E** a aba não é limpa antes de ter os dados novos em mãos (a leitura do banco acontece antes de qualquer alteração na planilha)

## Fora de escopo

- Qualquer escrita do Sheets para o CRM: o espelho é de mão única (CRM → Sheets); edições na aba são ignoradas.
- Atualização incremental (só o que mudou): cada execução reescreve a aba inteira.
- Formatação visual elaborada (cores por etapa, filtros salvos, gráficos). Só cabeçalho e dados.
- Histórico de mudanças: o espelho guarda só o estado atual; o histórico fica em `oportunidade_eventos`.
- Compartilhar a planilha com a liderança e criar a aba com permissões de somente leitura: configuração manual no Google, fora do código.
- Deploy na VPS e cutover (CRM ainda não está em produção).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-113 | O espelho enriquecido inclui dia e turno da cadência, tentativas e próxima ação (TDD-001 Q8) | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-114 | O espelho é uma **nova aba** ("Espelho CRM") numa planilha de leads existente, a planilha 1 (`GOOGLE_SHEET_ID_1`), que o worker já usa | confirmada | Confirmado pelo usuário em 22/10 (nova aba; planilha 1, Q-037) |
| ASM-115 | Entram todos os cards da empresa do Sheets, inclusive Contrato (Ganho) e Perdido | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-116 | Cada execução limpa e regrava a aba inteira (sem diff), e edições manuais são sobrescritas | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-117 | "Tentativas" = número de atividades de cadência do card com resultado diferente de `pendente` | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-118 | O espelho só cobre a empresa `medguia`, a única com `usa_sheets` (ver `fase3-etl-sheets`); outras empresas não são espelhadas nesta feature | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-119 | A conta de serviço já usada na ingestão tem permissão de edição na planilha 1 (hoje o escopo OAuth é `spreadsheets`, que permite escrita) | confirmada | Confirmado pelo usuário em 22/10 (ok; ainda vale testar na planilha real) |
| ASM-120 | O intervalo do espelho é configurável por `WORKER_INTERVALO_ESPELHO_MIN`, padrão 15 | confirmada | Confirmado pelo usuário em 22/10 |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-037 | Qual das três planilhas hospeda a aba "Espelho CRM"? Assumi a planilha 1; a liderança tem acesso a ela? | respondida | Planilha 1 (22/10) |
| Q-038 | Telefone e e-mail dos leads (dado pessoal, LGPD) podem ir para uma planilha que a liderança compartilha? Quem tem acesso à planilha 1? | respondida | Pode ir (22/10) |
