# Spec: Fase 4 — Ações em lote e exportação do pipeline

> feature: fase4-pipeline-lote
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

Quarta e última das features do pipeline que colocam o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. A lista
(`/pipeline/lista`, tela 7) e os arquivados (`/pipeline/arquivados`, tela 8) já
existem (`fase4-pipeline-telas`), mas as ações que o protótipo traz para vários
cards de uma vez aparecem "em breve": **Mover Etapa em Lote**, **Reatribuir
Comercial**, **Arquivar** (e **Disparar WhatsApp**) na barra de seleção da
lista, e **Exportar CSV/XLS** na lista e nos arquivados. Esta feature faz essas
ações funcionarem, com backend próprio: hoje só existe a transição de **um**
card (`POST /api/oportunidades/[id]/transicao`) e **não existe** endpoint para
reatribuir responsável nem para exportar.

Decisões do usuário nesta feature (27/10): (1) entram **Mover, Reatribuir e
Arquivar**; **Disparar WhatsApp em lote fica "em breve"** (mensagem em massa
pode derrubar o número do WhatsApp e exige regras de consentimento e limite);
(2) numa ação em lote, o sistema **aplica nos cards que dão e lista os que não**
(cada card é processado sozinho, nada fica pela metade dentro de um card);
(3) **só MASTER e GERENTE exportam**, em **CSV**, com **tudo que atende aos
filtros atuais** (não só a página), e **cada exportação fica registrada** (quem,
quando, quantas linhas), porque o arquivo leva nome, telefone e e-mail dos
leads.

Regras herdadas: a marcação e as classes do `code.html` do protótipo são a
referência; blocos sem dado são removidos; ações sem backend ficam "em breve".
Lições das features anteriores: critérios de tela dizem o que a tela mostra, e
cada tela é conferida no navegador contra o protótipo antes da PR; uma rota de
tela não pode prometer o que o backend recusa.

Esta feature também leva a correção da mensagem da aba Cadência (commit
`dc92118`, já com teste): ela ficou de fora do merge da PR #38 por não ter sido
enviada a tempo.

## Histórias

### US-115 — Mover vários cards de etapa de uma vez

Como atendente, gerente ou master, quero marcar vários cards na lista e movê-los
para uma etapa, para não repetir a mesma mudança card a card.

#### AC-445 — Marcar cards mostra a barra de ações em lote com o que funciona

- **Dado** a lista com cards
- **Quando** o usuário marca um ou mais cards (ou o cabeçalho da tabela)
- **Então** a barra mostra "N selecionados" e as ações "Mover Etapa em Lote", "Reatribuir Comercial", "Iniciar Cadência" (AC-759) e "Arquivar" **funcionando**; "Disparar WhatsApp" aparece marcada "em breve" e não dispara nada; sem nada marcado a barra some

#### AC-446 — Mover em lote usa as mesmas regras da transição de um card

- **Dado** cards em etapas diferentes e um usuário autenticado
- **Quando** ele pede para mover os selecionados para uma etapa (`POST /api/oportunidades/lote/mover` com os ids e a etapa de destino)
- **Então** cada card é movido só se a regra de um card permitiria (a etapa de destino está no grafo a partir da etapa dele, o papel do usuário pode fazer essa transição e os dados obrigatórios da etapa estão preenchidos); o servidor lê a versão atual de cada card na hora, e a resposta diz, por card, se foi movido ou o código do motivo

#### AC-447 — Falha parcial: aplica nos que dão e lista os que não

- **Dado** uma seleção em que alguns cards não podem ir para a etapa escolhida (fora do grafo, papel sem permissão ou falta valor, próxima ação, motivo ou evidência)
- **Quando** o lote termina
- **Então** a tela mostra "N movidos, M não movidos" com o nome do lead e o motivo em português de cada um que falhou; os movidos já aparecem na etapa nova na lista, e os que falharam continuam marcados para o usuário corrigir

#### AC-448 — O lote nunca mexe em card de outra empresa e respeita os limites

