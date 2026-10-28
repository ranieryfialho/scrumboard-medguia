# Spec: Fase 4 — Análises: indicadores, relatório de marketing e relatório comercial (telas 23 a 25)

> feature: fase4-analises
> status: rascunho

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - US-xxx = história de usuário · AC-xxx = critério de aceite
    ASM-xxx = suposição · Q-xxx = pergunta em aberto
    São códigos de rastreio: ligam a especificação às tarefas e aos testes.
  - Toda história de usuário precisa de pelo menos um critério de aceite.
  - Todo critério de aceite precisa de Dado/Quando/Então completos.
  - Os códigos são únicos no projeto inteiro (nunca reutilize um número).
  - Suposições e Perguntas em aberto são OBRIGATÓRIAS: se não há nenhuma,
    escreva "Nenhuma." — mas desconfie: quase toda feature esconde uma.
-->

## Contexto

Continuação do roteiro que coloca o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. Esta feature entrega as
**telas 23 a 25 do inventário** (`docs/ui/inventario-telas.md`): os
**indicadores do funil comercial** (`/indicadores`), o **relatório de marketing**
(`/relatorios`) e o **relatório comercial** (`/relatorios-comerciais`). Os três
itens já estão no grupo "Análises" do menu (só GERENTE e MASTER veem).

Situação hoje (conferida no código em 28/10):

- `/indicadores` existe fora da casca e mostra os 7 indicadores da fase2d
  (`GET /api/relatorios/kpis`, com período e responsável). Falta o resto do protótipo:
  funil por etapa e desempenho por responsável.
- `/relatorios` e `/relatorios-comerciais` existem fora da casca e são do sistema
  **antigo**: leem a planilha do Google (`/api/sheets`), sem empresa nem usuário. Os
  dados não vêm do banco do CRM novo.
- O CRM novo **tem** os dados para um relatório de verdade: leads com origem e data de
  criação, o histórico de cada card (`oportunidade_eventos`, inclusive "chegou à etapa X"
  e quando), valor do card, responsável e motivo de perda.
- O CRM novo **não tem**: investimento em mídia, custo por canal, cliques de anúncio,
  UTM, especialidade médica da clínica, metas de receita nem de SLA. Os blocos do
  protótipo que dependem disso (investimento, CAC, ROAS, CPL, especialidade, campanhas
  de anúncio, meta do trimestre) **não aparecem**.

Regras herdadas: a marcação e as classes do `code.html` de cada tela são a referência;
**blocos que mostram dado inexistente no sistema são removidos** e **ações sem backend
aparecem visíveis e marcadas "em breve"**. Lições das features anteriores: critérios de
tela dizem o que a tela mostra; todo item do menu aponta para uma página que existe (e um
teste confere); antes da PR, a suíte inteira passa, não só os critérios da feature; a
prova (`verify`) é gerada no código final e commitada junto.

## Histórias

### US-133 — Acompanhar os indicadores do funil (tela 23)

Como gerente ou master, quero ver os 7 indicadores, o funil por etapa e o desempenho
de cada responsável num período, para saber onde o funil perde gente.

#### AC-555 — A tela abre dentro da casca, só para gerente e master

- **Dado** um usuário com sessão
- **Quando** ele abre `/indicadores` (ou clica em "Indicadores" no menu)
- **Então** vê o menu e o topo da casca com "Indicadores" marcado e o título "Indicadores de Governança Comercial & Funil de Vendas"; sem sessão vai ao login; o ATENDENTE continua sem o grupo "Análises" no menu e sem acesso à rota (regra da casca)

#### AC-556 — O período e o responsável restringem tudo

- **Dado** a tela aberta
- **Quando** o usuário escolhe "Últimos 30 dias", "Este mês" ou "Trimestre atual", escolhe um responsável ou usa "Atualizar Métricas"
- **Então** a tela pede de novo `GET /api/relatorios/kpis` e `GET /api/relatorios/funil` com `de`, `ate` e `responsavelId` e redesenha tudo; o padrão é "Este mês"; a lista de responsáveis vem de `GET /api/pipeline/responsaveis`

