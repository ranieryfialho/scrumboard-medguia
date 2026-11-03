# Spec: Fase 4 — Fila do turno, tarefas atrasadas e agenda (telas 13 a 15)

> feature: fase4-tarefas-agenda
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
**telas 13, 14 e 15 do inventário** (`docs/ui/inventario-telas.md`): a **fila do
turno** (`/tarefas`), as **tarefas atrasadas** (`/tarefas/atrasadas`) e a
**agenda de reuniões e no-show** (`/agenda`). As três já aparecem no menu lateral.

Situação hoje (conferida no código em 28/10):

- `/tarefas` existe (fase2b-fila-tarefas), mas é a **tela crua antiga, fora da
  casca**, e mostra os atrasados como uma seção da mesma página.
- `/tarefas/atrasadas` **não existe**: o item "Tarefas Atrasadas" do menu leva a
  um 404 (o mesmo tipo de erro que as abas do card tiveram).
- `/agenda` **não existe**. A rota `/api/agenda` que há é do legado: lê uma
  planilha do Google, sem empresa nem usuário. A tabela `reunioes` existe no banco
  desde a fase 1, mas **ninguém escreve nela** no sistema novo: reuniões só são
  medidas pelas mudanças de etapa do funil (8 "Reunião agendada", 9 "No-show",
  10 "Reunião realizada").

Decisões do usuário nesta feature (28/10): (1) **uma feature só** com as três
telas (a PR é grande; a ordem de trabalho é tarefas primeiro, agenda por último);
(2) em "Tarefas atrasadas", **"Reatribuir em Lote" funciona**, reaproveitando a
reatribuição em lote do pipeline (só MASTER e GERENTE); (3) a agenda **usa a
tabela `reunioes` e move o card junto** (agendar, no-show e concluir mudam a
etapa pelas regras do funil, para a agenda e o funil nunca divergirem);
(4) entram as quatro ações **Agendar, Registrar No-Show, Marcar como Concluída e
Reagendar**; (5) entram as **quatro visões do calendário**: Mês, Semana, Dia e
Lista.

Regras herdadas: a marcação e as classes do `code.html` de cada tela são a
referência; **blocos que mostram dado inexistente no sistema são removidos** e
**ações sem backend aparecem visíveis e marcadas "em breve"**. Lições das
features anteriores: critérios de tela dizem o que a tela mostra (cabeçalho,
indicadores, filtros, botões); **todo item do menu aponta para uma página que
existe** (e um teste confere); cada tela é conferida no navegador contra o
`screen.png` antes da PR; a prova (`verify`) é gerada no código final e
**commitada antes do merge**.

## Histórias

### US-119 — Ver e cumprir a fila do turno (tela 13)

Como atendente, gerente ou master, quero ver os toques de cadência do turno
atual, concluir o que está na vez e acompanhar o andamento, para cumprir a régua
sem sair da tela.

#### AC-461 — A fila do turno abre dentro da casca, com o turno em andamento

- **Dado** um usuário com sessão
- **Quando** ele abre `/tarefas` (ou clica em "Tarefas do Turno" no menu)
- **Então** vê o menu e o topo da casca com "Tarefas do Turno" marcado, o título "Fila do Turno Operacional" e o selo do turno ("Turno Manhã em andamento (08h00 – 12h00)", "Turno Tarde em andamento (13h00 – 18h00)" ou "Fora do horário de atendimento"); sem sessão vai ao login, e a tela antiga sem casca deixa de existir

#### AC-462 — Os quatro indicadores do topo vêm dos dados reais

- **Dado** uma empresa com toques concluídos hoje, toques pendentes no turno e toques atrasados
- **Quando** a fila é aberta (`GET /api/atividades/resumo`)
- **Então** os cartões mostram "Toques do turno" (N/M concluídos, com a barra de progresso), "Conexões efetivas hoje", "Sem resposta hoje" e "Atrasados" (com o atalho "Ver N tarefas atrasadas" para `/tarefas/atrasadas`), calculados só com dados da empresa da sessão (e só dos cards do próprio usuário, se ele é ATENDENTE)

#### AC-463 — O servidor calcula os indicadores com regras fixas

- **Dado** toques `conectou` e `sem_resposta` realizados em dias e turnos diferentes, e toques pendentes liberados antes e dentro do turno
- **Quando** o resumo é pedido
- **Então** "concluídos do turno" conta só os feitos dentro do turno vigente de hoje, "total do turno" é esses mais os pendentes do turno (sem os atrasados), "conexões" e "sem resposta" contam os feitos hoje (dia em São Paulo), "atrasados" conta os pendentes liberados antes do turno de referência, e fora do horário de atendimento o turno mostra 0 de 0; sem sessão a resposta é 401

