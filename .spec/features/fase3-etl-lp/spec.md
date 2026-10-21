# Spec: Fase3 etl lp

> feature: fase3-etl-lp
> status: rascunho

## Contexto

A landing page da aula (projeto Supabase separado, que **continua no ar** — D-S8 do TDD-001) grava os cadastros na tabela `leads` dela, e o legado lê essa tabela na mesma rota do Sheets (`src/app/api/sheets/route.ts`, ids `lp-…`, origem "LP - Aula"). Esta feature é a terceira origem do ETL da fase 3: leva esses cadastros para o CRM novo como lead + card, com o mesmo contrato das features `fase3-etl-supabase` e `fase3-etl-sheets` (idempotência por `migracao_registros`, simulação, transação única, relatório que fecha a conta). Roda depois das outras duas, porque precisa enxergar os leads que elas já criaram para não duplicar a mesma pessoa.

## Histórias

### US-082 — Migrar os cadastros da landing page como cards do pipeline

Como operação, quero que cada cadastro da landing page apareça como card no funil novo, para continuar o atendimento sem refazer o cadastro.

#### AC-294 — Cadastro da LP vira lead e card na etapa equivalente

- **Dado** cadastros da LP com status "Novos Leads" (ou sem status)
- **Quando** o ETL roda
- **Então** cada um vira um lead e um card em "Entrada de leads", na empresa `medguia`
- **E** nome, e-mail, observações e data de cadastro estão preservados, e a origem do lead é "LP - Aula"

#### AC-295 — O status da LP segue o mesmo mapa do Sheets

- **Dado** cadastros da LP com os status do legado ("Fechado", "Reunião Agendada", "Sem interesse", "Recontato", um status desconhecido…)
- **Quando** o ETL roda
- **Então** cada um vai para a mesma etapa (e o mesmo motivo de perda) que teria vindo do Sheets
- **E** "Recontato" e "Aguardando Ativação" sem data de próxima ação, e status desconhecido, não criam card e entram na fila de revisão com o motivo

#### AC-296 — Telefone válido fica no formato internacional

- **Dado** cadastros com WhatsApp como `(85) 99999-9999`, com e sem código de país, e um número inválido
- **Quando** o ETL roda
- **Então** os válidos ficam em E.164 (sem país, assume +55)
- **E** o inválido deixa o lead migrar sem telefone e o relatório o aponta para revisão

#### AC-297 — Cada card migrado guarda de onde veio

- **Dado** um cadastro da LP migrado
- **Quando** o histórico do card é aberto
- **Então** há um evento `migrado_de` com a origem "supabase-lp" e o id do cadastro na LP
- **E** o registro de migração liga o id da LP ao id novo

### US-083 — Preservar o que a landing page sabe sobre o médico

Como comercial, quero ver CRM, especialidade, anúncio, aceite dos termos e quanto da aula o médico assistiu, para abordar com contexto.

#### AC-298 — Dados do cadastro ficam no lead

- **Dado** um cadastro com CRM, especialidade, anúncio, aceite dos termos, progresso do vídeo, data de alteração e data de fechamento
- **Quando** o ETL roda
- **Então** todas essas informações estão nos dados do lead migrado, com as datas no instante correto

#### AC-299 — A senha da LP nunca sai da LP

- **Dado** cadastros da LP com `password_hash` preenchido
- **Quando** o ETL roda, inclusive em simulação
- **Então** o hash não é lido da origem, não é gravado no lead nem no evento, e não aparece no relatório nem no log

### US-084 — Não criar a mesma pessoa duas vezes

Como operação, quero que um médico que já veio do Sheets ou do CRM antigo não ganhe um segundo card pela LP, para não abordar a mesma pessoa duas vezes.

#### AC-300 — Pessoa que já existe vai para revisão, sem criar nem mesclar

- **Dado** um cadastro da LP cujo e-mail (sem diferenciar maiúsculas) ou telefone E.164 já pertence a um lead da empresa `medguia`
- **Quando** o ETL roda
- **Então** nenhum lead nem card é criado e o lead existente não é alterado
- **E** o cadastro aparece na fila de revisão com o motivo e o id do lead existente

#### AC-301 — A decisão da operação resolve o item da revisão