- **Dado** uma lista de ids com cards da empresa da sessão, de outra empresa e inexistentes
- **Quando** o pedido de lote chega (mover, reatribuir ou arquivar)
- **Então** os de outra empresa e os inexistentes voltam como "não encontrado" naquele card, sem revelar se existem e sem alterar nada; lista vazia ou com mais de 100 ids é recusada (400) antes de tocar no banco, e sem sessão a resposta é 401

#### AC-449 — Cada card movido em lote avisa o funil de quem está olhando

- **Dado** o funil de outra pessoa da mesma empresa aberto, ligado ao fluxo de eventos
- **Quando** um lote move 3 cards
- **Então** o sistema emite um evento de card movido por card movido (o mesmo evento da transição de um card), só para a empresa dele, e o funil da outra pessoa atualiza sem recarregar

### US-116 — Reatribuir o comercial de vários cards

Como gerente ou master, quero passar vários cards para outro responsável de uma
vez, para redistribuir a carteira quando alguém sai ou muda de função.

#### AC-450 — Reatribuir muda o responsável de todos os selecionados

- **Dado** cards selecionados na lista e um usuário MASTER ou GERENTE
- **Quando** ele escolhe um responsável na lista de pessoas ativas da empresa e confirma (`POST /api/oportunidades/lote/reatribuir`)
- **Então** todos os cards passam a ter esse responsável, a lista mostra o novo nome na coluna de responsável, e o resultado diz "N reatribuídos"

#### AC-451 — Só MASTER e GERENTE reatribuem, e só para gente ativa da própria empresa

- **Dado** um ATENDENTE, ou um responsável que é de outra empresa ou está inativo
- **Quando** o pedido de reatribuição chega
- **Então** o ATENDENTE vê "Reatribuir Comercial" desabilitado e a API recusa (403) sem alterar nada; um responsável de outra empresa ou inativo é recusado (400 `RESPONSAVEL_INVALIDO`) sem alterar nada

#### AC-452 — Cada reatribuição fica no histórico do card

- **Dado** um card reatribuído em lote
- **Quando** o usuário abre o detalhe do card
- **Então** a linha do tempo mostra o evento "Responsável alterado" com quem estava antes, quem ficou e quem fez a mudança

### US-117 — Arquivar vários cards de uma vez

Como gerente, quero marcar vários cards como perdidos de uma vez, com o motivo,
para limpar o funil de leads que não vão avançar.

#### AC-453 — Arquivar leva os selecionados para "Perdido" com o motivo escolhido

- **Dado** cards selecionados na lista
- **Quando** o usuário escolhe um motivo de perda, confirma "Arquivar" e o lote roda (`POST /api/oportunidades/lote/arquivar`)
- **Então** cada card vai para a etapa "Perdido" com esse motivo, pelas mesmas regras da transição de um card (os que não puderem aparecem na lista de falhas), sai da lista e passa a aparecer em `/pipeline/arquivados` com o motivo

#### AC-454 — Arquivar exige o motivo e confirma antes de agir

- **Dado** a ação "Arquivar" aberta
- **Quando** o usuário não escolheu motivo, ou ainda não confirmou
- **Então** o botão de confirmar fica desabilitado sem motivo, a confirmação diz quantos cards serão arquivados e pede um segundo clique, e a API recusa (400 `MOTIVO_OBRIGATORIO`) um pedido sem motivo sem alterar nada

### US-118 — Exportar a carteira em CSV

Como gerente, quero baixar em CSV os cards que estou vendo (com os filtros
aplicados), para analisar fora do sistema.

#### AC-455 — Exportar a lista baixa um CSV com tudo que atende aos filtros

- **Dado** a lista com filtros de etapa, responsável, origem ou busca, e mais cards do que cabem numa página
- **Quando** um MASTER ou GERENTE usa "Exportar CSV" (`GET /api/oportunidades/lista/exportar` com os mesmos filtros da tela)
- **Então** baixa um arquivo `pipeline-lista-AAAA-MM-DD.csv` com **todos** os cards que atendem aos filtros (não só a página), uma linha por card, com as colunas Lead, Telefone, E-mail, Origem, Etapa, Responsável, Valor, Próxima ação e Criado em