#### AC-464 — A próxima tarefa aparece em destaque, só com o que existe

- **Dado** uma fila com toques pendentes
- **Quando** a tela é renderizada
- **Então** o destaque "Próxima tarefa em execução" mostra o primeiro toque da fila: nome do lead, selo da etapa do card, "Atribuído a" (o responsável do card) e "Toque N de 18" com o tipo e o canal; o selo "SLA estimado" e o script da mensagem do protótipo **não aparecem** (sem dado); fila vazia mostra o destaque vazio "Nenhuma tarefa no turno"

#### AC-465 — Concluir o toque pela tela, com as regras da cadência

- **Dado** o toque em destaque ou uma linha da fila
- **Quando** o usuário usa "Concluir Toque com Sucesso" ou "Não Atendeu"
- **Então** o toque é concluído como "conectou" ou "sem resposta" pela API de concluir (`POST /api/atividades/[id]/concluir`, com a versão atual do card), a fila e os indicadores se atualizam, e se o turno não liberou, o bloco anterior está pendente, a cadência encerrou, o card mudou ou o usuário não tem permissão, a tela mostra a mensagem do motivo e nada muda

#### AC-466 — A fila ordenada mostra horário, lead, etapa, toque e ações

- **Dado** a fila com vários toques, atrasados e do turno
- **Quando** a tabela "Fila Ordenada do Turno" é renderizada
- **Então** cada linha mostra o horário em que o toque foi liberado, o lead com o responsável, o selo da etapa, "Toque #N — tipo · canal" e as ações (concluir com sucesso, não atendeu, abrir o card); os atrasados vêm primeiro, depois por horário de liberação; o contador do título diz quantos estão pendentes

#### AC-467 — Busca e paginação rodam sobre a fila

- **Dado** mais de 10 toques na fila
- **Quando** o usuário digita em "Filtrar nesta lista" ou troca de página
- **Então** a tabela mostra só os leads que casam com o texto, 10 por página, com "Exibindo N a M de T" e os botões de página, e sem resultado diz "Nenhum toque encontrado"

#### AC-468 — MASTER e GERENTE filtram por responsável; ATENDENTE só vê os seus

- **Dado** uma fila com cards de responsáveis diferentes
- **Quando** um MASTER ou GERENTE escolhe uma pessoa em "Responsável" (ou "Todos"), ou um ATENDENTE abre a tela
- **Então** o gerente vê só os toques dos cards dessa pessoa (`GET /api/atividades?responsavelId=`), o ATENDENTE não vê o filtro e a API devolve sempre só os cards dele, mesmo que ele passe o `responsavelId` de outra pessoa

#### AC-469 — A API da fila traz o horário de liberação e o responsável de cada toque

- **Dado** toques pendentes e atrasados
- **Quando** a tela pede a fila (`GET /api/atividades?atrasados=1`)
- **Então** cada item traz, além do que já trazia, o instante em que o toque foi liberado (`liberadaEm`) e o responsável do card (id e nome, ou nulo), sem quebrar nenhum campo que já existia; só toques da empresa da sessão, e sem sessão a resposta é 401

#### AC-470 — A fila se atualiza em tempo real

- **Dado** a fila aberta, ligada ao fluxo de eventos que já existe (`cadencia.fila_alterada`)
- **Quando** outro usuário conclui ou inicia um toque da mesma empresa
- **Então** a fila e os indicadores atualizam sem recarregar a página, e se a conexão cair a tela mostra o aviso "tempo real desconectado" e volta a atualizar ao reconectar

#### AC-471 — Itens do protótipo sem backend aparecem como "em breve" ou não aparecem

- **Dado** a fila do turno
- **Quando** o usuário olha "Bloco de 3 Toques", "Iniciar Próxima Ação (Play)" e o ícone de exportar a fila
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; "Tempo médio de resposta", "Alerta de cumprimento SLA" e as metas do protótipo **não aparecem** (sem dado)

### US-120 — Controlar os toques atrasados e resgatá-los (tela 14)

Como gerente ou atendente, quero ver os toques vencidos, quanto cada um atrasou
e quanto de receita está parada, concluir os que posso e passar os outros para
quem possa atender, para não perder oportunidade por falta de resposta.

#### AC-472 — A tela de atrasadas existe, dentro da casca, e o menu deixa de dar 404

