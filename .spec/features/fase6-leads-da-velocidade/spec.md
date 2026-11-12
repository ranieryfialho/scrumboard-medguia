# Spec: Fase6 leads da velocidade

> feature: fase6-leads-da-velocidade
> status: rascunho

## Contexto

O bloco "Velocidade do 1º contato" do relatório de marketing mostra mediana, média e faixas, mas não diz QUEM são os leads por trás dos números. O gestor precisa ver os leads (e abrir o card) para entender quem esperou mais e cobrar o atendimento.

## Histórias

### US-196 — Ver os leads por trás dos tempos de resposta

Como gestor, quero ver a lista dos leads que entraram na conta da velocidade do 1º contato, com a espera de cada um, para que eu saiba quem esperou mais e possa agir.

#### AC-826 — A lista traz um lead por linha, do que esperou mais ao que esperou menos

- **Dado** leads do período que receberam a 1ª mensagem enviada pelo CRM
- **Quando** o relatório de marketing é aberto
- **Então** abaixo das faixas há a lista "Leads do tempo de resposta", com nome (que leva ao card), responsável, entrada, 1º contato e a espera em relógio corrido e em horário comercial, ordenada da maior espera para a menor, e o total de linhas é igual ao "N leads" do bloco

#### AC-827 — Clicar numa faixa filtra a lista

- **Dado** a lista de leads do tempo de resposta
- **Quando** o usuário clica numa faixa (por exemplo "Mais de 24 h") de um dos lados (relógio corrido ou horário comercial)
- **Então** a lista mostra só os leads daquela faixa, naquele critério de tempo, aparece o filtro ativo com o botão "Limpar", e limpar volta à lista completa

#### AC-828 — O repositório devolve os leads coerentes com os resumos

- **Dado** leads com 1ª mensagem enviada e leads sem nenhuma
- **Quando** a análise de marketing é calculada
- **Então** `velocidade.leads` traz só os leads que têm 1ª mensagem, com a espera corrida e a comercial de cada um, na mesma quantidade de `velocidade.corrido.n`, e o id do card do lead

## Fora de escopo

- Listar os leads que ainda não tiveram nenhuma mensagem enviada.
- Exportar esta lista em CSV.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-318 | A lista fica no próprio bloco de velocidade, no relatório de marketing, e respeita o período e os filtros da tela | confirmada | Decisão tomada pelo desenvolvimento a partir do pedido ("quem são os leads dos indicadores") |

## Perguntas em aberto

Nenhuma.
