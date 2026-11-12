# Spec: Fase 6 — Período personalizado (análises e pipeline)

> feature: fase6-periodo-personalizado
> status: rascunho

## Contexto

As três telas de análises (marketing, comercial e indicadores do funil) só oferecem períodos prontos: hoje, 7 dias, 30 dias, mês e trimestre. O servidor dos relatórios **já aceita qualquer intervalo** (`de` e `ate`, inclusivos, em `America/Sao_Paulo`); falta a tela deixar a gestão escolher "de tal dia até tal dia". Esta feature acrescenta o período **Personalizado** ao filtro compartilhado das três telas.

No **pipeline**, o botão "Período" do funil é só um marcador "em breve": nenhuma das telas (funil, lista e arquivados) filtra por intervalo de datas hoje (os arquivados têm só um "a partir de", por data de fechamento). Esta feature faz o período funcionar nas três, e a pessoa **escolhe na hora qual data** o intervalo filtra: a **entrada do lead** ou a **última movimentação** do card.

## Histórias

### US-190 — Escolher qualquer intervalo de datas nas análises

Como gestor, quero informar a data inicial e a final de um relatório, para analisar uma campanha, um mês fechado ou qualquer janela que os botões prontos não cobrem.

#### AC-800 — O filtro tem a opção "Personalizado" com campos De e Até

- **Dado** qualquer uma das três telas de análises aberta num período pronto
- **Quando** a pessoa clica em "Personalizado"
- **Então** aparecem os campos "De" e "Até" (datas), já preenchidos com o período que estava na tela, e os botões prontos continuam disponíveis; escolher um botão pronto de novo esconde os campos

#### AC-801 — O relatório mostra o intervalo escolhido e compara com o anterior de mesmo tamanho

- **Dado** o período personalizado de 10/02/2026 a 19/02/2026 (10 dias, inclusivos)
- **Quando** a pessoa aplica o intervalo
- **Então** a tela pede ao servidor `de=2026-02-10&ate=2026-02-19` e, para a comparação, o intervalo imediatamente anterior de mesmo tamanho (`de=2026-01-31&ate=2026-02-09`); os números exibidos são os do intervalo escolhido

#### AC-802 — Intervalo inválido é barrado na tela, sem pedir ao servidor

- **Dado** o período personalizado aberto
- **Quando** "Até" é anterior a "De", ou um dos campos está vazio, ou o intervalo passa de 366 dias
- **Então** a tela avisa o motivo em português ("A data final não pode ser anterior à inicial", "Informe as duas datas", "O intervalo máximo é de 366 dias"), mantém o relatório anterior e não faz nenhuma chamada ao servidor

#### AC-803 — Exportações e títulos usam o intervalo escolhido

- **Dado** um período personalizado aplicado
- **Quando** a pessoa baixa um CSV ou lê o rótulo do período na tela
- **Então** o nome e o conteúdo refletem as datas escolhidas (formato `dd/mm/aaaa`), nunca o rótulo de um período pronto

### US-195 — Filtrar o pipeline por período

Como atendente ou gestor, quero filtrar o funil, a lista e os arquivados por um intervalo de datas, escolhendo se vale a entrada do lead ou a última movimentação, para olhar só os leads de uma campanha ou o que foi mexido numa semana.

#### AC-820 — O funil troca o "Período — em breve" pelo filtro de verdade

- **Dado** a tela do funil (quadro)
- **Quando** a pessoa abre o filtro "Período"
- **Então** vê os períodos prontos (hoje, 7 dias, 30 dias, mês, trimestre), a opção "Personalizado" com De e Até, e um seletor "Data" com "Entrada do lead" e "Última movimentação"; o marcador "em breve" desaparece; sem período escolhido, o quadro mostra todos os cards como hoje, e "Limpar" remove o período junto dos outros filtros

#### AC-821 — O quadro mostra só os cards da data dentro do intervalo, em todas as etapas

- **Dado** cards em várias etapas (inclusive Perdido e Contrato/Ganho), o intervalo 01/02/2026 a 28/02/2026 e a data "Entrada do lead"
- **Quando** o período é aplicado
- **Então** o quadro mostra só os cards cuja entrada cai no intervalo (inclusivo, fuso de São Paulo), em todas as etapas, e o resultado combina com busca, responsável e origem; trocar a data para "Última movimentação" refaz o filtro por essa data