- **Dado** um usuário com sessão
- **Quando** ele clica em "Tarefas Atrasadas" no menu (ou abre `/tarefas/atrasadas`)
- **Então** abre a tela dentro da casca, com o item do menu marcado e o título "Controle de Atrasos e Toques Vencidos", sem 404; sem sessão vai ao login

#### AC-473 — Os indicadores mostram atrasos, receita parada e o maior atraso

- **Dado** cards com toques atrasados, com valores diferentes
- **Quando** a tela é aberta
- **Então** os cartões mostram "Toques atrasados" (quantidade), "Receita (MRR) sob risco" (valor somado dos cards com ao menos um toque atrasado, sem repetir card, com o rótulo "/mês" e o ticket médio por card) e "Maior tempo de atraso" (em horas e minutos, com o nome do lead); sem atrasados mostram zero e traço; "Recuperação de SLA" do protótipo **não aparece** (sem dado)

#### AC-763 — Os quatro cartões de atrasos seguem o protótipo

- **Dado** a tela de tarefas atrasadas
- **Então** o topo tem quatro cartões como no protótipo — cada um com o rótulo, um ícone colorido, o número grande, uma linha de explicação e, embaixo de um traço, um dado de apoio: "Toques atrasados" (com a etiqueta "Crítico", ou "Em dia" quando zero, e os cards afetados), "Receita (MRR) sob risco" (com o ticket médio por card), "Maior tempo de atraso" (com o nome do lead e como a fila está ordenada) e "Cards em risco" (com a média de toques atrasados por card)
- **E** o cabeçalho ganha um ponto vermelho e a etiqueta "N casos em risco imediato" quando há atrasados, e some quando não há
- **E** o quarto cartão do protótipo ("Recuperação de SLA hoje") não existe no sistema: no lugar dele fica "Cards em risco", que o sistema sabe calcular; o "SLA de 4 horas", a "redistribuição" e o "plantão de resgate" do protótipo também não aparecem (sem dado ou regra)

#### AC-474 — A fila de resgate lista só os atrasados, do maior atraso para o menor

- **Dado** toques pendentes liberados antes do turno de referência
- **Quando** a tabela "Fila de Resgate Imediato" é renderizada
- **Então** cada linha mostra o tempo de atraso ("+3h 45m", em cor por faixa: até 1 h, de 1 a 4 h, acima de 4 h), o lead com o responsável e o telefone, o valor estimado do card ("/mês"), "Toque #N" com o canal e as ações; só entram toques atrasados, e a ordem padrão é o maior atraso primeiro

#### AC-475 — Filtros e ordenação restringem a fila de resgate

- **Dado** atrasados de responsáveis, etapas e atrasos diferentes
- **Quando** o usuário escolhe um atraso mínimo ("Todos", "mais de 1 h", "mais de 4 h"), um consultor, uma etapa do funil, a ordem (maior ou menor atraso) ou usa "Limpar"
- **Então** a tabela mostra só os toques que atendem a todos os filtros, na ordem pedida, os indicadores continuam os da fila inteira da empresa e o contador do título acompanha o filtro

#### AC-476 — Concluir um toque atrasado pela tela

- **Dado** uma linha da fila de resgate
- **Quando** o usuário usa "Concluir com sucesso" ou "Não atendeu"
- **Então** valem a mesma API e as mesmas mensagens de recusa do AC-465, e o toque sai da fila e dos indicadores

#### AC-477 — Reatribuir em lote os cards dos toques marcados

- **Dado** toques atrasados marcados (dois toques do mesmo card contam como um card) e um MASTER ou GERENTE
- **Quando** ele usa "Reatribuir em Lote", escolhe um responsável ativo da empresa e confirma
- **Então** os cards passam para essa pessoa pela reatribuição em lote do pipeline (`POST /api/oportunidades/lote/reatribuir`), a tela mostra "N reatribuídos" (e, se algum falhar, o motivo), a fila é relida, e o ATENDENTE vê o botão desabilitado

#### AC-478 — Itens do protótipo sem backend aparecem como "em breve" ou não aparecem

- **Dado** a tela de atrasadas
- **Quando** o usuário olha "Forçar Mutirão de Regularização", "Alertar Consultores", "Exportar Auditoria" e "Notificar Atraso Urgente"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; o bloco "Regra de governança automática" (transbordo por atraso), o "Plantão de Resgate" e "Executar Fila Expressa" **não aparecem** (não existem no sistema)

#### AC-479 — A tela de atrasadas se atualiza em tempo real

- **Dado** a tela aberta, ligada ao fluxo de eventos (`cadencia.fila_alterada`)
- **Quando** um toque é concluído ou um novo fica atrasado
- **Então** a fila e os indicadores atualizam sem recarregar a página