#### AC-557 — O servidor devolve o funil por etapa e o desempenho por responsável

- **Dado** cards de duas empresas, de responsáveis e etapas diferentes, com histórico de etapas
- **Quando** a tela pede `GET /api/relatorios/funil?de=&ate=&responsavelId=`
- **Então** voltam, só da empresa da sessão e só dos cards criados no período (a mesma coorte dos 7 indicadores), `funil` (quantos chegaram a cada etapa: entrada, conectados, reunião agendada, reunião realizada, proposta e contrato ganho) e `porResponsavel` (por pessoa: cards atendidos, cadência esgotada ÷ iniciada, reuniões agendadas, no-show ÷ agendadas, propostas, contratos, win rate e receita ganha), com "sem responsável" numa linha própria; parâmetro inválido é 400, sem sessão 401 e ATENDENTE 403

#### AC-558 — Os sete indicadores aparecem com a conta à vista

- **Dado** os indicadores carregados
- **Quando** os cartões são renderizados
- **Então** cada um mostra o nome, o valor em porcentagem e "N de M" (numerador e denominador), ou "Sem dados" quando o denominador é zero; a "Ativação em trial" mostra sempre "Sem dados" (ainda sem fonte, Q-023); metas, "vs mês anterior" e selos de "Superada/Controlado" do protótipo **não aparecem** (sem meta nem comparação no sistema)

#### AC-559 — O funil de conversão mostra retenção e perda entre as etapas

- **Dado** as contagens do funil
- **Quando** o bloco "Funil de Conversão Comercial Contínuo" é renderizado
- **Então** mostra as seis etapas com a quantidade em cada uma e, a partir da segunda, a porcentagem que seguiu da etapa anterior e a que ficou pelo caminho; etapa anterior com zero mostra traço; "ciclo médio", "tempo na fila", "ticket" e "MRR gerado" do protótipo **não aparecem** neste bloco

#### AC-560 — A tabela de desempenho por responsável

- **Dado** o desempenho por responsável
- **Quando** a tabela é renderizada
- **Então** cada linha mostra iniciais, nome, papel, os números do AC-557 (a receita em R$), ordenada pela maior receita ganha, com "Mostrando N responsáveis"; sem nenhum, mostra "Nenhum card neste período"; "Top Closer", cargo e e-mail do protótipo **não aparecem**

#### AC-561 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela de indicadores
- **Quando** o usuário olha "Relatório Executivo", "Exportar CSV" e "Configurar Metas"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; a meta comercial do trimestre, o índice de eficiência e os alertas operacionais ("Disparar Minutas em Lote", resgate de no-show) **não aparecem** (sem meta nem fonte)

### US-134 — Entender de onde vêm os leads e o que viram (tela 24)

Como gerente ou master, quero ver os leads que entraram, por origem e por período, e
quantos viraram reunião e contrato, para saber quais origens funcionam.

#### AC-562 — A tela abre dentro da casca

- **Dado** um usuário com sessão que pode ver análises
- **Quando** ele abre `/relatorios` (ou clica em "Relatórios" no menu)
- **Então** vê o item "Relatórios" marcado e o título "Relatórios de Marketing e Origem dos Leads" (sem "Tráfego e Atribuição": o sistema não tem dado de mídia); sem sessão vai ao login

#### AC-563 — O servidor devolve o resumo, a série e a tabela por origem

- **Dado** leads de duas empresas, com origens e datas de criação diferentes, e cards com histórico de etapas
- **Quando** a tela pede `GET /api/relatorios/marketing?de=&ate=&origem=&agrupar=dia|semana|mes`
- **Então** voltam, só da empresa da sessão e só dos leads criados no período, `resumo` (leads, conectados, reuniões realizadas, contratos e conversão final = contratos ÷ leads), `serie` (por dia, semana ou mês: leads criados e reuniões agendadas naquele intervalo, sem pular intervalos vazios), `porOrigem` (por origem, com "Sem origem" para nulo: leads, conectados, reuniões realizadas, contratos, conversão final e valor ganho) e `origens` (a lista para o filtro); `origem` restringe tudo a uma origem; parâmetro inválido é 400, sem sessão 401 e ATENDENTE 403