#### AC-822 — A lista tem o mesmo filtro, e a exportação o respeita

- **Dado** a tela de lista do pipeline
- **Quando** a pessoa escolhe um período e a data
- **Então** a lista e a contagem de páginas mostram só os cards do intervalo (`GET /api/oportunidades/lista?de=&ate=&data=`), combinando com os outros filtros; a exportação da lista traz exatamente as mesmas linhas

#### AC-823 — Os arquivados trocam o "a partir de" por De/Até

- **Dado** a tela de arquivados, que hoje tem só a data "a partir de" por fechamento
- **Quando** a pessoa usa o período
- **Então** escolhe De e Até com a mesma escolha de data ("Entrada do lead" ou "Última movimentação", que nos arquivados é a data de fechamento); o campo antigo "a partir de" deixa de existir na tela, e o parâmetro antigo do servidor continua aceito para quem já o usa

#### AC-824 — O servidor recusa período inválido

- **Dado** as rotas de lista e de arquivados
- **Quando** `de` ou `ate` não está no formato `AAAA-MM-DD`, `ate` é anterior a `de`, ou `data` não é `entrada` nem `movimentacao`
- **Então** a resposta é 400 com o código `PERIODO_INVALIDO` e nada é consultado; sem `de` nem `ate`, o filtro de datas não é aplicado

#### AC-825 — Como cada data é calculada

- **Dado** um card migrado das planilhas (só tem o evento de migração, sem mudança de etapa), um card movido de "Qualificado" para "Proposta" em 10/03/2026 e um card perdido em 15/03/2026
- **Quando** o filtro é aplicado
- **Então** "Entrada do lead" usa a data de entrada do lead; "Última movimentação" usa a data da última mudança de etapa do card (a de 10/03 para o segundo, a de 15/03 para o terceiro) e, quando o card nunca mudou de etapa, cai na data de entrada, nunca na data da migração

## Fora de escopo

- Guardar o intervalo na URL ou lembrar a escolha entre visitas.
- Mudar o servidor dos relatórios: ele já aceita `de` e `ate` e não muda aqui.
- Atalhos novos além dos cinco prontos (ex.: "mês passado", "ano").
- Fazer os indicadores do topo do funil (e da lista) seguirem o período: eles continuam como hoje.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-300 | As três telas compartilham `FiltroPeriodo` e `periodoDoPreset`; a mudança é feita neles e as telas só passam a aceitar um período "escolhido" no lugar do preset | aberta | Confirmar na implementação |
| ASM-301 | O limite de 366 dias existe para proteger as consultas; não há limite no servidor hoje | aberta | O dono do produto pode pedir outro limite |
| ASM-302 | Datas são interpretadas em `America/Sao_Paulo`, `Até` inclusivo, igual ao servidor atual | aberta | Já é o contrato de `limitesDoPeriodo` |
| ASM-314 | O filtro do funil reaproveita as rotas `lista` e `arquivados` (como a busca e o responsável já fazem em `buscarIdsPermitidos`), então basta o período entrar em `condicoesDaLista` e na consulta de arquivados; as rotas de leitura do quadro não mudam | aberta | Evita endpoint novo |
| ASM-315 | "Última movimentação" = `ocorrido_em` do último `transicao_etapa` do card; sem nenhum, a data de entrada. Não usa `atualizado_em`, que nos cards migrados é a data da migração | aberta | Nos arquivados é a mesma ideia da data de fechamento (ASM-134), mas sem cair em `atualizado_em` |
| ASM-316 | O padrão do seletor "Data" é "Entrada do lead" | aberta | Foi a opção recomendada ao dono do produto; a escolha dele foi "escolher na hora" |
| ASM-317 | O parâmetro antigo dos arquivados (data a partir da qual considerar fechamentos) segue funcionando no servidor, equivalendo a `de` com `data=movimentacao`; só a tela muda | aberta | Evita quebrar quem chama a rota |

## Perguntas em aberto

Nenhuma.
