# Spec: Fase 4 — Telas do Pipeline (funil, lista, arquivados e detalhe)

> feature: fase4-pipeline-telas
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

Segunda das quatro features que colocam o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. A primeira
(`fase4-design-system-shell-acesso`) entregou o design system, a casca (menu e
topo) e as telas de acesso. Esta entrega as **telas 6 a 9 do inventário**
(`docs/ui/inventario-telas.md`): o funil Kanban (`/pipeline`), a lista
(`/pipeline/lista`), os arquivados (`/pipeline/arquivados`) e o detalhe do card
(`/pipeline/[id]`). O pipeline já funciona (fase2-kanban: board, criar card,
mover com trava, detalhe, anexos), mas com tela crua, sem a casca e sem a
identidade do protótipo.

Regras herdadas da feature anterior (decisões do usuário, 23/10): a marcação e
as classes do `code.html` de cada tela são a referência; o que o protótipo traz
só para desenhar (seletor de estado, etiquetas de história, dados fictícios)
não entra; o que não tem backend entra **visível e marcado "em breve"**.

Decisões do usuário nesta feature (26/10): (1) o escopo é visual **e** backend;
por ser grande, divide-se em duas features: esta (telas, indicadores, filtros e
paginação no servidor) e `fase4-pipeline-lote` (ações em lote e exportação);
(2) filtros, ordenação e paginação da lista e dos arquivados rodam **no
servidor**; (3) no detalhe, os blocos do protótipo **sem dado no sistema são
removidos** (não ficam como "em breve").

## Histórias

### US-106 — Ver e operar o funil na identidade nova

Como atendente, gerente ou master, quero o quadro das 15 etapas com a cara do
protótipo, indicadores no topo e filtros, para enxergar e mexer no funil de
relance.

#### AC-387 — O funil aparece dentro da casca, só para quem tem acesso

- **Dado** um usuário com sessão e permissão para o pipeline
- **Quando** ele abre `/pipeline`
- **Então** vê o menu lateral e o topo da casca, com o item "Funil Pipeline" marcado, e o quadro com as 15 colunas; sem sessão, vai para o login (a rota passa para o grupo `(app)`, a URL não muda)

#### AC-388 — Cada coluna e cada card mostram o que o protótipo mostra

- **Dado** cards em várias etapas, com responsável, valor e próxima ação
- **Quando** o quadro é renderizado
- **Então** cada coluna mostra o nome da etapa, a contagem de cards e a soma dos valores; cada card mostra nome do lead, responsável, valor, próxima ação e o selo de atraso quando a próxima ação venceu

#### AC-389 — Os indicadores do topo vêm dos dados reais

- **Dado** uma empresa com cards ativos, toques vencidos e fechamentos nos últimos 30 dias
- **Quando** o funil é aberto
- **Então** os quatro cartões mostram: cards ativos e o valor somado deles, toques em atraso, propostas ativas e taxa de conversão dos últimos 30 dias, calculados só com dados da empresa da sessão (`GET /api/pipeline/indicadores`)

#### AC-390 — Os filtros do funil restringem o quadro

- **Dado** cards com origens, responsáveis e etapas diferentes
- **Quando** o usuário escolhe um responsável, uma origem ou digita na busca de texto
- **Então** o quadro mostra só os cards que atendem a todos os filtros ativos, as contagens das colunas refletem o filtro e "Limpar" volta ao quadro completo

#### AC-391 — O modal "Novo Lead" cria o card na entrada

- **Dado** o modal "Novo Lead no Pipeline" aberto
- **Quando** o usuário preenche nome, telefone e origem (obrigatórios) e salva
- **Então** o card nasce na etapa "Entrada de leads" com o responsável escolhido (ou sem responsável) e o valor informado, aparece na primeira coluna, e campo obrigatório vazio impede o envio mostrando o erro no campo

#### AC-392 — "Salvar e iniciar cadência" cria o card e já inicia a cadência

