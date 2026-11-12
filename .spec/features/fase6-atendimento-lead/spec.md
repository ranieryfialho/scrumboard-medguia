# Spec: Fase 6 — Velocidade do 1º contato (corrido e em horário comercial)

> feature: fase6-atendimento-lead
> status: rascunho

## Contexto

O relatório de marketing mostra "Velocidade média do 1º contato": do instante em que o lead entra até a primeira mensagem de WhatsApp enviada a ele pelo CRM. Hoje é uma média simples em **relógio corrido**, sem o tamanho da amostra, com cor verde fixa. Com poucos leads, e com noites e fins de semana contando como espera, o número engana (ex.: 1.181 min com 7 leads). Esta feature mostra **os dois**: o tempo em relógio corrido e o tempo em **horário comercial** (só o expediente conta), sempre com média, mediana e quantos leads entraram na conta, sobre o período escolhido. O expediente é **configurável por empresa**.

## Histórias

### US-191 — Ver o 1º contato em relógio corrido e em horário comercial

Como gestor, quero ver quanto a equipe demora a falar com um lead novo, contando o relógio corrido e só o horário comercial, para separar "demora de verdade" de "o lead chegou à noite ou no fim de semana".

#### AC-804 — Dois indicadores com média, mediana e quantidade de leads

- **Dado** leads do período com 1ª mensagem de WhatsApp enviada pelo CRM
- **Quando** a pessoa abre o relatório de marketing
- **Então** o cartão de velocidade mostra, para "Relógio corrido" e para "Horário comercial", a média e a mediana em minutos (ou horas quando passar de 120 min) e o texto "N leads", onde N é a quantidade de leads que entraram na conta; sem nenhum lead com mensagem enviada, mostra "Sem contatos"

#### AC-805 — Em horário comercial só o expediente conta

- **Dado** o expediente padrão (segunda a sexta, 9h às 18h, fuso de São Paulo) e um lead que entrou na sexta às 17h30 e recebeu a 1ª mensagem na segunda às 9h30
- **Quando** o tempo em horário comercial é calculado
- **Então** o resultado é 60 minutos (30 na sexta + 30 na segunda); o mesmo lead tem 64 h em relógio corrido; um lead que entrou no domingo às 00h10 e recebeu a mensagem na segunda às 16h47 tem 467 min em horário comercial; um lead que entrou e foi atendido dentro do mesmo expediente tem a diferença exata

#### AC-806 — Faixas de espera

- **Dado** os leads do período com 1ª mensagem enviada
- **Quando** a pessoa olha o cartão de velocidade
- **Então** vê quantos leads (e a porcentagem) foram atendidos em até 1 h, até 4 h, até 24 h e em mais de 24 h, para os dois modos (relógio corrido e horário comercial), e a soma das faixas é igual a N

#### AC-807 — O cartão acompanha o período escolhido e não é verde fixo

- **Dado** o filtro de período da tela (pronto ou personalizado)
- **Quando** o período muda
- **Então** o cartão é recalculado só com os leads que entraram no período; a cor do cartão é neutra (não indica "bom" sozinha), e o rótulo explica "da entrada do lead até a 1ª mensagem enviada pelo CRM"

#### AC-808 — Só conta a 1ª mensagem enviada depois da entrada, e leads migrados entram

- **Dado** um lead com mensagens enviadas antes da data de entrada e outras depois, e um lead migrado das planilhas
- **Quando** o indicador é calculado
- **Então** só a primeira mensagem enviada em ou depois da entrada conta; lead sem nenhuma mensagem enviada fica fora do cálculo (mas não da contagem de leads do relatório); o lead migrado entra normalmente, com a data de entrada real

### US-192 — Configurar o horário comercial da empresa

Como gerente, quero informar os dias e horários de atendimento da minha empresa, para que o indicador em horário comercial reflita o expediente real.

#### AC-809 — Tela de configuração do horário de atendimento

- **Dado** um gerente (ou master, ou super admin atuando na empresa) em Configurações
- **Quando** ele abre "Horário de atendimento"
- **Então** vê os sete dias da semana, cada um com o interruptor "Atende" e os horários de abertura e fechamento; sem configuração salva, a tela mostra o padrão (segunda a sexta, 09:00 às 18:00); ao salvar, os valores ficam gravados para a empresa

#### AC-810 — Só gerente em diante grava

- **Dado** um atendente e um gerente da mesma empresa
- **Quando** cada um tenta gravar o horário (`PUT /api/configuracoes/horario-atendimento`)
- **Então** o atendente recebe 403 e nada muda; o gerente grava (200); qualquer papel logado lê (`GET`), e a empresa B nunca vê nem altera o horário da empresa A

#### AC-811 — Horário inválido é recusado

- **Dado** o gerente editando o horário
- **Quando** o fechamento não é depois da abertura, o formato não é `HH:MM`, ou nenhum dia está marcado como "Atende"
- **Então** o servidor recusa (400 `HORARIO_INVALIDO`) com o motivo, a tela mostra a mensagem, e o horário que valia continua valendo

#### AC-812 — O novo horário passa a valer no indicador

- **Dado** o expediente alterado para segunda a sábado, 08:00 às 20:00
- **Quando** o relatório de marketing é aberto de novo
- **Então** o cálculo em horário comercial usa o novo expediente (um lead que entrou sábado às 10h e recebeu a mensagem às 11h tem 60 min em horário comercial, o que no padrão antigo daria 0 min contando só a partir de segunda)

## Fora de escopo

- Feriados, pausas de almoço e horários diferentes por pessoa ou por responsável.
- Mudar a regra de "1ª mensagem enviada" (continua só WhatsApp enviado pelo CRM) ou contar ligação e outros canais.
- Distribuição por dia da semana e por hora de entrada (pode vir depois).
- Alertas ou metas de atendimento (SLA).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-303 | O horário fica em `empresa_configuracoes` (chave `horario_atendimento`, valor JSON com os sete dias); sem registro vale o padrão seg–sex 09:00–18:00; não é preciso tabela nem migration nova | aberta | Reaproveita a tabela de configurações por empresa |
| ASM-304 | O cálculo em horário comercial roda no servidor (a consulta traz entrada e 1ª mensagem; um módulo puro soma os minutos dentro do expediente); média, mediana e faixas saem desse módulo | aberta | O Postgres não ajuda com expediente semanal configurável; o volume é de dezenas a centenas de leads por consulta |
| ASM-305 | A mediana é a do conjunto de tempos calculados (a média continua sendo a média simples dos mesmos tempos) | aberta | A mediana protege contra poucos casos muito longos |
| ASM-306 | O período filtra pela data de entrada do lead (`leads.criado_em`, já com a data real da planilha), como já faz o resto do relatório de marketing | aberta | Usa o mesmo `noPeriodo` do repositório |
| ASM-307 | O tempo em horário comercial desconta feriados? Não: feriado conta como dia útil se for um dia marcado como "Atende" | aberta | Fora de escopo nesta feature |

## Perguntas em aberto

Nenhuma.
