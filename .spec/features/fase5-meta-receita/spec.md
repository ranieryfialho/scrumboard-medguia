# Spec: Fase 5 — Meta de receita mensal (Novo MRR)

> feature: fase5-meta-receita
> status: rascunho

## Contexto

A fase 5 entregou as metas em porcentagem e deixou de fora a **meta de receita** (Q-061), porque o
relatório comercial cobre períodos diferentes. O dono do produto decidiu: **meta mensal, comparada só
quando o relatório cobre um mês inteiro**. Esta feature acrescenta a meta "Receita mensal (Novo MRR)"
em reais ao catálogo de `/configuracoes/metas` e o selo "Meta atingida" no cartão "Novo MRR contratado"
do relatório comercial quando o período é um mês; nos demais períodos o cartão mostra só o valor.

## Histórias

### US-166 — Cadastrar a meta de receita mensal

Como gerente ou master, quero cadastrar quanto a empresa quer contratar de Novo MRR por mês, para comparar com o resultado do relatório.

#### AC-687 — Campo de receita na tela de metas

- **Dado** a tela `/configuracoes/metas`
- **Quando** o gerente a abre
- **Então** há um bloco "Comercial" com a meta "Receita mensal (Novo MRR)", em reais ("R$"), ao lado das cinco metas em porcentagem; aceita valores como `50000`, `50.000` ou `50.000,50`; vazio remove a meta; valor fora do limite avisa "de R$ 0,01 a R$ 99.999.999,99, com até duas casas" e não grava; as metas em porcentagem seguem como estavam (sem "R$")

#### AC-688 — A API valida cada meta pela unidade dela

- **Dado** o `PUT /api/metas`
- **Quando** o gerente envia `receita_mensal` e metas em porcentagem
- **Então** `receita_mensal` aceita de 0,01 a 99.999.999,99 com até duas casas (50000 e 1234,56 valem; 0, negativo, texto e três casas dão 400 com o campo); as metas em porcentagem seguem aceitando só de 0,1 a 100 (5000 numa taxa dá 400); `null` remove; o atendente continua com 403 na gravação

#### AC-689 — Gravar, ler e isolar por empresa

- **Dado** uma meta de receita de R$ 50.000,00 na empresa A e R$ 80.000,00 na B, e as cinco metas em porcentagem já cadastradas
- **Quando** cada empresa lê as metas (`GET /api/metas`)
- **Então** cada uma vê só a própria receita como número, as metas em porcentagem continuam com os mesmos valores, e a tela mostra a data e quem atualizou a de receita

### US-167 — Ver a meta de receita no relatório comercial

Como gerente, quero ver se o mês bateu a meta de receita, para saber o resultado sem fazer conta.

#### AC-690 — Selo no mês inteiro

- **Dado** a meta de receita de R$ 50.000 e o período do relatório comercial igual a um mês inteiro (do dia 1 ao último dia do mesmo mês, como o filtro "Este mês")
- **Quando** o cartão "Novo MRR contratado" mostra R$ 62.000 (ou R$ 40.000)
- **Então** ele traz "Meta R$ 50.000" e, no primeiro caso, o selo "Meta atingida" (igualdade conta como atingida); no segundo mostra só a meta, sem selo

#### AC-691 — Nos outros períodos e sem meta, nada aparece

- **Dado** a meta de receita cadastrada, e o relatório em "Hoje", "Últimos 7 dias", "Últimos 30 dias" ou "Trimestre" (ou sem meta cadastrada)
- **Quando** o cartão "Novo MRR contratado" é exibido
- **Então** não aparece "Meta R$ …" nem "Meta atingida" nele; os demais cartões (Win rate com a meta de conversão) continuam como antes

#### AC-692 — O que conta como "mês inteiro"

- **Dado** pares de datas locais `YYYY-MM-DD`
- **Quando** o sistema decide se o período é um mês inteiro
- **Então** `2026-10-01` a `2026-10-31`, `2026-02-01` a `2026-02-28` (e `2028-02-01` a `2028-02-29`) são mês inteiro; `2026-10-02` a `2026-10-31`, `2026-10-01` a `2026-10-30`, `2026-10-01` a `2026-11-30`, `2026-09-15` a `2026-10-14` e datas inválidas não são

### US-168 — A migration aceita a meta em reais

Como dono do produto, quero que o banco guarde reais e continue protegendo as porcentagens.

#### AC-693 — Limites no banco, por tipo de meta

- **Dado** a tabela de metas depois da migration
- **Quando** se grava uma meta de receita e metas em porcentagem
- **Então** a receita aceita centavos de R$ 0,01 a R$ 99.999.999,99 e recusa fora disso; a porcentagem continua de 0,1 a 100 e recusa o resto; uma chave desconhecida é recusada; as metas já gravadas mantêm o valor

## Fora de escopo

- Meta de receita por trimestre, por semana ou proporcional aos dias do período (Q-061: só mês inteiro).
- Meta por responsável ou por origem; comparação com o mês anterior; alerta de meta não atingida.
- Selo da meta de receita em outras telas (só o cartão "Novo MRR contratado" do relatório comercial).
- Outras unidades (dólar, quantidade de contratos).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-252 | A meta de receita é um valor em reais por mês, chave `receita_mensal` na mesma tabela `empresa_metas`; a coluna do valor passa a `numeric(12,2)` e o limite do banco vira por chave (porcentagem de 0,1 a 100; receita de 0,01 a 99.999.999,99) | aberta | Exige a migration 0022 |
| ASM-253 | O resultado comparado é o "Novo MRR contratado" que o cartão já mostra (valor mensal dos contratos fechados no período do relatório); "atingida" = valor ≥ meta, sem arredondar antes | aberta | Mesma regra de ASM-214 |
| ASM-254 | "Mês inteiro" é do dia 1 ao último dia do mesmo mês (datas locais de São Paulo, como o filtro do relatório); o mês corrente conta, mesmo ainda em andamento: o selo aparece assim que o acumulado alcança a meta | aberta | O filtro "Este mês" já vai de 1 ao último dia |
| ASM-255 | O filtro de responsável do relatório comercial não muda a regra: com um responsável escolhido o cartão mostra o MRR dele e a meta continua sendo a da empresa; por isso o selo só aparece sem filtro de responsável | aberta | Comparar o MRR de uma pessoa com a meta da empresa enganaria |

## Perguntas em aberto

Nenhuma.