### US-121 — Ver a agenda de reuniões (tela 15)

Como gerente ou atendente, quero ver as reuniões comerciais num calendário, com
o resultado de cada uma e os números da semana, para acompanhar a presença e
reagir aos no-shows.

#### AC-480 — A agenda existe dentro da casca

- **Dado** um usuário com sessão
- **Quando** ele clica em "Agenda" no menu (ou abre `/agenda`)
- **Então** abre a tela dentro da casca, com o item do menu marcado e o título "Agenda de Reuniões Comerciais e No-Show", sem 404; sem sessão vai ao login

#### AC-481 — O servidor lista as reuniões de um período, só da empresa da sessão

- **Dado** reuniões de duas empresas, de closers e dias diferentes
- **Quando** a agenda pede um período (`GET /api/reunioes?de=&ate=&closerId=&status=`)
- **Então** voltam só as reuniões da empresa da sessão que caem no período (dia em São Paulo), cada uma com horário, status, lead, valor do card, etapa do card, closer (o responsável do card), resumo e anexo quando houver e, se foi remarcada, a ligação com a anterior; um ATENDENTE vê só as dos próprios cards; período inválido ou maior que 70 dias é 400, e sem sessão é 401

#### AC-482 — O status de cada reunião é derivado dos dados que existem

- **Dado** reuniões futuras, em curso, passadas sem resultado, concluídas, com no-show e remarcadas
- **Quando** a lista é montada
- **Então** cada uma tem um destes status: "Agendada" (ainda não começou), "Em andamento" (começou há até 60 minutos e sem resultado), "Aguardando resultado" (passou desse prazo sem resultado), "Realizada", "No-show" ou "Remarcada" (existe uma reunião mais nova ligada a ela), e o filtro por status devolve só as desse status

#### AC-483 — Os quatro indicadores da agenda vêm dos dados reais

- **Dado** reuniões da semana com resultados diferentes
- **Quando** a agenda é aberta (`GET /api/reunioes/resumo`)
- **Então** os cartões mostram "Reuniões agendadas hoje" (total do dia e quantas estão em andamento ou por vir), "Taxa de presença" da semana (realizadas ÷ (realizadas + no-show), ou traço sem nenhuma), "Ocorrências de no-show" (quantidade na semana e a porcentagem sobre as com resultado) e "Pipeline em demonstração" (valor somado dos cards em "Reunião agendada" e o número de contas); "MRR Ativo", metas e variações do protótipo **não aparecem** (sem dado)

#### AC-484 — As quatro visões do calendário e a navegação entre períodos

- **Dado** reuniões em vários dias
- **Quando** o usuário alterna entre "Lista", "Dia", "Semana" e "Mês" e usa anterior, "Hoje" e próximo
- **Então** a Lista mostra uma linha por reunião, o Dia mostra as reuniões por horário, a Semana mostra uma coluna por dia, o Mês mostra uma grade com a quantidade de reuniões em cada dia (clicar num dia abre o Dia), o intervalo mostrado acompanha a navegação, e a tela pede ao servidor só o período visível

#### AC-485 — Filtros por closer e por status

- **Dado** reuniões de closers e status diferentes
- **Quando** o usuário escolhe um closer e/ou um status ("Todos" volta ao completo) ou usa "Limpar"
- **Então** as visões mostram só as reuniões que atendem a todos os filtros, e os indicadores continuam os da semana inteira da empresa

#### AC-486 — A fila de reuniões de hoje mostra cada reunião só com o que existe

- **Dado** reuniões de hoje com status diferentes
- **Quando** a "Fila de Reuniões e Sessões Clínicas (Hoje)" é renderizada
- **Então** cada cartão mostra o horário, o lead, o valor do card ("/mês"), o closer, o selo do status (cor por status) e as ações que o status permite; reunião realizada mostra o resumo e o link "Abrir evidência" quando existirem; participantes, objetivo, tipo de sessão e link de sala do protótipo **não aparecem** (não existem no sistema)

#### AC-487 — A coluna da direita mostra a fila de resgate de no-shows e o desempenho por closer

- **Dado** reuniões com no-show cujo card segue em "No-show", e reuniões realizadas e perdidas por closers diferentes
- **Quando** a coluna da direita é renderizada
- **Então** "Fila de Resgate de No-Shows" lista esses leads (com quando faltaram e o closer) com a ação "Reagendar", e "Performance por Closer (Semana)" mostra, por closer, a taxa de reuniões realizadas sobre as com resultado, com "N/M"

