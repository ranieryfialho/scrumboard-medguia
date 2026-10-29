# Spec: Fase 5 — Investimento em mídia (cadastro manual por canal e mês)

> feature: fase5-investimento-midia
> status: rascunho

## Contexto

O relatório de marketing mostra de onde vêm os leads, mas não o quanto custou trazê-los: o CRM não
tinha o investimento em mídia (Q-057). O dono do produto decidiu que a gestão **cadastra o
investimento à mão, por canal (origem do lead) e por mês** — a integração automática com o Meta
Ads fica para uma versão 2. Esta feature entrega a tabela de investimento, a tela de cadastro
(`/configuracoes/investimento`) e os números que dependem dele no relatório de marketing:
investimento total, custo por lead (CPL), custo de aquisição de cliente (CAC) e retorno sobre o
investimento (ROAS).

## Histórias

### US-147 — Cadastrar o investimento em mídia por canal e mês

Como gerente ou master, quero informar quanto investi em cada canal em cada mês, para que o
relatório mostre o custo de trazer leads e clientes.

#### AC-627 — Tela do mês com os canais

- **Dado** que a empresa tem leads com as origens "Meta Ads" e "Indicação" e que "Google Ads" já tem investimento em outubro de 2026
- **Quando** o gerente abre `/configuracoes/investimento` em outubro de 2026
- **Então** vê o mês (o atual por padrão, com botões para o mês anterior e o próximo), uma linha por canal (as origens dos leads mais os canais já cadastrados no mês), o valor em reais de cada um ou "Sem investimento", e o total do mês

#### AC-628 — Salvar o investimento

- **Dado** que o gerente digitou 4.500,00 em "Meta Ads" no mês aberto
- **Quando** salva
- **Então** o valor fica gravado para a empresa, o mês e o canal, a tela mostra "Investimento salvo" e o total do mês é atualizado

#### AC-629 — Valor inválido não é gravado

- **Dado** que o gerente digitou 0, um valor negativo, um texto ou um valor acima de 9.999.999,99
- **Quando** salva
- **Então** a tela avisa que o investimento deve ser um valor em reais de R$ 0,01 a R$ 9.999.999,99, com até duas casas, e nada é gravado (a API responde 400 com o canal)

#### AC-630 — Remover o investimento de um canal

- **Dado** que "Meta Ads" tem R$ 4.500,00 no mês
- **Quando** o gerente limpa o campo e salva
- **Então** o investimento daquele canal naquele mês deixa de existir e a linha volta a "Sem investimento"

#### AC-631 — Adicionar um canal que ainda não tem lead

- **Dado** que o gerente quer registrar "TikTok Ads", que não é origem de nenhum lead
- **Quando** digita o nome (de 2 a 60 caracteres), adiciona e salva um valor
- **Então** o canal aparece na lista do mês com o valor; digitar um nome que só difere por maiúsculas ou espaços de um canal existente ("meta ads ") usa o canal existente e não cria um segundo

#### AC-632 — Investimento é separado por empresa

- **Dado** que a empresa A investiu R$ 1.000,00 e a empresa B R$ 9.000,00 no mesmo canal e mês
- **Quando** o gerente de cada uma abre a tela
- **Então** cada um vê só o da própria empresa (isolamento por empresa no banco)

#### AC-633 — Quem pode ver e cadastrar

- **Dado** que existem um atendente, um gerente e um master
- **Quando** o atendente tenta ler ou gravar investimento ou abrir a tela
- **Então** é barrado (a API responde 403 e a página é barrada como as demais telas de gestão), enquanto gerente e master leem e gravam

### US-148 — Ver o custo no relatório de marketing

Como gerente, quero ver investimento, CPL, CAC e ROAS no relatório de marketing, para saber quais canais compensam.

#### AC-634 — Cartões de investimento, CPL, CAC e ROAS