- **Dado** o modal "Novo Lead no Pipeline" com os campos obrigatórios preenchidos
- **Quando** o usuário usa "Salvar e Iniciar Cadência"
- **Então** o card é criado e a cadência de 18 toques é iniciada (API de iniciar cadência já existente); "Criar Card na Entrada" cria só o card, sem cadência

#### AC-393 — Itens do funil sem backend aparecem como "em breve"

- **Dado** o funil renderizado
- **Quando** o usuário olha as ações do protótipo sem backend (busca global, "Iniciar Cadência em Massa", seletor de visões salvas)
- **Então** elas aparecem visíveis, marcadas "em breve", e não disparam nenhuma ação

### US-107 — Ver todos os leads em lista, com filtro e paginação

Como gerente, quero a mesma carteira em tabela, filtrada e paginada pelo
servidor, para trabalhar com centenas de cards sem travar a tela.

#### AC-394 — A lista aparece dentro da casca, em `/pipeline/lista`

- **Dado** um usuário com permissão para o pipeline
- **Quando** ele abre `/pipeline/lista` (ou clica em "Lista" no menu / "Alternar para Funil Kanban" na outra tela)
- **Então** vê a tabela com lead, etapa atual, responsável, valor estimado e próxima ação, com o item "Lista" marcado no menu

#### AC-395 — O servidor pagina a lista

- **Dado** 25 cards ativos e tamanho de página 10
- **Quando** a lista pede a página 2 (`GET /api/oportunidades/lista?pagina=2&porPagina=10`)
- **Então** a resposta traz os cards 11 a 20 e o total geral (25); a tela mostra "Exibindo 11 a 20 de 25" e os botões de página; só tamanhos 10, 25 e 50 são aceitos (outro valor vira 10)

#### AC-396 — O servidor filtra e ordena a lista

- **Dado** cards de etapas, responsáveis e origens diferentes
- **Quando** a lista é pedida com etapa, responsável, origem, texto de busca e ordenação por valor ou próxima ação
- **Então** só voltam cards que atendem a todos os filtros, na ordem pedida, e o total reflete o filtro (a busca de texto acha por nome do lead, e-mail e telefone)

#### AC-397 — A lista nunca mostra card de outra empresa

- **Dado** cards de duas empresas
- **Quando** um usuário da empresa A pede a lista, mesmo tentando passar `empresaId` na URL
- **Então** só voltam cards da empresa A, e sem sessão a resposta é 401

#### AC-398 — A lista não traz cards arquivados

- **Dado** cards em "Perdido" e "Contrato (Ganho)"
- **Quando** a lista é pedida sem filtro de etapa
- **Então** esses cards não aparecem (eles estão em `/pipeline/arquivados`), e o total os ignora

#### AC-399 — Cada linha leva ao card e a seleção marca linhas

- **Dado** a lista renderizada
- **Quando** o usuário clica no nome do lead, ou marca a caixa de uma linha ou a caixa do cabeçalho
- **Então** o nome leva a `/pipeline/[id]`; a marcação mostra "N selecionados" na barra de ações; as ações em lote aparecem "em breve" (entram na feature `fase4-pipeline-lote`)

### US-108 — Consultar o histórico de ganhos e perdas

Como gerente, quero ver os negócios fechados, ganhos e perdidos, com o motivo,
para entender por que ganhamos e perdemos.

#### AC-400 — Os arquivados aparecem em `/pipeline/arquivados` com as três abas

- **Dado** cards em "Contrato (Ganho)" e em "Perdido"
- **Quando** o usuário abre `/pipeline/arquivados`
- **Então** vê as abas "Todos", "Ganhos" e "Perdidos" com a contagem de cada uma, e cada aba lista só os cards daquele tipo

#### AC-401 — Cada linha traz status, responsável, motivo e data de fechamento