#### AC-764 — A agenda segue o desenho do protótipo

- **Dado** a tela da agenda
- **Então** o topo tem a trilha "Operação comercial › Reuniões & demonstrações › /agenda", e os quatro cartões trazem rótulo, selo no canto ("Hoje"; "Atenção" quando há no-show), número grande, uma linha de apoio e uma barra de progresso embaixo (reuniões de hoje que já passaram, taxa de presença e percentual de no-show; o cartão do pipeline não tem barra, porque não há percentual natural)
- **E** a aba "Lista" mostra quantas reuniões o período tem, e o período mostrado ganha o ícone de calendário
- **E** cada reunião da fila de hoje tem a faixa colorida na borda pelo status (verde realizada, azul agendada e em andamento, âmbar aguardando resultado, vermelho no-show), um bloco de horário (com o fim, só quando a reunião terminou de fato), o status com ícone, e os botões separados por um traço; no-show ganha um fundo avermelhado
- **E** na lateral, as barras da performance por closer são verdes a partir de 90%, azuis a partir de 80% e âmbar abaixo disso, e cada no-show do resgate ganha a faixa vermelha
- **E** nada do que o protótipo traz sem dado no sistema aparece: variação da semana anterior (+4,5%), "Protocolo Anti-No-Show" com taxas de entrega, "aproveitamento de agenda", plano e contas do cliente, SDR, canal e link da sala

#### AC-488 — Itens do protótipo sem backend aparecem como "em breve" ou não aparecem

- **Dado** a agenda
- **Quando** o usuário olha "Google Meet / Outlook", "Entrar no Meet Agora", "Cancelar", "Transferir para Cadência de Resgate", "Disparar WhatsApp de Reagendamento", "Ligar para Clínica", "Confirmar Manualmente" e "Enviar Template Médico de Resgate"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; o "Protocolo Anti-No-Show" e o "aproveitamento de agenda" do protótipo **não aparecem** (não existem no sistema)

### US-122 — Agendar e acompanhar reuniões, movendo o card junto

Como atendente ou gerente, quero agendar, dar baixa e reagendar reuniões pela
agenda e ver o card seguir no funil, para a agenda e o pipeline nunca
discordarem.

#### AC-489 — Agendar cria a reunião e move o card para "Reunião agendada"

- **Dado** um card em "Qualificado p/ reunião" e um usuário que pode movê-lo
- **Quando** ele usa "+ Agendar Reunião", escolhe o card, a data e a hora e confirma (`POST /api/reunioes`)
- **Então** a reunião é criada com esse horário, o card vai para "Reunião agendada" pelas regras do funil e as duas coisas valem juntas (se o card não puder se mover, nada é gravado); a lista de cards do modal traz só os que estão em "Qualificado p/ reunião" (os do próprio usuário, para ATENDENTE)

#### AC-490 — Agendar recusa o que não pode

- **Dado** um pedido de agendamento
- **Quando** o horário já passou, o card não está em "Qualificado p/ reunião", o card é de outra empresa ou inexistente, ou não há sessão
- **Então** a API responde, respectivamente, 400 `DATA_NO_PASSADO`, 422 `CARD_NAO_PODE_AGENDAR`, 404 `OPORTUNIDADE_NAO_ENCONTRADA` e 401, sem criar reunião nem mover o card, e o modal mostra o motivo sem fechar

#### AC-491 — Registrar no-show marca a reunião e leva o card para "No-show"

- **Dado** uma reunião agendada cujo horário já passou, sem resultado
- **Quando** o usuário usa "Registrar No-Show" (`POST /api/reunioes/[id]/no-show`)
- **Então** a reunião fica marcada como no-show, o card vai para "No-show" pelas regras do funil e o status passa a "No-show"; antes do horário a API recusa (422 `AINDA_NAO_ACONTECEU`) e reunião que já tem resultado também (422 `REUNIAO_JA_TEM_RESULTADO`), sem alterar nada

#### AC-492 — Marcar como concluída exige a evidência e leva o card para "Reunião realizada"

- **Dado** uma reunião agendada sem resultado e um card com (ou sem) evidência enviada
- **Quando** o usuário usa "Marcar como Concluída" (`POST /api/reunioes/[id]/concluir`, com o resumo e o anexo de evidência)
- **Então** com a evidência válida do card, a reunião grava a data de encerramento, o resumo (até 2.000 caracteres) e o anexo, e o card vai para "Reunião realizada"; sem evidência a API recusa (422 `EVIDENCIA_OBRIGATORIA`) sem alterar nada, e a tela abre o mesmo modal de evidência do funil para enviar o anexo e tentar de novo

