# Spec: Fase3 etl decisoes

> feature: fase3-etl-decisoes
> status: rascunho

## Contexto

Os três ETLs da fase 3 (Supabase do CRM, Sheets, LP) mandam para uma fila de revisão manual os leads que não têm etapa automática — sobretudo "Recontato" (vira "Follow de longo prazo") e "Aguardando Ativação" (vira "Teste (Trial)"). Hoje o ETL do Sheets não tem como receber a decisão da operação, e os do Supabase e da LP só aceitam o número da etapa: como o banco exige `proxima_acao_em` futura nas etapas 7, 11, 12 e 13, valor na 11 e motivo de perda na 14 (`drizzle/0002_constraints.sql`), decidir "Follow de longo prazo" derruba a transação inteira. Sem esta feature, esses leads não chegam ao CRM no cutover. A operação (Alana/Karol) preenche as decisões numa planilha gerada pelo próprio ETL, e o mesmo formato e as mesmas regras valem para as três origens.

## Histórias

### US-086 — Receber a fila de revisão numa planilha para preencher

Como operação, quero receber a fila de revisão como planilha com colunas para a minha decisão, para decidir cada lead sem depender de um desenvolvedor.

#### AC-307 — A simulação gera a planilha da fila de revisão

- **Dado** um ETL (Sheets, Supabase ou LP) com leads na fila de revisão
- **Quando** ele roda em simulação com `--fila-revisao <arquivo.csv>`
- **Então** o arquivo tem uma linha por lead da fila, com id de origem, nome, telefone, e-mail, status original e motivo da revisão
- **E** traz as colunas em branco `etapa`, `proxima_acao`, `valor`, `motivo_perda` e `ignorar` para a operação preencher

#### AC-308 — A planilha abre certa no Excel e no Google Sheets

- **Dado** leads com acento, vírgula, ponto e vírgula e aspas no nome ou nas observações
- **Quando** a planilha da fila é gerada e lida de volta
- **Então** nenhum texto se quebra em colunas erradas e os acentos aparecem corretos (UTF-8 com BOM, separador `;`)

### US-087 — A decisão da operação tira o lead do Sheets da revisão

Como operação, quero que o ETL do Sheets aplique o que eu decidi, para que os leads "Recontato" e "Aguardando Ativação" cheguem ao CRM no cutover.

#### AC-309 — Decisão de etapa cria o lead e o card do Sheets

- **Dado** um lead do Sheets na fila de revisão e uma planilha de decisões com a etapa dele (por nome, ex.: "Reunião agendada", ou pelo número)
- **Quando** o ETL do Sheets roda com `--decisoes <arquivo.csv>`
- **Então** o lead e o card são criados nessa etapa, com a mesma origem comercial, dados do formulário e evento `migrado_de` de um lead migrado automaticamente
- **E** o lead sai da fila, e uma terceira execução não duplica nada

#### AC-310 — Recontato decidido como Follow de longo prazo ganha a próxima ação

- **Dado** um lead "Recontato" decidido como "Follow de longo prazo" com `proxima_acao` `10/11/2026 14:00` (futura)
- **Quando** o ETL roda
- **Então** o card fica em "Follow de longo prazo" com a próxima ação nesse instante, no horário de Brasília

#### AC-311 — Ignorar tira o lead da fila sem criar nada

- **Dado** um lead na fila com `ignorar` marcado (`sim`)
- **Quando** o ETL roda
- **Então** nenhum lead nem card é criado, o lead fica registrado como ignorado e não volta para a fila nas execuções seguintes

### US-088 — Uma decisão errada nunca derruba o ETL

Como responsável pelo cutover, quero que uma linha mal preenchida apenas volte para a revisão, para que o ETL da virada não pare por causa de um erro de digitação.

#### AC-312 — Etapa sem o dado que ela exige volta para a revisão

- **Dado** decisões para "Follow de longo prazo", "Teste (Trial)" ou "Negociação" sem próxima ação, para "Proposta" sem valor, e para "Perdido" sem motivo de perda
- **Quando** o ETL roda
- **Então** nenhum desses leads é criado, cada um volta para a fila com o motivo do que faltou
- **E** os demais leads da execução são migrados normalmente

