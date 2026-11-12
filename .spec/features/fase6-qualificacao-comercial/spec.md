# Spec: Fase6 qualificação comercial

> feature: fase6-qualificacao-comercial
> status: rascunho

## Contexto

O time comercial qualifica leads com um simulador solto (HTML): seis critérios pontuados (0 a 100), três critérios eliminatórios e uma faixa de encaminhamento. Como ele não salva nada, o score se perde. Esta feature leva a qualificação para dentro do card, guarda o resultado por oportunidade e mostra a faixa no funil e na lista, para o vendedor saber quem priorizar.

## Histórias

### US-198 — Qualificar o lead dentro do card

Como vendedor, quero preencher a qualificação comercial no card do lead e ver a nota e o encaminhamento recomendado, para conduzir a conversa e deixar o resultado registrado.

#### AC-830 — O cálculo da nota e da faixa segue as regras do simulador

- **Dado** as respostas dos seis critérios (dor operacional até 25 pts, complexidade 20, poder de decisão 15, gatilho e urgência 15, abertura para adoção 15, aderência à solução 10)
- **Quando** a qualificação é calculada
- **Então** a nota é a soma dos pontos (0 a 100); 80 ou mais é Faixa A (alta prioridade), 60 a 79 é Faixa B (qualificado), 40 a 59 é Faixa C (nutrição) e abaixo de 40 é Baixo fit; sem nenhuma resposta e sem eliminatório a avaliação é "não iniciada"; qualquer critério eliminatório marcado prevalece e a faixa é "Revisão obrigatória", mantendo a nota calculada

#### AC-831 — O servidor valida, calcula e guarda a qualificação por card

- **Dado** um card da empresa do usuário
- **Quando** a qualificação é salva (PUT) e depois lida (GET)
- **Então** o servidor aceita só pontuações que existem para cada critério, só estágios e eliminatórios conhecidos (senão 400 `QUALIFICACAO_INVALIDA`), calcula a nota e a faixa (nunca confia nos valores enviados), guarda quem avaliou e quando, devolve 404 para card de outra empresa e 401 sem sessão

#### AC-832 — O bloco "Qualificação" do card mostra o resultado em tempo real e salva

- **Dado** o detalhe do card
- **Quando** o usuário escolhe as respostas, marca eliminatórios e clica em Salvar
- **Então** o bloco mostra a nota, a barra, a faixa e a recomendação a cada mudança, envia as respostas ao salvar e mostra quem avaliou e quando; ao reabrir o card, as respostas voltam preenchidas

#### AC-833 — O estágio "Residente finalista" mostra a jornada do residente à parte

- **Dado** o estágio profissional escolhido no bloco
- **Quando** o estágio é "Residente finalista, preparando consultório"
- **Então** a jornada exibida é "ICP R · Residente finalista (relacionamento e preparação)", sem alterar a nota; os demais estágios mostram o nome da jornada correspondente e, sem estágio, "não identificada"

### US-199 — Ver a faixa de qualificação no funil e na lista

Como vendedor, quero ver a faixa de qualificação no card do funil e na lista, para saber de relance quem priorizar.

#### AC-834 — O card do funil mostra o selo da faixa

- **Dado** cards do funil, uns qualificados e outros não
- **Quando** o funil é aberto
- **Então** cada card qualificado mostra um selo com a faixa (A, B, C, Baixo fit ou Revisão) e a nota, e os não avaliados não mostram selo

#### AC-835 — A lista mostra a coluna Qualificação e filtra por faixa

- **Dado** a lista do pipeline
- **Quando** o usuário escolhe uma faixa no filtro
- **Então** a lista traz só os cards daquela faixa (a opção "Sem avaliação" traz os não avaliados), a coluna "Qualificação" mostra o selo de cada linha, e a exportação respeita o mesmo filtro

## Fora de escopo

- Relatório de conversão e receita por faixa (segunda etapa, depois de haver dados).
- Pesos e cortes configuráveis por empresa (ficam fixos num único módulo do código).
- Mover o card de etapa ou desqualificar automaticamente pela faixa.
- Histórico das avaliações anteriores (guarda só a última).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-319 | Os pesos, as opções e os cortes (80/60/40) são os do simulador entregue pelo dono, tratados como hipóteses comerciais a validar | confirmada | Vieram do simulador enviado pelo dono do produto |
| ASM-320 | A especialidade já mora no lead; o bloco guarda só o estágio profissional | confirmada | Decisão de desenvolvimento para não duplicar dado |
| ASM-321 | Qualquer papel que acessa o card pode preencher a qualificação | aberta | A confirmar com o dono do produto |

## Perguntas em aberto

Nenhuma.
