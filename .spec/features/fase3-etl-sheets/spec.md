# Spec: Fase3 etl sheets

> feature: fase3-etl-sheets
> status: rascunho

## Contexto

No legado, os leads vindos da Meta moram em **3 planilhas do Google** (4 abas de leads mais a aba `Agenda`), e o status do atendimento também é gravado na planilha. Esta feature leva esses leads para o CRM novo como lead + card, seguindo a tabela de mapeamento do RFC-001 §6.8, e liga as mensagens de WhatsApp do legado aos leads pelo telefone. Depende da `fase3-etl-supabase` (empresas e mensagens já migradas). Todas as planilhas pertencem à empresa `medguia`.

## Histórias

### US-075 — Ler as quatro abas de leads e juntar os duplicados

Como operação, quero que os leads das planilhas entrem uma única vez cada, mesmo aparecendo em mais de uma aba, para não ter card repetido.

#### AC-273 — Cada aba é lida com as colunas dela

- **Dado** as abas `Página1` e `Página2` da planilha 1, `Página1` da planilha 2 e `Página1` da planilha 3, cada uma com nomes de coluna diferentes (`full_name`, `first name`, `full name`)
- **Quando** o ETL roda
- **Então** em todas as abas o nome, a especialidade, o telefone e o e-mail do lead são lidos da coluna certa (as mesmas regras de leitura do legado)

#### AC-274 — Lead de teste e linha em branco são ignorados e contados

- **Dado** o lead de teste da Meta (`is_organic = true`, "dummy data") e linhas sem dados, só com status
- **Quando** o ETL roda
- **Então** nada disso vira lead ou card
- **E** o relatório informa quantas linhas foram ignoradas por esse motivo

#### AC-275 — O mesmo lead em várias abas vira um só

- **Dado** um lead com o mesmo id da Meta (`l:…`) em duas abas ou planilhas
- **Quando** o ETL roda
- **Então** existe um único lead e um único card, mesmo que o horário apareça com fusos diferentes

#### AC-276 — Status diferentes para o mesmo lead: vence a alteração mais recente

- **Dado** o mesmo lead com status diferentes em duas abas
- **Quando** o ETL roda
- **Então** vale o status da aba com `data_alteracao` mais recente
- **E** sem data em nenhum lado vale o status mais avançado do funil
- **E** o conflito aparece no relatório

### US-076 — Normalizar telefones e datas

Como atendente, quero telefones e datas confiáveis, para ligar, mandar WhatsApp e ver a ordem correta dos fatos.

#### AC-277 — Telefones viram o formato internacional

- **Dado** telefones como `p:+5511981665252`, `p:43996131309` e `092-991593737`
- **Quando** o ETL roda
- **Então** os válidos ficam no formato E.164 (sem país, assume +55)
- **E** um número inválido ou incompleto deixa o lead migrar sem telefone e entra na fila de revisão

#### AC-278 — Datas ficam no instante correto

- **Dado** `created_time` com fusos `-05:00` e `-03:00` e `data_alteracao` no formato `15/09/2026, 18:06:12`
- **Quando** o ETL roda
- **Então** cada data é gravada no instante correto, e as duas leituras do mesmo instante coincidem

### US-077 — Converter o status da planilha em etapa do pipeline

Como liderança comercial, quero cada lead na etapa certa do funil novo, para a operação continuar de onde parou.

#### AC-279 — Novos leads e reuniões agendadas vão para as etapas equivalentes

- **Dado** leads com status CREATED, vazio ou "Novos Leads", e leads "Reunião agendada"
- **Quando** o ETL roda
- **Então** os primeiros ficam em "Entrada de leads" e os segundos em "Reunião agendada"

#### AC-280 — Fechado vira Contrato (Ganho) com a data de fechamento

- **Dado** leads com status "Fechado", "Logins Ativados" ou "Fechamento de Clientes"
- **Quando** o ETL roda
- **Então** os cards ficam em "Contrato (Ganho)"
- **E** a `data_fechamento` da planilha é preservada

#### AC-281 — Perdidos recebem o motivo certo

- **Dado** leads "Sem interesse", "Desqualificado" e "Arquivado"
- **Quando** o ETL roda
- **Então** todos ficam em "Perdido"
- **E** os motivos são, respectivamente, "Sem interesse", "Desqualificado (migração)" e "Legado — arquivado"

#### AC-282 — Status que exige próxima ação, sem data, vai para revisão

- **Dado** leads "Recontato" (vira "Follow de longo prazo") ou "Aguardando Ativação" (vira "Teste (Trial)") sem data de próxima ação
- **Quando** o ETL roda
- **Então** esses leads não criam card e entram na fila de revisão com o motivo

#### AC-283 — Status desconhecido nunca vira "Novo lead" em silêncio

- **Dado** um lead com status que não consta no mapa
- **Quando** o ETL roda
- **Então** ele vai para a fila de revisão manual (o legado o tratava como "Novos Leads")

### US-078 — Preservar os dados do formulário e a origem