#### AC-564 — Os filtros e os quatro cartões

- **Dado** a tela aberta
- **Quando** o usuário escolhe "Hoje", "Últimos 7 dias", "Últimos 30 dias", "Este mês" ou "Trimestre atual", escolhe uma origem ou usa "Atualizar"
- **Então** a tela pede de novo a API com o período e a origem e mostra os cartões "Leads captados", "Leads conectados", "Reuniões realizadas" e "Contratos fechados" (com a conversão final em "% dos leads"); o padrão é "Últimos 30 dias"

#### AC-565 — O gráfico de leads e reuniões por período

- **Dado** a série devolvida
- **Quando** o gráfico "Aquisição de Leads e Conversão por Período" é renderizado
- **Então** mostra as duas linhas (leads e reuniões agendadas) em desenho próprio da tela, com os botões "Diário", "Semanal" e "Mensal" que pedem a série agrupada de novo, o eixo com as datas e os valores, e uma tabela de dados equivalente para leitor de tela; sem nenhum lead no período mostra "Sem dados no período"

#### AC-566 — A tabela de desempenho por origem

- **Dado** a tabela por origem
- **Quando** é renderizada
- **Então** cada origem mostra leads, conectados, reuniões realizadas, contratos, conversão final e valor ganho (R$), da maior quantidade de leads para a menor, com a linha "Totais consolidados" somando tudo (a conversão total é contratos ÷ leads); sem leads mostra "Nenhum lead neste período"

#### AC-567 — Itens do protótipo sem dado ou sem backend não aparecem ou ficam "em breve"

- **Dado** o relatório de marketing
- **Quando** o usuário olha a tela
- **Então** "Exportar Relatório Completo (CSV/PDF)" e "Filtrar por especialidade" aparecem "em breve"; investimento, CAC, ROAS, CPL, CPM, cliques/visitas, custo por canal, segmentação por especialidade, top campanhas de anúncio e os destaques ("melhor horário", "velocidade do 1º contato") **não aparecem** (o sistema não tem esses dados, Q-057)

### US-135 — Acompanhar a receita e a produtividade comercial (tela 25)

Como gerente ou master, quero ver a receita fechada, o pipeline em negociação, o ciclo
de venda, o win rate, o ranking da equipe e os motivos de perda, para guiar o time.

#### AC-568 — A tela abre dentro da casca

- **Dado** um usuário com sessão que pode ver análises
- **Quando** ele abre `/relatorios-comerciais` (ou clica em "Comercial" no menu)
- **Então** vê o item "Comercial" marcado e o título "Relatórios Comerciais e Produtividade de Vendas"; sem sessão vai ao login; os filtros de período (os mesmos do AC-564, padrão "Este mês") e de responsável pedem a API de novo

#### AC-569 — O servidor devolve o resumo, a evolução semanal, o ranking e os motivos de perda

- **Dado** cards de duas empresas com contratos fechados, propostas e perdas em datas diferentes
- **Quando** a tela pede `GET /api/relatorios/comercial?de=&ate=&responsavelId=`
- **Então** voltam, só da empresa da sessão, `resumo` (novo MRR contratado = soma do valor dos cards que chegaram a "Contrato (Ganho)" no período; contratos; ticket médio; pipeline em negociação = soma do valor e quantidade dos cards hoje em "Proposta", "Teste (Trial)" e "Negociação"; ciclo médio em dias da criação ao ganho; win rate = ganhos ÷ (ganhos + perdas) do período), `semanal` (por semana: valor fechado e valor de propostas geradas), `ranking` (por responsável: reuniões realizadas, propostas, contratos, win rate, ciclo médio, ticket médio e valor fechado), `motivosPerda` (por motivo: quantidade e porcentagem) e `totalPerdas`; "no período" é a data do evento no histórico do card; parâmetro inválido é 400, sem sessão 401 e ATENDENTE 403