#### AC-456 — Exportar os arquivados respeita a aba e os filtros

- **Dado** a tela de arquivados com uma aba (Todos, Ganhos ou Perdidos) e filtros de busca, motivo, consultor e data
- **Quando** um MASTER ou GERENTE usa "Exportar CSV" (`GET /api/oportunidades/arquivados/exportar`)
- **Então** baixa `pipeline-arquivados-AAAA-MM-DD.csv` só com os cards que atendem à aba e aos filtros, com as colunas Lead, Status, Consultor, Valor, Motivo da perda e Data de fechamento

#### AC-457 — Só MASTER e GERENTE exportam, e só da própria empresa

- **Dado** um ATENDENTE, um visitante sem sessão e cards de duas empresas
- **Quando** a exportação é pedida
- **Então** o ATENDENTE não vê o botão "Exportar CSV" e a API responde 403, o visitante recebe 401, e o arquivo de MASTER ou GERENTE só traz cards da empresa da sessão, mesmo que a URL tente passar `empresaId`

#### AC-458 — O arquivo abre certo no Excel e não executa fórmulas

- **Dado** cards com acento, valor decimal, ponto e vírgula, aspas ou quebra de linha nos textos e um nome de lead que começa com `=`, `+`, `-` ou `@`
- **Quando** o CSV é gerado
- **Então** o arquivo é UTF-8 com marca de ordem (BOM), usa ponto e vírgula como separador, protege com aspas os campos que precisam, mostra datas como dd/mm/aaaa hh:mm e valor com vírgula decimal, e todo campo de texto que começaria com `=`, `+`, `-` ou `@` sai com um apóstrofo na frente (para o Excel não tratar como fórmula)

#### AC-459 — Há um teto de linhas e cada exportação fica registrada

- **Dado** uma exportação de MASTER ou GERENTE
- **Quando** ela é gerada, e quando os filtros casam mais de 5.000 cards
- **Então** cada exportação gera um registro com quem exportou, quando, qual tela (lista ou arquivados), os filtros usados e quantas linhas saíram (só da empresa da sessão, e visível só para quem tem acesso a essa empresa); acima do teto a API recusa (422 `LIMITE_EXCEDIDO`) e a tela diz "Muitos cards para exportar: refine os filtros", sem gerar arquivo e sem registrar uma exportação que não aconteceu

#### AC-460 — A tela mostra o andamento da exportação e o erro

- **Dado** o botão "Exportar CSV" na lista e nos arquivados
- **Quando** o usuário clica, e quando não há nenhum card que atenda aos filtros ou a API falha
- **Então** o botão mostra "Gerando..." e fica desabilitado enquanto baixa; sem cards a API responde 422 `NADA_PARA_EXPORTAR` (nada é registrado) e a tela diz "Nenhum card para exportar com estes filtros" e não baixa nada; na falha mostra a mensagem do motivo e o botão volta ao normal

### US-119 — Iniciar a cadência de vários cards de uma vez

Como atendente ou gerente, quero iniciar a cadência de muitos cards de "Entrada de leads" de uma vez, para que as tarefas do turno apareçam sem eu abrir um card por vez (principalmente depois da migração, quando todos chegam sem toques).

#### AC-759 — Iniciar Cadência nos selecionados e em massa no funil

- **Dado** a lista com cards marcados, ou o funil com cards em "Entrada de leads"
- **Quando** o usuário clica em "Iniciar Cadência" na barra da lista, ou em "Iniciar Cadência em Massa" no funil, e confirma na janela que diz quantos cards são
- **Então** cada card de "Entrada de leads" sem toques vai para "1º dia de contato" e ganha o primeiro bloco do turno (como AC-756), e a tela mostra "N com a cadência iniciada, M sem a cadência iniciada", com o nome de cada card recusado e o motivo
- **E** no funil o pedido leva todos os cards de "Entrada de leads" que o filtro deixa à vista, em pedaços de 100; cancelar não envia nada; sem cards na Entrada de leads o botão fica desabilitado