#### AC-493 — Reagendar cria uma nova reunião ligada à anterior

- **Dado** uma reunião agendada (ou com no-show) e uma nova data e hora futuras
- **Quando** o usuário usa "Reagendar" (`POST /api/reunioes/[id]/reagendar`)
- **Então** nasce uma nova reunião ligada à anterior; se o card estava em "No-show" ele volta para "Reunião agendada" pelas regras do funil, e se já estava em "Reunião agendada" fica onde está; a anterior passa a "Remarcada"; reunião já realizada (422 `REUNIAO_JA_TEM_RESULTADO`) ou horário no passado (400 `DATA_NO_PASSADO`) são recusados sem alterar nada

#### AC-494 — As ações da agenda respeitam empresa e papel

- **Dado** reuniões e cards de duas empresas, e usuários de papéis diferentes
- **Quando** qualquer ação da agenda (agendar, no-show, concluir, reagendar) é pedida
- **Então** reunião ou card de outra empresa é "não encontrado" sem revelar se existe, sem sessão é 401, um ATENDENTE só age sobre os próprios cards, e a mudança de etapa respeita o papel como no funil (a regra de um card)

#### AC-495 — Cada ação da agenda avisa o funil e a agenda de quem está olhando

- **Dado** a agenda e o funil de outra pessoa da mesma empresa abertos, ligados ao fluxo de eventos
- **Quando** uma reunião é agendada, tem no-show, é concluída ou reagendada (com mudança de etapa)
- **Então** o sistema emite o evento de card movido, só para a empresa dele, o funil da outra pessoa atualiza sem recarregar e a agenda relê o período visível

#### AC-496 — Os modais das ações guiam e tratam erros sem perder o que foi digitado

- **Dado** os modais "Agendar Reunião", "Reagendar" e "Marcar como Concluída"
- **Quando** o usuário deixa campo obrigatório vazio, a API recusa ou a rede falha
- **Então** o botão de confirmar fica desabilitado enquanto falta o dado ou enquanto envia, a mensagem do motivo aparece dentro do modal (em português, por código), o modal não fecha e o que foi digitado continua lá; ao dar certo o modal fecha e a agenda mostra a reunião no lugar certo

### US-123 — Navegar pelas três telas sem 404 e com estados de verdade

Como usuário, quero que todo item do menu desta feature abra uma tela de
verdade, com carregando, vazio e erro, para nunca cair numa página quebrada.

#### AC-497 — Os itens do menu desta feature apontam para páginas que existem

- **Dado** os itens "Tarefas do Turno", "Tarefas Atrasadas" e "Agenda" do menu lateral
- **Quando** o teste lê o `href` de cada um
- **Então** existe o arquivo de página do Next correspondente (`/tarefas`, `/tarefas/atrasadas` e `/agenda`, dentro de `src/app/(app)`), e a tela antiga `src/app/tarefas/page.tsx` não existe mais (sem rota duplicada)

#### AC-498 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das três telas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo ("Nenhuma tarefa no turno", "Nenhum toque atrasado", "Nenhuma reunião neste período") e uma mensagem de erro com "Tentar de novo"

#### AC-762 — A fila do turno e os atrasados têm altura fixa

- **Dado** a fila do turno ou o controle de atrasos, com muitos toques
- **Quando** a tela abre
- **Então** a página não cresce com a quantidade de toques: o quadro ocupa a altura da tela, o título, os indicadores, a próxima tarefa e os filtros ficam parados, e só a tabela dos toques rola por dentro, com o cabeçalho (Horário, Lead, Etapa…) fixo no topo dela
- **E** a paginação, e em atrasados a barra de ações dos selecionados, ficam sempre à vista embaixo

#### AC-765 — Conectar a conta Google da empresa

- **Dado** um gerente, master ou super admin na tela "Google Meet" (Administração), com as credenciais do Google no servidor
- **Quando** ele clica em "Conectar com o Google", entra com a conta da empresa (ex.: contato@medguia.com.br) e autoriza
- **Então** o Google o devolve à tela, a conta fica guardada para a empresa — o e-mail visível, o token cifrado e nunca mostrado — e a tela mostra "Conectado" com a conta
- **E** o endereço de retorno enviado ao Google é montado a partir do endereço pelo qual o gerente acessou o CRM (cabeçalhos do proxy), e não de uma variável gravada na imagem no build — assim o staging e a produção, que usam a mesma imagem, mandam cada um o seu endereço; a troca do código usa o mesmo endereço do início da conexão
- **E** a volta do Google só vale com o código de segurança que foi criado no início da conexão (cookie de 10 minutos); código errado, cancelamento, recusa do Google, resposta sem o e-mail ou sem permissão offline, e servidor sem o segredo de cifra viram um aviso na tela e nada é guardado
- **E** sem as credenciais do Google no servidor, a tela explica o que falta (passo a passo no runbook) e não oferece conectar; atendente não acessa a tela nem a API de conexão