#### AC-313 — Próxima ação que já passou volta para a revisão

- **Dado** uma decisão preenchida num ensaio com `proxima_acao` anterior ao momento da execução
- **Quando** o ETL roda
- **Então** o lead não é criado e volta para a fila com o motivo "data de próxima ação já passou"

#### AC-314 — Valor mal formatado, etapa ou motivo desconhecidos voltam para a revisão

- **Dado** decisões com etapa inexistente, motivo de perda que não existe, data ou valor que não dá para ler, ou etapa e `ignorar` ao mesmo tempo
- **Quando** o ETL roda
- **Então** cada uma volta para a fila com o motivo
- **E** uma linha de decisão para um id que não está na fila é listada no relatório e não cria nada

### US-089 — Mesmo formato e mesmas regras nas três origens

Como operação, quero preencher as decisões do Supabase, do Sheets e da LP do mesmo jeito, para não aprender três formatos.

#### AC-315 — O ETL do Supabase aceita a planilha de decisões completa

- **Dado** um lead do Supabase em revisão decidido como "Follow de longo prazo" com próxima ação futura
- **Quando** o ETL do Supabase roda com `--decisoes <arquivo.csv>`
- **Então** o card é criado nessa etapa com a próxima ação, em vez de derrubar a transação

#### AC-316 — O ETL da LP aceita a planilha de decisões completa

- **Dado** um cadastro da LP em revisão decidido como "Teste (Trial)" com próxima ação futura, e outro marcado para ignorar
- **Quando** o ETL da LP roda com `--decisoes <arquivo.csv>`
- **Então** o primeiro vira card em "Teste (Trial)" com a próxima ação, e o segundo é ignorado sem criar nada

#### AC-317 — O relatório mostra as decisões aplicadas e recusadas, e a conta fecha

- **Dado** uma execução com decisões aplicadas, ignoradas e recusadas
- **Quando** o relatório é gerado
- **Então** ele mostra quantas decisões foram aplicadas, ignoradas e recusadas (com o motivo de cada recusa)
- **E** a conta continua fechando: lidas = criadas + ignoradas + em revisão

## Fora de escopo

- Tela no CRM para revisar a fila (a revisão é feita na planilha, fora do sistema).
- Escrever as decisões de volta no Google Sheets de origem (o ETL nunca escreve nas planilhas, AC-291).
- Ajustar automaticamente datas vencidas (decidido: volta para a revisão).
- Mesclar a pessoa duplicada da LP com o lead existente (continua sendo "ignorar" ou criar).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-101 | Um validador e um leitor/gerador de planilha comuns servem os três ETLs (Supabase, Sheets, LP) | confirmada | Decidido pelo usuário em 21/10 |
| ASM-102 | A operação preenche um CSV gerado pela simulação do ETL e o devolve com `--decisoes` | confirmada | Decidido pelo usuário em 21/10 |
| ASM-103 | Próxima ação vencida no momento da execução devolve o lead para a revisão, sem abortar | confirmada | Decidido pelo usuário em 21/10 |
| ASM-104 | A operação pode marcar `ignorar`; o lead fica registrado e sai da fila de vez | confirmada | Decidido pelo usuário em 21/10 |
| ASM-105 | O CSV substitui os arquivos JSON de decisões do Supabase e da LP (ainda não usados em ensaio nem em produção) | confirmada | Decidido pelo usuário em 21/10 |
| ASM-106 | `proxima_acao` é lida como `dd/mm/aaaa hh:mm` (ou só `dd/mm/aaaa`, às 09:00) no horário de Brasília; `valor` aceita `1.234,56` | confirmada | Confirmado pelo usuário em 21/10 |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-035 | Uma decisão para "Proposta" (exige valor) ou "Contrato (Ganho)" faz sentido num lead que estava em "Recontato"? Ou a planilha deve limitar as etapas permitidas? | respondida | Qualquer etapa; o validador só exige o que cada etapa pede (21/10) |