- **Dado** um cadastro na fila de revisão e um arquivo de decisões em que a operação escolheu a etapa dele (ou escolheu ignorá-lo)
- **Quando** o ETL roda de novo
- **Então** o lead e o card são criados na etapa escolhida (ou o cadastro fica registrado como ignorado, sem criar nada)
- **E** o cadastro sai da fila e uma terceira execução não duplica nada

### US-085 — Rodar o ETL da LP com segurança, quantas vezes for preciso

Como responsável pelo cutover, quero ensaiar e repetir o ETL da LP sem risco, para chegar à virada com contagens batendo.

#### AC-302 — Rodar de novo não duplica nada

- **Dado** um ETL da LP que já rodou com sucesso
- **Quando** ele roda uma segunda vez sobre os mesmos cadastros
- **Então** nenhuma linha nova é criada e nenhuma existente é duplicada

#### AC-303 — A simulação não grava nada

- **Dado** o ETL da LP em modo simulação (dry-run)
- **Quando** ele roda
- **Então** o banco de destino continua idêntico
- **E** o relatório diz o que seria criado, ignorado e enviado para revisão

#### AC-304 — O relatório confere a contagem com a LP

- **Dado** uma execução concluída
- **Quando** o relatório é gerado
- **Então** ele mostra lidas, criadas, ignoradas e em revisão
- **E** a conta fecha: lidas = criadas + ignoradas + em revisão, e lidas é igual ao total de linhas da tabela na LP

#### AC-305 — Falha no meio não deixa migração pela metade

- **Dado** uma execução que falha na metade
- **Quando** o erro acontece
- **Então** nada do que foi gravado nessa execução permanece no destino

#### AC-306 — A LP nunca é alterada

- **Dado** o ETL da LP lendo a origem
- **Quando** ele roda, com ou sem simulação
- **Então** nenhuma escrita é feita no Supabase da LP (o leitor só faz consultas de leitura)
- **E** a chave de acesso nunca aparece no relatório nem no log

## Fora de escopo

- Ingestão contínua dos cadastros novos da LP depois da virada (feature seguinte, com o worker).
- Corrigir a exposição de `password_hash` pela chave anônima na própria LP (outro sistema; achado registrado em Q-033).
- Mesclar automaticamente a pessoa da LP com o lead existente (decidido: vai para revisão).
- Fila de decisões para os itens de revisão do ETL do Sheets (lacuna daquela feature, registrada em Q-034).
- Ensaios em staging, card de teste E2E e o cutover.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-095 | O ETL lê a LP com uma chave de serviço própria (`SUPABASE_LP_SERVICE_KEY`), só em variável de ambiente e só com consultas de leitura, para que o RLS não esconda linhas (a chave anônima enxerga 1 linha) | confirmada | Decidido pelo usuário em 21/10 |
| ASM-096 | Pessoa já existente (mesmo e-mail ou telefone) vai para revisão manual; nada é criado nem mesclado | confirmada | Decidido pelo usuário em 21/10 |
| ASM-097 | Migram também CRM, especialidade, anúncio, aceite dos termos e progresso do vídeo | confirmada | Decidido pelo usuário em 21/10 |
| ASM-098 | Os status da LP usam o mesmo mapa do ETL do Sheets, inclusive a regra de revisão sem data de próxima ação (Q-031) | confirmada | Decidido pelo usuário em 21/10 |
| ASM-099 | Todos os cadastros da LP pertencem à empresa `medguia` (o legado os mostra só no board dela) | confirmada | Rota legada lê a LP só no fluxo da MedGuia (`src/app/api/sheets/route.ts`) |
| ASM-100 | O ETL da LP roda depois do ETL do Supabase do CRM e do Sheets, para enxergar os leads já criados (AC-300) | confirmada | Ordem do runbook do cutover |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-033 | A chave anônima da LP (pública no site) consegue ler `password_hash` da tabela `leads`. Quem corrige o RLS da LP? | respondida | Fora do escopo do CRM; achado reportado ao usuário em 21/10 para correção na LP |
| Q-034 | O ETL do Sheets manda "Recontato"/"Aguardando Ativação" para revisão mas não aceita arquivo de decisões como o do Supabase (AC-272). Como esses leads chegam ao CRM no cutover? | respondida | Fora desta feature; registrado para tratar antes do cutover (21/10) |