#### AC-766 — Ver o estado da conexão e desconectar

- **Dado** a empresa com ou sem conta Google conectada
- **Então** a agenda mostra no topo "Google Meet" com um ponto verde quando há conta (a conta aparece ao passar o mouse), ou "Conectar Google Meet", que leva à configuração, quando não há; enquanto não se sabe o estado, o botão segue "em breve"
- **E** qualquer papel vê o estado; só a gestão vê e usa a conexão; cada empresa vê só a sua; o token nunca sai do servidor
- **E** "Desconectar" (com confirmação) tira a permissão no Google, apaga o token e a conta; as reuniões novas passam a nascer sem sala, e as já criadas continuam no Calendar

#### AC-767 — Cada reunião agendada ganha a sala do Meet e o convite

- **Dado** o Google conectado e um card em "Qualificado p/ reunião"
- **Quando** a reunião é agendada
- **Então** é criado no Calendar da conta conectada o evento "Demonstração MedGuia — <lead>", com a hora da reunião, duração de 1 hora, a sala do Google Meet, e o convite por e-mail ao lead (se tiver e-mail válido) e ao closer — sem repetir e-mail, sem convidar a própria conta, sem e-mail inválido — e o link da sala fica guardado na reunião
- **E** na agenda, a reunião agendada mostra o endereço da sala e o botão "Link da Sala" (copia o endereço); a em andamento mostra "Entrar no Meet Agora", que abre a sala em outra aba
- **E** uma reunião sem sala, com o Google conectado, oferece "Gerar link do Meet" (reunião agendada ou em andamento, só em card em que o usuário pode agir; reunião que já tem sala devolve a que tem, sem criar outra); sem o Google conectado o botão da sala segue "em breve"

#### AC-768 — Reagendar mantém a mesma sala

- **Dado** uma reunião com sala do Meet
- **Quando** ela é reagendada
- **Então** o evento do Calendar muda para o novo horário (e os convidados são avisados), a reunião nova herda o evento e o link, e nenhum evento novo é criado; se a reunião antiga nunca teve sala, a nova ganha uma

#### AC-769 — Cancelar apaga o evento

- **Dado** uma reunião agendada com evento no Calendar
- **Quando** ela é cancelada
- **Então** o evento sai do Calendar (e os convidados são avisados); se o Google não responder, a reunião é cancelada do mesmo jeito

#### AC-770 — A agenda nunca depende do Google

- **Dado** o Google fora do ar, sem conexão, ou com as credenciais do servidor ausentes
- **Então** agendar, reagendar e cancelar funcionam como sempre, a reunião fica sem link, e a tela mostra o motivo quando o usuário pede "Gerar link do Meet" ("O Google não respondeu" ou "O Google Meet ainda não está conectado")

## Fora de escopo