- **Dado** um card perdido com motivo e um card ganho com valor
- **Quando** a lista de arquivados é renderizada
- **Então** o perdido mostra o selo "Perdido" e o motivo, o ganho mostra o selo "Ganho" e o valor, e ambos mostram o consultor e a data de fechamento (a data do último movimento para a etapa final)

#### AC-402 — Os arquivados filtram e paginam no servidor

- **Dado** 30 cards arquivados
- **Quando** a lista pede busca de texto, motivo de perda, responsável e período, com página e tamanho (`GET /api/oportunidades/arquivados`)
- **Então** voltam só os que atendem a todos os filtros, a página pedida e o total filtrado; sem sessão é 401 e nunca aparece card de outra empresa

#### AC-403 — Os indicadores dos arquivados vêm dos dados reais

- **Dado** fechamentos no período
- **Quando** a tela de arquivados é aberta
- **Então** os quatro cartões mostram valor ganho, negócios fechados, conversão final (ganhos ÷ finalizados) e perdas no mês com a taxa de perda, e o quadro "Distribuição de motivos de perda" lista cada motivo com a contagem e o percentual

#### AC-404 — "Reabrir" volta o card ao funil respeitando as regras

- **Dado** um card perdido ou ganho e um usuário MASTER ou GERENTE
- **Quando** ele usa "Reabrir" e informa a justificativa pedida
- **Então** o card volta à etapa de reabertura do grafo (Perdido → Qualificando, Ganho → Negociação) e sai dos arquivados; o ATENDENTE vê o botão desabilitado e a API recusa (403)

#### AC-405 — Os blocos de análise sem backend aparecem como "em breve"

- **Dado** a tela de arquivados
- **Quando** o usuário olha "Exportar Relatório", "Análise de Motivos de Perda", "Top Fechamentos do Trimestre" e o "Playbook de Reversão"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação (a campanha de reativação entra na fase de campanhas)

### US-109 — Entender e mover um card pela tela de detalhe

Como atendente, quero abrir um card e ver quem é o lead, em que etapa está, o
que aconteceu e o que fazer em seguida, para agir sem sair da tela.

#### AC-406 — O detalhe mostra cabeçalho, etapa e jornada

- **Dado** um card de uma etapa qualquer
- **Quando** o usuário abre `/pipeline/[id]`
- **Então** vê o nome do lead, a etapa atual, o responsável e a barra "Jornada de Conversão" com as 15 etapas (as já percorridas preenchidas, a atual destacada) e o percentual concluído, usando os nomes reais das etapas do sistema

#### AC-407 — O detalhe mostra só os dados que o sistema tem

- **Dado** um card com lead, valor, origem, criado em, responsável, próxima ação, telefones e e-mail
- **Quando** o detalhe é renderizado
- **Então** mostra valor estimado, origem, data de entrada com "há N dias", responsável, próxima ação com selo de vencida, a lista de telefones e o e-mail; CNPJ, estrutura da clínica, valor anual, unidade física e telefone extra do protótipo **não aparecem**

#### AC-408 — A linha do tempo mostra o histórico real do card

- **Dado** um card com mudanças de etapa, notas e disparos já registrados em atividades
- **Quando** o usuário olha "Linha do Tempo de Atividades"
- **Então** vê os eventos do mais novo para o mais antigo, com tipo, texto, autor e data, com o filtro "Todos", e a contagem de interações; sem eventos, mostra o estado vazio

#### AC-409 — Registrar uma anotação interna entra na linha do tempo

- **Dado** o bloco "Registrar Interação Rápida" na aba "Anotação Interna"
- **Quando** o usuário escreve um texto e usa "Salvar Registro"
- **Então** a anotação aparece no topo da linha do tempo com o nome do autor, o campo é limpo, e texto vazio não envia (`POST /api/oportunidades/[id]/anotacoes`)

#### AC-410 — As ações de mover, ganho e perdido respeitam as regras do pipeline