Como comercial, quero ver de onde o lead veio e o que ele respondeu, para abordar com contexto.

#### AC-284 — Respostas do formulário e observações ficam no lead

- **Dado** um lead com especialidade, CRM, anúncio, campanha, formulário, plataforma e observações
- **Quando** o ETL roda
- **Então** todas essas informações estão no lead migrado

#### AC-285 — O card sabe de qual planilha veio

- **Dado** leads vindos de planilhas diferentes
- **Quando** o histórico do card é aberto
- **Então** a origem é "BM MedGuia" ou "BM Dr. Felipe", conforme a planilha
- **E** há um evento `migrado_de` com a planilha, a aba e o id da Meta

### US-079 — Tratar a aba Agenda

Como operação, quero poder consultar a agenda antiga, mesmo sem ela virar reunião no CRM.

#### AC-286 — A Agenda sai em CSV e nada é criado

- **Dado** a aba `Agenda` com data, título e hora
- **Quando** o ETL roda
- **Então** é gerado um arquivo CSV com todas as linhas
- **E** nenhuma reunião é criada no CRM

### US-080 — Ligar as mensagens de WhatsApp aos leads

Como atendente, quero ver a conversa antiga dentro do card do lead.

#### AC-287 — Mensagem sem lead é ligada pelo telefone

- **Dado** mensagens migradas sem lead e um único lead com o mesmo telefone
- **Quando** o ETL do Sheets roda
- **Então** as mensagens passam a pertencer a esse lead

#### AC-288 — Telefone ambíguo ou sem lead fica sem vínculo e é reportado

- **Dado** mensagens de um número que tem mais de um lead, ou nenhum
- **Quando** o ETL roda
- **Então** elas continuam sem vínculo
- **E** o relatório lista a quantidade de cada caso

### US-081 — Rodar com segurança, quantas vezes for preciso

Como responsável pelo cutover, quero ensaiar e repetir o ETL sem risco.

#### AC-289 — Rodar de novo não duplica nada

- **Dado** um ETL que já rodou com sucesso
- **Quando** ele roda de novo sobre as mesmas planilhas
- **Então** nenhum lead, card ou evento é duplicado

#### AC-290 — A simulação não grava nada

- **Dado** o ETL em modo simulação
- **Quando** ele roda
- **Então** o banco continua idêntico
- **E** o relatório diz o que seria criado, fundido, ignorado e enviado para revisão

#### AC-291 — As planilhas nunca são alteradas

- **Dado** qualquer execução, inclusive a real
- **Quando** o ETL roda
- **Então** nenhuma célula das planilhas é escrita (acesso somente leitura)

#### AC-292 — O relatório confere as contagens com as planilhas

- **Dado** uma execução concluída
- **Quando** o relatório é gerado
- **Então** por aba: linhas lidas = criadas + fundidas com duplicado + ignoradas + em revisão

#### AC-293 — Tudo fica na empresa dona das planilhas

- **Dado** planilhas configuradas na empresa `medguia`
- **Quando** o ETL roda
- **Então** todo lead, card e evento criado pertence a essa empresa

## Fora de escopo

- Supabase do CRM (feature `fase3-etl-supabase`) e Supabase da landing page.
- Criar reuniões a partir da `Agenda`.
- Escrever de volta nas planilhas ou manter o espelho no Sheets (outra feature da fase 2).
- Ensaios em staging, card de teste E2E e o cutover.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-088 | `data_alteracao` (`dd/mm/aaaa, hh:mm:ss`) está no horário de Brasília | confirmada | Confirmado pelo usuário em 19/10 |
| ASM-089 | Telefone sem código de país é brasileiro (+55) | confirmada | Confirmado pelo usuário em 19/10 |
| ASM-090 | A chave única do lead é o id da Meta (`l:…`); o id posicional do legado não serve | confirmada | Código legado usa índice de linha |
| ASM-091 | Duplicados: vence a `data_alteracao` mais recente; sem data, o status mais avançado | confirmada | Decidido em 19/10 |
| ASM-092 | A aba `Agenda` não migra; sai em CSV | confirmada | Decidido em 19/10 |
| ASM-093 | Mapa de status segue o RFC-001 §6.8 e o `STATUS_MAP` do legado ("Fechado" = Contrato (Ganho)) | confirmada | Confirmado pelo usuário em 19/10 |
| ASM-094 | O ETL acessa o Google com a conta de serviço já existente, somente leitura | confirmada | Confirmado pelo usuário em 19/10 |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-031 | As planilhas não têm data de próxima ação. Todos os "Recontato" e "Aguardando Ativação" vão para revisão, ou usa-se uma data padrão (ex.: `data_alteracao` + 30 dias)? | respondida | Todos vão para revisão; nenhuma data é inventada (decidido em 19/10) |
| Q-032 | Qual o volume por aba (linhas)? Define o tempo do ensaio e o tamanho esperado da fila de revisão | respondida | Desconhecido; o volume sai do relatório da simulação (dry-run, AC-290/AC-292) (19/10) |