- **Integrações externas:** Google Meet e Outlook (link de sala, "Entrar no Meet", sincronização de calendário) e os lembretes automáticos por WhatsApp e e-mail do "Protocolo Anti-No-Show": não existem no sistema; aparecem "em breve" ou somem.
- **Cancelar reunião** e **Transferir para cadência de resgate**: dependem de decisões de produto (Q-052); ficam "em breve".
- **Bloco de 3 Toques**, **Iniciar Próxima Ação (Play)** e exportações (fila, auditoria): sem backend; "em breve".
- **Regras de governança automática de atraso** (transbordo após 4 horas, penalidade de ranking), **plantão de resgate com rodízio** e **Forçar Mutirão**: não existem no sistema.
- **SLA por toque, tempo médio de resposta e metas** (presença acima de 80%, etc.): não há fonte de dado nem meta oficial (Q-051); não aparecem.
- **Participantes, objetivo, tipo de sessão e SDR da reunião**: a tabela `reunioes` não guarda; saem.
- **Notificação ao consultor** (WhatsApp, push) e **disparo de template de resgate**: "em breve".
- **Edição de uma reunião** (mudar só observação ou duração): fora; reagendar cria outra.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-157 | Os turnos e as janelas são os do sistema (manhã 08h–12h, tarde 13h–18h, dias úteis sem feriado nacional); o protótipo escreve "tarde 14h–18h", que não é o que a cadência implementa | aberta | O turno de referência já existe em `domain/cadencia` e `inicioDoTurnoDeReferencia` |
| ASM-158 | "Toques do turno N/M": N = toques concluídos (conectou ou sem resposta) feitos dentro do turno vigente de hoje; M = N + pendentes liberados no turno vigente (sem os atrasados); fora de turno é 0/0 | aberta | O protótipo mostra "12/24" sem dizer o que é o 24 |
| ASM-159 | "Conexões efetivas hoje" = toques `conectou` realizados hoje; "Sem resposta hoje" = `sem_resposta` realizados hoje (dia em São Paulo) | aberta | O protótipo fala em "reuniões/contatos"; usamos o resultado do toque |
| ASM-160 | O atraso de um toque é "agora menos o instante em que foi liberado" (`liberada_em`); "maior atraso" é o maior entre os pendentes atrasados | aberta | A coluna `liberada_em` já guarda o instante de liberação (fase2b) |
| ASM-161 | "Receita sob risco" = soma do valor dos cards (cada um uma vez) com ao menos um toque atrasado, rotulada "/mês" como no resto do sistema (ASM-136); ticket médio = soma ÷ número de cards | aberta | O sistema guarda um único `valor` por card |
| ASM-162 | A cor do atraso é só visual (até 1 h âmbar, de 1 h a 4 h laranja, acima de 4 h vermelho); não há regra de SLA nem consequência automática | aberta | O "SLA de 4 h" do protótipo vira apenas uma faixa de cor |
| ASM-163 | ATENDENTE vê só os cards dos quais é responsável (mesma regra da fila, ASM-061) na fila, nas atrasadas e na agenda; MASTER, GERENTE e super admin veem a empresa inteira, com filtro por pessoa | aberta | Reaproveita `podeVerTodoTenant` |
| ASM-164 | O status da reunião é derivado, sem coluna nova: `no_show`, `encerrada_em`, o horário agendado e uma duração padrão de 60 minutos para "em andamento" (a coluna `duracao_minutos` existe mas nada a preenche); "Remarcada" = existe outra reunião cujo `remarcada_de` é esta | aberta | Evita migration |
| ASM-165 | O closer da reunião é o responsável do card; quem a agendou, os participantes, o objetivo, o tipo e o link da sala não existem no modelo e não aparecem | aberta | O protótipo desenha esses campos; o sistema não os guarda |
| ASM-166 | Agendar só vale para card em "Qualificado p/ reunião" (transição 6→8 do grafo); reagendar de "No-show" faz 9→8; concluir faz 8→10, que exige a evidência (anexo do card) como já exige no funil; registrar no-show faz 8→9 e só vale depois do horário marcado | aberta | Vem do grafo cadastrado em `pipeline_transicoes` (seed 0005) |
| ASM-167 | A visão Mês mostra a quantidade de reuniões por dia (e abre o Dia ao clicar), não os cartões; o período máximo que a API aceita é 70 dias (cobre a grade do mês) | aberta | Limite simples; a tela pede só o período visível |
| ASM-168 | Dias e horários são sempre em `America/Sao_Paulo` (sem horário de verão desde 2019) | aberta | Mesmo padrão de `kpis.ts` e `cadencia.ts` |
| ASM-169 | A página antiga `/tarefas` (T-097) é substituída pela nova; os componentes da fase2b (`fila-tarefas.tsx`, `toque-item.tsx`) e os testes deles (AC-204 a AC-221) **ficam como estão**, sem apagar nenhuma prova, e a tela nova tem os próprios testes; o AC-213 (atrasados como seção da mesma tela) segue provado no componente antigo | aberta | A constituição proíbe apagar a prova de critério de outra feature |
| ASM-170 | Esta feature não cria migration: usa as colunas que `reunioes` já tem (`agendada_para`, `encerrada_em`, `resumo`, `anexo_id`, `no_show`, `remarcada_de`) | aberta | Se aparecer lacuna, vira pergunta |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-051 | Existem metas oficiais para mostrar nos indicadores (taxa de presença mínima, tempo máximo de atraso por toque, SLA de resposta)? O protótipo cita "meta > 80%", "abaixo de 10 minutos" e "SLA de 4 horas", mas nada disso existe no sistema | aberta | — |
| Q-052 | Ao **cancelar** uma reunião, o que acontece com o card: volta para "Qualificado p/ reunião", fica em "Reunião agendada" sem data, ou vai para "Perdido" com motivo? Enquanto isso, "Cancelar" fica "em breve" | aberta | — |