- **Dado** o detalhe de um card ativo
- **Quando** o usuário usa "Mover de Etapa", "Marcar como Ganho" ou "Perdido"
- **Então** só as etapas de destino alcançáveis pelo papel aparecem; etapas que exigem dado ou motivo abrem o modal de trava existente; "Perdido" exige motivo; e o resultado vale na hora na tela (a transição é a API já existente)

#### AC-411 — O detalhe leva às abas das telas irmãs

- **Dado** o detalhe de um card
- **Quando** o usuário olha as abas "Resumo", "Cadência", "WhatsApp" e "Anexos e Evidências"
- **Então** "Resumo" está ativa; as outras levam a `/pipeline/[id]/cadencia`, `/conversa` e `/anexos`, que já existem e ainda serão redesenhadas (telas 10 a 12); itens do protótipo sem backend (registrar ligação, agendar reunião, disparar WhatsApp pelo bloco rápido, ícone de editar) aparecem "em breve"

#### AC-412 — Card de outra empresa ou inexistente mostra "não encontrado"

- **Dado** um id de card que não existe ou é de outra empresa
- **Quando** o usuário abre `/pipeline/[id]`
- **Então** a tela diz que o card não foi encontrado, com caminho de volta ao funil, sem vazar nenhum dado

### US-110 — Estados e permissões em todas as telas do pipeline

Como usuário, quero que as quatro telas tratem carregamento, vazio, erro e
falta de permissão do jeito do protótipo, para nunca ficar diante de uma tela
quebrada.

#### AC-413 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das quatro telas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo (ex.: "Nenhum lead ainda — crie o primeiro") e uma mensagem de erro com "Tentar de novo"

#### AC-414 — Quem não tem permissão vai para a tela de sem acesso

- **Dado** um usuário cujo papel não acessa a rota pedida
- **Quando** ele abre qualquer das quatro rotas
- **Então** é levado a `/sem-acesso` (regra de permissões por rota da fase 4, estendida às novas rotas `/pipeline/lista` e `/pipeline/arquivados`), e o menu não mostra o que o papel não vê

#### AC-415 — A tela legada de pipeline sai de cena

- **Dado** o projeto após esta feature
- **Quando** se procura a tela antiga de `/pipeline` (sem casca) e o componente que só ela usava
- **Então** `/pipeline` é servida só pela versão nova, sem rota duplicada, e os testes do componente antigo foram trocados pelos da versão nova

#### AC-416 — Funil, lista e arquivados se atualizam quando outro usuário mexe num card

- **Dado** as telas de funil, lista e arquivados abertas, ligadas ao fluxo de eventos já existente (`/api/stream`, evento `oportunidade.movida`)
- **Quando** outro usuário da mesma empresa move um card
- **Então** a tela atualiza sozinha (o card muda de coluna no funil; a lista e os arquivados recarregam a página atual e os indicadores), sem recarregar o navegador; eventos de outra empresa nunca chegam, e se a conexão cair a tela mostra o aviso "tempo real desconectado" e volta a atualizar ao reconectar

## Fora de escopo