#### AC-570 — Os quatro cartões do topo

- **Dado** o resumo
- **Quando** os cartões são renderizados
- **Então** mostram "Novo MRR contratado" (R$ por mês, com "N contratos · ticket médio R$ X"), "Pipeline em negociação" (R$ e "N propostas"), "Ciclo médio" (dias, ou traço sem contratos) e "Win rate" (porcentagem, com "N ganhos · N perdas", ou traço sem base); meta, "ponderado", "inbound/outbound" e "tempo de apresentação" do protótipo **não aparecem**

#### AC-571 — A evolução semanal de receita ganha e pipeline criado

- **Dado** a série semanal
- **Quando** o gráfico "Evolução Semanal de Receita Ganha vs Pipeline Criado" é renderizado
- **Então** mostra as duas linhas por semana (valor fechado e valor de propostas geradas) em desenho próprio da tela, com o eixo, os valores e uma tabela de dados equivalente para leitor de tela; sem nenhum valor no período mostra "Sem dados no período"; os quatro destaques do rodapé do protótipo ("melhor dia", "ticket campeão", "proposta até assinatura", "desconto") **não aparecem**

#### AC-572 — O ranking da equipe

- **Dado** o ranking
- **Quando** a tabela é renderizada
- **Então** cada linha mostra o nome do responsável e os números do AC-569, e o seletor "Ordenar por" troca entre "Maior valor fechado" (padrão), "Maior win rate" e "Mais contratos"; a linha "Totais consolidados" soma reuniões, propostas, contratos e valor, e mostra o win rate e o ticket do conjunto; sem nenhum responsável mostra "Nenhum card neste período"

#### AC-573 — Os motivos de perda

- **Dado** as perdas do período
- **Quando** o bloco "Motivos de Perda no Ciclo" é renderizado
- **Então** lista os motivos do mais para o menos frequente, cada um com quantidade, porcentagem e barra, os cinco primeiros em destaque e o restante agrupado em "Outros", e mostra o total de perdas; perda sem motivo aparece como "Sem motivo informado"; sem perdas mostra "Nenhuma perda no período"

#### AC-574 — Itens do protótipo sem dado ou sem backend não aparecem ou ficam "em breve"

- **Dado** o relatório comercial
- **Quando** o usuário olha a tela
- **Então** "Exportar Dados (CSV/XLSX)", "Configurar Metas de Vendas" e "Filtrar por especialidade" aparecem "em breve"; a distribuição por especialidade médica e o selo "Meta atingida" **não aparecem** (sem dado nem meta, Q-058)

### US-136 — Navegar pelas análises sem tela antiga e com estados de verdade

Como usuário, quero que os três itens de Análises abram as telas novas, com carregando,
vazio e erro, sem sobrar tela antiga.

#### AC-575 — Os três itens do menu apontam para as páginas novas e as antigas saíram

- **Dado** os itens "Indicadores", "Relatórios" e "Comercial" do menu
- **Quando** o teste lê os `href` e os arquivos de página
- **Então** existem as páginas do Next dentro de `src/app/(app)` para `/indicadores`, `/relatorios` e `/relatorios-comerciais`; as três telas antigas fora da casca (`src/app/indicadores`, `src/app/relatorios`, `src/app/relatorios-comerciais`) não existem mais (sem rota duplicada); o grupo "Análises" é visível a GERENTE e MASTER e escondido do ATENDENTE, que também não acessa as rotas nem `/api/relatorios`; a casca marca o item certo em cada rota

#### AC-576 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das três telas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo ("Nenhum card neste período", "Nenhum lead neste período", "Nenhuma perda no período") e uma mensagem de erro com "Tentar de novo" que não apaga os números já mostrados

