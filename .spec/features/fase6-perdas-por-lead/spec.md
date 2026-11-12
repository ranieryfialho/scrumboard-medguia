# Spec: Fase 6 — Quem perdeu, quando e por quê (no card e nos relatórios)

> feature: fase6-perdas-por-lead
> status: rascunho

## Contexto

Hoje o motivo de perda aparece só como **total por motivo** no relatório comercial ("Motivos de Perda no Ciclo"). Não dá para saber **quais leads** foram perdidos, **de quem eram**, **em que etapa** estavam e **quando**. No detalhe do card (`/pipeline/[id]`), o nome do motivo chega pela API mas não há um bloco que conte a perda. Esta feature mostra a perda **por lead**: no card, em uma lista de leads perdidos no relatório comercial e em um resumo por motivo no relatório de marketing.

## Histórias

### US-193 — Ver no card por que, quando e de quem foi a perda

Como atendente ou gestor, quero abrir um card perdido e ver o motivo, a etapa em que estava, quando foi perdido e o responsável, para entender o que aconteceu sem vasculhar a linha do tempo.

#### AC-813 — Bloco "Perda" no detalhe do card

- **Dado** um card na etapa "Perdido" com o motivo "Preço" escolhido, que estava em "Proposta" e cujo responsável é Ana
- **Quando** a pessoa abre `/pipeline/[id]`
- **Então** vê o bloco "Perda" com: motivo "Preço", etapa em que estava ("Proposta"), responsável "Ana" e a data e hora da perda (fuso de São Paulo)

#### AC-814 — Sem motivo, sem responsável e fora de Perdido

- **Dado** um card perdido sem motivo informado e sem responsável, e outro card que não está em "Perdido" (ou que foi reaberto depois de perdido)
- **Quando** cada um é aberto
- **Então** o primeiro mostra "Sem motivo informado" e "Sem responsável"; o segundo não mostra o bloco "Perda"

#### AC-815 — A perda automática diz que foi automática

- **Dado** um card perdido pela cadência esgotada (motivo sistêmico "Cadência esgotada")
- **Quando** o card é aberto
- **Então** o bloco "Perda" mostra o motivo "Cadência esgotada" e a marca "Perda automática"

### US-194 — Ver os leads perdidos e os motivos nos relatórios

Como gestor, quero uma lista dos leads perdidos no período, com responsável e motivo, e ver os motivos também no relatório de marketing, para cobrar a equipe e corrigir o que está fazendo perder.

#### AC-816 — Lista "Leads perdidos" no relatório comercial

- **Dado** leads que foram para "Perdido" dentro do período escolhido
- **Quando** a pessoa abre o relatório comercial
- **Então** abaixo do bloco de motivos há a lista "Leads perdidos" com uma linha por lead: nome, responsável, motivo, etapa em que estava, origem e data da perda, cada nome levando ao card; o número de linhas é igual ao total de perdas exibido no bloco de motivos; a lista é paginada de 10 em 10, com opções de 20, 50 e 100

#### AC-817 — Clicar num motivo filtra a lista

- **Dado** o bloco "Motivos de Perda no Ciclo" e a lista de leads perdidos
- **Quando** a pessoa clica no motivo "Preço"
- **Então** a lista mostra só os perdidos por "Preço", o motivo fica destacado como filtro ativo, e clicar de novo (ou em "Limpar") volta à lista completa

#### AC-818 — A lista respeita período, responsável e especialidade

- **Dado** um período personalizado, o filtro de responsável Ana e a especialidade "Dermatologia"
- **Quando** a lista é carregada
- **Então** traz só as perdas de Ana, de leads dessa especialidade, ocorridas no período; perda de outro período ou de outra empresa nunca aparece

#### AC-819 — Relatório de marketing mostra os motivos dos leads captados

- **Dado** leads que entraram no período escolhido, alguns já perdidos
- **Quando** a pessoa abre o relatório de marketing
- **Então** vê "Motivos de perda dos leads captados": quantos dos leads captados no período foram perdidos ("N de M"), e o ranking de motivos com quantidade e porcentagem sobre os perdidos, respeitando os filtros de origem e especialidade do relatório; sem perdas mostra "Nenhuma perda entre os leads captados"

## Fora de escopo

- Exportar a lista de perdidos em CSV.
- Mostrar "quem registrou a perda" (o usuário que moveu o card), que continua na linha do tempo.
- Reabrir ou mover cards a partir da lista.
- Mudar os motivos de perda disponíveis ou a regra de escolha do motivo.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-308 | "Quem perdeu" é o **responsável atual do card** (`oportunidades.responsavel_id`); o card não guarda o responsável do instante da perda, então se o card for reatribuído depois, aparece o responsável novo | aberta | Foi a opção escolhida pelo dono do produto |
| ASM-309 | A "etapa em que estava" é a etapa de origem da última transição para "Perdido" (`oportunidade_eventos.etapa_origem_id`); a data da perda é o `ocorrido_em` dessa mesma transição | aberta | Usa o log de eventos, que já é a fonte dos relatórios |
| ASM-310 | A lista traz o mesmo conjunto das perdas que o bloco de motivos conta (uma perda por card, a primeira transição para "Perdido" no período), para os totais baterem | aberta | Reaproveita a consulta de `analises-comercial.ts` |
| ASM-311 | A lista vem no mesmo `GET /api/relatorios/comercial` (campo novo `leadsPerdidos`) e a página e o filtro de motivo ficam na tela; o volume é de dezenas a centenas de perdas por período | aberta | Evita endpoint novo; se crescer, vira paginação no servidor |
| ASM-312 | No marketing a base é a coorte da data de entrada do lead (como o resto desse relatório), e "perdido" é o card estar hoje em "Perdido", com o motivo gravado no card | aberta | É a leitura que não exige o log de eventos |
| ASM-313 | O responsável do card vem de `usuarios.nome`; sem responsável aparece "Sem responsável" | aberta | Igual ao restante do detalhe do card |

## Perguntas em aberto

Nenhuma.