- **Ações em lote** (mover etapa, reatribuir, disparar WhatsApp, arquivar em lote) e **exportar CSV/XLS** (lista e arquivados): feature `fase4-pipeline-lote`. Aqui aparecem "em breve".
- As abas Cadência, WhatsApp e Anexos do card (telas 10 a 12): próxima feature do roteiro. Aqui só se liga a elas.
- Busca global (Ctrl+K), notificações e visões salvas.
- Campos novos de cadastro (CNPJ, especialidade, estrutura, unidade física, ticket anual): fora, sem migration nesta feature (decisão 26/10).
- Quadro "Top Fechamentos do Trimestre" com especialidade e "Playbook de Reversão" funcionando (a campanha de reativação é da fase de campanhas).
- Registrar ligação, agendar reunião e disparar WhatsApp pelo bloco rápido do detalhe.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-132 | Os nomes das etapas na tela são os do banco (`pipeline_etapas`: "Entrada de leads", "1º dia de contato" … "Proposta", "Teste (Trial)", "Negociação", "Perdido", "Contrato (Ganho)"), não os do protótipo ("9. Proposta Enviada", "8. Follow-up Pós-Demo", etc.), que não batem com o playbook implementado | aberta | Seguir o banco evita a tela mentir sobre o funil; confirmar |
| ASM-133 | "Arquivados" = cards em etapa terminal: "Perdido" (14) e "Contrato (Ganho)" (15), as duas com `e_terminal` no seed | aberta | O inventário diz "cards em etapa final (Perdido e Ganho)" |
| ASM-134 | A data de fechamento mostrada nos arquivados é a do último evento de transição para a etapa terminal no histórico de atividades; não existe coluna de fechamento em `oportunidades` | aberta | Evita migration; cards migrados do legado sem esse evento usam `atualizado_em` |
| ASM-135 | Definições dos indicadores: **cards ativos** = fora das etapas terminais; **propostas ativas** = cards na etapa "Proposta"; **toques em atraso** = atividades de cadência pendentes com horário vencido (as mesmas da fila de tarefas atrasadas); **taxa de conversão (30 dias)** = ganhos ÷ (ganhos + perdidos) com fechamento nos últimos 30 dias, vazia se não houve fechamento | aberta | Os valores do protótipo ("+14% vs mês", "Meta 22%", "Ticket Médio") não têm fonte no sistema e não entram |
| ASM-136 | "Valor" do card é mensal (o protótipo escreve "/mês"); o sistema guarda um único `valor` por card, então a tela mostra "R$ X" com o rótulo "/mês" como no protótipo | aberta | Sem campo de periodicidade; confirmar o rótulo |
| ASM-137 | A origem do lead (`leads.origem`) é texto livre; o filtro "Origem" lista os valores distintos que existem na empresa, e o campo do modal "Novo Lead" oferece esses valores mais "Outro" | confirmada | Decisão do usuário em 26/10 (Q-046): sem lista oficial |
| ASM-138 | Reabrir um card segue o grafo já cadastrado (Perdido → Qualificando e Ganho → Negociação, com justificativa), com a restrição de papel da Q-048 | confirmada | Vem do seed de `pipeline_transicoes`; o grafo atual (`14→5`, `15→13`) permite os três papéis, então a rota de reabrir aplica a restrição a MASTER/GERENTE por cima do grafo, sem mexer no seed |
| ASM-139 | A anotação interna é um novo tipo de evento em `atividades` (`anotacao`) com texto e autor, sem tabela nova | aberta | Se a coluna `tipo` for texto livre não há migration; verificar na tarefa |
| ASM-140 | O seletor de empresa do topo e a busca global seguem como na fase 4 (empresa ativa pela sessão; busca "em breve") | confirmada | Decisão do usuário em 23/10 |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-046 | O protótipo mostra "Origem: Parceria ABEMED", "Inbound ABEMED" e "Ticket Médio". Há uma lista oficial de origens de lead a seguir (Google Ads, Parceria, Indicação…)? Sem ela, vale a ASM-137 | respondida | Decidido pelo usuário em 2026-10-26: sem lista oficial; usar os valores existentes mais "Outro" (ASM-137) |
| Q-047 | O funil e a lista devem se atualizar sozinhos quando outro usuário mexe num card (SSE, como a fila de tarefas)? O protótipo diz "Websocket Ativo", mas isso aumenta o escopo | respondida | Decidido pelo usuário em 2026-10-26: sim, ligar ao SSE existente (AC-416) |
| Q-048 | "Reabrir" um card arquivado é só para MASTER e GERENTE, ou o ATENDENTE também pode (o grafo atual decide por papel)? | respondida | Decidido pelo usuário em 2026-10-26: só MASTER e GERENTE (AC-404) |