#### AC-760 — Regras do lote de cadência

- **Dado** o pedido `POST /api/oportunidades/lote/iniciar-cadencia` com uma lista de ids
- **Então** card fora de "Entrada de leads" falha com `CADENCIA_SO_EM_ENTRADA`, card que já tem toques falha com `CADENCIA_JA_INICIADA`, card de outra empresa, inexistente ou id inválido falha como "não encontrado", e versão que mudou no meio falha com `CONFLITO_DE_VERSAO` — cada um sozinho, sem desfazer nem travar os outros; id repetido conta uma vez
- **E** lista vazia, com mais de 100 ids ou que não é lista é 400 e sem sessão é 401, antes de tocar em qualquer card

## Fora de escopo

- **Disparar WhatsApp em lote**: continua "em breve" (Q-050).
- **XLS**: o protótipo diz "CSV/XLS"; o botão passa a dizer "Exportar CSV".
- **Selecionar além da página** ("selecionar os 148 leads"): a seleção vale só para a página aberta (até 50 cards).
- **Preencher o dado que falta** dentro do lote (valor, próxima ação, evidência): o card que não puder é listado e o usuário o corrige no próprio card.
- **Desfazer** uma ação em lote.
- **Reatribuir distribuindo entre vários responsáveis** (rodízio): um responsável para todos.
- **Exportar os cards do funil** (tela 6), o dossiê de anexos (ZIP) e o relatório da cadência (PDF): outras telas, continuam "em breve".
- **Tela para consultar o registro de exportações**: nesta feature o registro só é gravado (a consulta fica para a feature de administração).

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-149 | A seleção da lista vale só para a página aberta (até 50 cards) e se limpa a cada recarga; o servidor aceita até 100 ids por pedido | aberta | Limite simples; "selecionar tudo" de várias páginas fica para depois |
| ASM-150 | No lote de mover, um único destino vale para todos; card que exige dado que não foi informado (valor, próxima ação, motivo, evidência) falha com o código do dado faltante e é listado, sem formulário em lote | aberta | O usuário corrige esse card no detalhe |
| ASM-151 | O servidor lê a versão atual de cada card imediatamente antes de aplicar a transição e chama a mesma função da transição de um card; se alguém mexer no card no meio, ele falha com `CONFLITO_DE_VERSAO` e entra na lista de falhas | aberta | Sem travar o lote inteiro por uma disputa em um card |
| ASM-152 | Reatribuir só MASTER e GERENTE (regra nova: antes não existia endpoint); o super admin segue como MASTER | aberta | O ATENDENTE não redistribui carteira |
| ASM-153 | A reatribuição grava um evento `reatribuicao` no histórico de cada card (de quem, para quem, quem fez), sem tabela nova de histórico | aberta | A coluna `tipo` de `oportunidade_eventos` é texto livre; confirmar na tarefa |
| ASM-154 | "Arquivar" = transição para "Perdido" (etapa 14) com o motivo escolhido; cards em "Contrato (Ganho)" não aparecem na lista, então não são alvo | aberta | Reaproveita a regra de transição, que já exige motivo para "Perdido" |
| ASM-155 | O CSV usa ponto e vírgula, UTF-8 com BOM, datas dd/mm/aaaa hh:mm, valor com vírgula decimal e telefone brasileiro no formato `(DD) NNNNN-NNNN` (o `+55…` do cadastro viraria fórmula e notação científica no Excel); o teto é de 5.000 linhas por exportação | aberta | Número escolhido por ser folgado para a carteira atual; trocar é uma constante |
| ASM-156 | O registro de exportações é uma tabela nova `auditoria_exportacoes` (migration 0014), com isolamento por empresa como as demais tabelas; a migration entra na lista de pendências do cutover, junto da 0012 e da 0013 | aberta | O registro pedido pelo usuário não cabe em nenhuma tabela existente |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-050 | Quando o disparo de WhatsApp em lote entrar, quais regras valem: limite de mensagens por vez, intervalo entre elas, exigir consentimento do lead e uso de templates aprovados? | aberta | — |