- **Dado** que há R$ 4.500,00 de investimento no período, 90 leads, 9 contratos e R$ 27.000,00 de valor ganho
- **Quando** o gerente abre o relatório de marketing
- **Então** vê os cartões "Investimento" (R$ 4.500), "Custo por lead" (R$ 50), "CAC" (R$ 500) e "ROAS" (6,0x), calculados sobre os leads criados no período

#### AC-635 — Período que não cobre o mês inteiro

- **Dado** que outubro tem R$ 3.100,00 de investimento e o período do relatório são os dias 1 a 10 de outubro
- **Quando** o relatório calcula o investimento do período
- **Então** usa a parte proporcional dos dias do mês dentro do período (10 de 31 dias: R$ 1.000,00); períodos que cruzam meses somam a parte de cada mês

#### AC-636 — Colunas por origem

- **Dado** que "Meta Ads" tem investimento e leads e que "TikTok Ads" tem investimento mas nenhum lead no período
- **Quando** o relatório mostra o desempenho por origem
- **Então** a tabela ganha as colunas Investimento, CPL, CAC e ROAS; "TikTok Ads" aparece com 0 leads, traço no CPL e no CAC e ROAS de 0,0x (nada ganho sobre o que foi investido); o total consolidado traz o investimento somado

#### AC-637 — Sem investimento, nada aparece

- **Dado** que a empresa não cadastrou investimento no período
- **Quando** o relatório de marketing é aberto
- **Então** não aparecem os cartões nem as colunas de custo (sem dado, sem bloco), e há o atalho "Cadastrar investimento" que leva à tela

#### AC-638 — Divisão por zero vira traço

- **Dado** que há investimento no período mas nenhum contrato (ou nenhum lead)
- **Quando** o relatório calcula CAC, CPL ou ROAS
- **Então** mostra "—" no lugar, nunca zero, infinito ou erro

### US-149 — Chegar na tela de investimento

Como gerente, quero achar a tela no menu, para cadastrar sem procurar.

#### AC-639 — Menu e rota

- **Dado** que o gerente ou master está logado
- **Quando** olha o menu da Administração
- **Então** vê "Investimento em Mídia" apontando para uma página que existe; o atendente não vê o item

## Fora de escopo

- **Integração automática com o Meta Ads ou outras plataformas**: versão 2 (decisão do dono do produto).
- **LTV/CAC, payback, CPM, cliques, visitas, UTM e campanhas de anúncio**: dependem de dados que o CRM não tem.
- **Investimento por campanha, por dia ou por especialidade**, histórico de alterações e importação por planilha.
- Moeda diferente de real.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-216 | Canal = a origem do lead (`leads.origem`), em texto livre; a ligação entre investimento e leads compara o texto sem diferenciar maiúsculas nem espaços nas pontas; leads sem origem não têm canal e ficam fora do investimento | aberta | Não existe cadastro de canais; a origem é texto livre |
| ASM-217 | O investimento é um valor por empresa, mês (primeiro dia, fuso de São Paulo) e canal, em reais com duas casas, de 0,01 a 9.999.999,99; tabela `investimento_midia` com RLS por tenant e chave única (empresa, mês, canal sem diferenciar maiúsculas) | aberta | Exige a migration 0016 |
| ASM-218 | Investimento do período = soma, por mês coberto, do valor × (dias do mês dentro do período ÷ dias do mês) | aberta | Rateio linear; o dono do produto pode preferir outro critério |
| ASM-219 | CPL = investimento ÷ leads criados no período; CAC = investimento ÷ contratos (leads do período que chegaram a "Contrato (Ganho)"); ROAS = valor ganho desses leads ÷ investimento; todos sobre a mesma coorte do relatório | aberta | Mesma coorte do relatório de marketing (ASM-190) |
| ASM-220 | Gerente, master e super admin leem e gravam; atendente não acessa nem a leitura | aberta | É dado financeiro |
| ASM-221 | O filtro de origem do relatório também restringe o investimento ao canal escolhido | aberta | — |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-062 | O rateio linear por dias (ASM-218) serve para períodos que não cobrem o mês inteiro, ou o relatório deve usar só meses fechados? | aberta | — |