## Fora de escopo

- **Investimento em mídia e tudo que depende dele** (CAC, ROAS, CPL, CPM, LTV/CAC, payback, custo por canal, cliques e visitas, UTM, campanhas e anúncios): o sistema não tem a fonte (Q-057).
- **Metas** (receita do trimestre, SLA, win rate alvo, "meta atingida"), **comparação com o mês anterior** e selos de qualidade: sem meta cadastrada nem série histórica comparável (Q-058).
- **Especialidade médica** e **porte da clínica**: o lead não guarda.
- **Exportar** (CSV, XLSX, PDF), relatório executivo e configuração de metas: sem backend; "em breve".
- **Alertas operacionais** (propostas paradas, resgate de no-show) do protótipo de indicadores: ficam para quando houver regra e dono.
- **Ativação em trial:** continua "Sem dados" (Q-023 da fase2d).
- Os componentes legados (`src/components/indicadores/painel-kpis.tsx`) e os testes deles **ficam como estão**; as três páginas antigas fora da casca (que liam a planilha) são removidas.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-190 | "Chegou à etapa X" = existe evento `transicao_etapa` com destino X no histórico do card (mesma regra dos 7 indicadores, ASM-070); "quando" é a data do evento | aberta | Reaproveita `oportunidade_eventos` |
| ASM-191 | A coorte dos indicadores, do funil e do relatório de marketing é "criados no período" (cards criados, ou leads criados); o relatório comercial usa "eventos no período" (quem fechou, perdeu ou propôs naquele intervalo) | aberta | Indicadores de funil medem conversão de uma coorte; receita mede o que aconteceu no período |
| ASM-192 | Os períodos prontos são "Hoje", "Últimos 7 dias", "Últimos 30 dias", "Este mês" e "Trimestre atual" (os dois últimos de calendário, em São Paulo); a API recebe sempre `de` e `ate` (`YYYY-MM-DD`, inclusivos); período máximo de 366 dias | aberta | A API de KPIs já usa `de`/`ate` |
| ASM-193 | Receita = `valor` atual do card (hoje ele guarda um valor só, ASM-136); cards ganhos sem valor contam 0; "R$/mês" como no resto do sistema | aberta | Não há valor por data |
| ASM-194 | "Pipeline em negociação" = cards hoje em "Proposta" (11), "Teste (Trial)" (12) e "Negociação" (13), sem filtro de período | aberta | Foto do funil de hoje |
| ASM-195 | "Win rate" = ganhos ÷ (ganhos + perdas) do período; "perda" = evento de ida para "Perdido" (14) no período; "ciclo médio" = média de dias entre a criação do card e o ganho, só dos ganhos do período | aberta | O win rate dos 7 indicadores (ganhos ÷ propostas) é outro indicador, de coorte |
| ASM-196 | A origem do lead é o texto livre de `leads.origem`; nulo ou vazio vira "Sem origem"; não há normalização de grafias | aberta | A origem é digitada (ASM-137) |
| ASM-197 | A série agrupa por dia (padrão para até 31 dias), semana (segunda a domingo) ou mês, em São Paulo, preenchendo os intervalos sem dado com zero | aberta | Evita buracos no gráfico |
| ASM-198 | Os gráficos são desenhados com SVG próprio, sem biblioteca nova, com tabela equivalente para leitor de tela | aberta | Segue a guia de visualização de dados e evita dependência |
| ASM-199 | O responsável "sem responsável" aparece em linha própria nas tabelas por pessoa | aberta | Cards sem dono existem (importação) |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-057 | De onde virá o investimento em mídia por canal (para CAC, ROAS e CPL)? Hoje não há campo nem integração; o protótipo mostra tudo isso. Enquanto isso, esses números não aparecem | aberta | — |
| Q-058 | Quais são as metas oficiais (receita do trimestre, win rate, SLA do 1º toque) e onde elas ficam cadastradas? O protótipo mostra "meta atingida" e "Configurar metas" | aberta | — |
