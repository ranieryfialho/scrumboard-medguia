# Spec: Fase 5 — Metas cadastradas pela gestão

> feature: fase5-metas
> status: rascunho

## Contexto

Na fase 4 os indicadores do CRM foram para a tela sem nenhuma meta, porque ela não existia no
sistema (Q-051, Q-053, Q-056, Q-058). O dono do produto decidiu que a **gestão cadastra as
metas** numa tela própria (`/configuracoes/metas`) e que os indicadores passam a mostrar
"Meta N%" e "Meta atingida". Esta feature entrega a tabela de metas por empresa, a tela de
cadastro, a leitura para as telas e o selo nos cinco indicadores em porcentagem que já existem
(taxa de conversão, taxa de presença, win rate e as taxas de entrega, abertura e cliques do
e-mail). Os "Configurar Metas" que estavam "em breve" passam a levar para a tela.

## Histórias

### US-144 — Cadastrar as metas da empresa

Como gerente ou master, quero cadastrar a meta de cada indicador da minha empresa, para que a
equipe veja se está acima ou abaixo do esperado.

#### AC-615 — Tela de metas com as cinco metas e o valor de cada uma

- **Dado** que um gerente da empresa A cadastrou meta de taxa de conversão de 25% e nada mais
- **Quando** ele abre `/configuracoes/metas`
- **Então** vê as cinco metas (Taxa de conversão, Taxa de presença, Taxa de entrega de e-mail, Taxa de abertura de e-mail e Taxa de cliques de e-mail), agrupadas por área (Pipeline, Agenda, E-mail), a de conversão com "25%" e as outras quatro com "Sem meta"

#### AC-616 — Salvar uma meta

- **Dado** que o gerente digitou 80 na taxa de presença
- **Quando** salva
- **Então** a meta fica gravada para a empresa (aceita de 0,1 a 100, com até uma casa decimal), a tela mostra "Meta salva" e, junto da meta, quem atualizou e quando

#### AC-617 — Valor inválido não é gravado

- **Dado** que o gerente digitou 0, 101, -5 ou um texto numa meta
- **Quando** salva
- **Então** a tela avisa que a meta deve ser um número de 0,1 a 100 e nada é gravado (a API responde 400 com o campo)

#### AC-618 — Remover uma meta

- **Dado** que existe meta de taxa de cliques de 3%
- **Quando** o gerente limpa o campo e salva
- **Então** a meta deixa de existir e a tela volta a mostrar "Sem meta" para ela

#### AC-619 — Metas são separadas por empresa

- **Dado** que a empresa A tem meta de conversão de 25% e a empresa B tem 40%
- **Quando** um usuário de cada empresa lê as metas
- **Então** cada um vê só a da própria empresa (isolamento por empresa no banco)

#### AC-620 — Quem pode cadastrar e quem pode ver

- **Dado** que existem um atendente, um gerente e um master
- **Quando** o atendente tenta gravar uma meta ou abrir `/configuracoes/metas`
- **Então** não consegue (a API responde 403 e a página é barrada como as demais telas de gestão), enquanto gerente e master gravam; os três conseguem **ler** as metas (a leitura alimenta os selos dos indicadores)

### US-145 — Ver nos indicadores se a meta foi atingida

Como usuário do CRM, quero ver a meta ao lado do indicador e saber se foi atingida, para
entender se o resultado está bom sem fazer conta.

#### AC-621 — Taxa de conversão do pipeline

- **Dado** que a meta de conversão é 25%
- **Quando** o indicador "Taxa de Conversão" do pipeline mostra 30,0% (ou 20,0%)
- **Então** a legenda traz "Meta 25%" e, no primeiro caso, o selo "Meta atingida" (no segundo não aparece selo)

#### AC-622 — Taxa de presença da agenda

- **Dado** que a meta de presença é 80%
- **Quando** o indicador "Taxa de presença" mostra 85% (ou 70%)
- **Então** mostra "Meta 80%" e, no primeiro caso, "Meta atingida"

#### AC-623 — Win rate do relatório comercial

- **Dado** que a meta de conversão é 25%
- **Quando** o relatório comercial mostra Win rate de 25,0% no período
- **Então** mostra "Meta 25%" e "Meta atingida" (igualdade conta como atingida); a meta é a mesma "taxa de conversão" do pipeline (ASM-212)

#### AC-624 — Taxas do e-mail na campanha

- **Dado** que as metas de entrega, abertura e cliques estão cadastradas
- **Quando** o usuário abre o detalhe de uma campanha
- **Então** cada um dos três cartões mostra a sua "Meta N%" e, se o valor alcançou, "Meta atingida"

#### AC-625 — Sem meta ou sem valor, nada aparece

- **Dado** que a meta não foi cadastrada, ou que o indicador está sem base (traço "—")
- **Quando** o indicador é exibido
- **Então** não aparece "Meta N%" nem "Meta atingida" para ele (sem meta não há o que comparar; sem valor não há resultado)

### US-146 — Chegar na tela de metas

Como gerente, quero achar a tela de metas no menu e nos relatórios, para configurar sem procurar.

#### AC-626 — Menu e atalhos

- **Dado** que o gerente está logado
- **Quando** olha o menu e os relatórios Indicadores do funil e Comercial
- **Então** o menu da Administração tem "Metas" (só gerente e master; atendente não vê) e os botões "Configurar Metas" e "Configurar Metas de Vendas", antes "em breve", levam a `/configuracoes/metas`

## Fora de escopo

- **Meta de receita** (Novo MRR): depende do período do relatório (mês, trimestre); fica para depois (Q-061).
- **Tempo da 1ª resposta e taxa de resposta do WhatsApp**: continuam sem indicador (sem fonte de dado).
- **Metas por usuário ou por período**, histórico de alterações e alertas ao não atingir.
- Os cartões de "Conversão Final" do relatório de funil (por pilar) não ganham selo nesta entrega.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-211 | Metas são por empresa, chave fixa de um catálogo de cinco (`taxa_conversao`, `taxa_presenca`, `taxa_entrega_email`, `taxa_abertura_email`, `taxa_cliques_email`), todas em porcentagem onde "mais é melhor"; uma tabela `empresa_metas` (empresa, chave, valor, quem e quando atualizou) com chave única por empresa e RLS por tenant | aberta | Exige a migration 0015 |
| ASM-212 | O "win rate" do relatório comercial e a "taxa de conversão" do pipeline usam a mesma fórmula (ganhos ÷ (ganhos + perdas)) e por isso compartilham a meta `taxa_conversao` | aberta | Evita duas metas iguais |
| ASM-213 | Gerente, master e super admin cadastram metas; atendente só lê | aberta | Segue a regra de telas de gestão (ASM-123) |
| ASM-214 | "Atingida" = valor do indicador maior ou igual à meta, comparando o valor exato (sem arredondar antes) | aberta | — |
| ASM-215 | A leitura das metas é uma rota separada (`GET /api/metas`) acessível a qualquer sessão, e cada tela busca ao carregar; se a leitura falhar, o indicador aparece sem selo | aberta | Meta é enfeite do indicador, não pode derrubar a tela |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-061 | Como tratar a meta de receita (Novo MRR): meta mensal comparada só quando o relatório cobre um mês, ou meta por trimestre? Fica fora desta entrega | aberta | — |
