# Spec: Fase 4 — Campanhas: lista, nova campanha e detalhe (telas 20 a 22)

> feature: fase4-campanhas
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
**telas 20 a 22 do inventário** (`docs/ui/inventario-telas.md`): a **lista de
campanhas** (`/campanhas`), a **nova campanha / edição de rascunho**
(`/campanhas/nova`) e o **detalhe e acompanhamento** (`/campanhas/[id]`).

Situação hoje (conferida no código em 28/10):

- O item "Campanhas" do menu leva a `/campanhas`, que **não existe** no sistema
  novo (404). As três telas do sistema antigo (`src/components/campanhas/*`) são
  legadas, não estão ligadas a nenhuma página e não seguem o novo visual.
- O backend de campanhas (fase2d) já existe e é isolado por empresa: listar
  (`GET /api/campanhas`), criar em rascunho com os destinatários de uma planilha
  ou de **uma** etapa do funil (`POST /api/campanhas`), detalhe com destinatários e
  contagem por status (`GET /api/campanhas/[id]`), editar nome, assunto e corpo
  enquanto é rascunho (`PATCH`), excluir (`DELETE`), Play (`/iniciar`) e reenviar
  falhas (`/reenviar-falhas`). Só MASTER, GERENTE e super admin acessam; ATENDENTE
  não.
- Quem **envia** os e-mails é um motor externo (Python): o CRM só libera a fila
  (`PENDENTE`) e acompanha. O webhook do Resend leva o destinatário a `ABERTO` e
  `CLICADO`. O sistema **não guarda** a hora da abertura nem do clique, nem o tipo
  de falha (soft/hard bounce), nem o link clicado.
- A lista de campanhas não traz as contagens por status nem os indicadores; a
  origem por etapa aceita só uma etapa (o protótipo escolhe várias).

Regras herdadas: a marcação e as classes do `code.html` de cada tela são a
referência; **blocos que mostram dado inexistente no sistema são removidos** e
**ações sem backend aparecem visíveis e marcadas "em breve"**. Lições das features
anteriores: critérios de tela dizem o que a tela mostra; todo item do menu aponta
para uma página que existe (e um teste confere); antes da PR, a suíte inteira
passa, não só os critérios da feature; a prova (`verify`) é gerada no código final
e commitada junto.

## Histórias

### US-129 — Acompanhar as campanhas na lista (tela 20)

Como gerente ou master, quero ver todas as campanhas da empresa, com o andamento e
os resultados de cada uma, para decidir o que abrir, continuar ou excluir.

#### AC-532 — A lista abre dentro da casca, só para quem pode

- **Dado** um usuário com sessão
- **Quando** ele abre `/campanhas` (ou clica em "Campanhas" no menu)
- **Então** vê o menu e o topo da casca com "Campanhas" marcado e o título "Campanhas de Comunicação & Mala Direta"; sem sessão vai ao login; o ATENDENTE vê a mensagem "Campanhas são para gerente e master" em vez da lista (a API já recusa com 403)

#### AC-533 — O servidor devolve cada campanha com as contagens, filtros e paginação

- **Dado** campanhas de duas empresas, com destinatários em vários status
- **Quando** a tela pede `GET /api/campanhas?status=&busca=&dias=&pagina=&porPagina=`
- **Então** voltam só as da empresa da sessão, da mais nova para a mais antiga, cada uma com os campos de sempre (`id`, `nome`, `assunto`, `status`, `totalDestinatarios`) mais `criadoEm` e `contagens` (rascunho, pendente, enviado, aberto, clicado e erro); `status` aceita `rascunho`, `enviando` e `concluida`, `busca` procura no nome e no assunto, `dias` limita pela data de criação (7, 30 ou 90), e com `pagina` e `porPagina` a resposta traz também o `total` filtrado; sem esses parâmetros devolve todas, como antes; valor inválido é 400; sem sessão é 401 e ATENDENTE é 403

#### AC-534 — Os quatro indicadores do topo vêm dos envios reais

- **Dado** envios com datas e status diferentes
- **Quando** a lista é pedida
- **Então** a resposta traz `resumo` com `disparosNoMes` (envios com data de envio no mês atual, em São Paulo), `taxaEntrega` (enviados ÷ (enviados + falhas)), `taxaAbertura` (abertos e clicados ÷ enviados) e `taxaCliques` (clicados ÷ enviados), em porcentagem com uma casa decimal, ou `null` quando não há base; "enviado" conta os status ENVIADO, ABERTO e CLICADO; e a tela mostra os quatro cartões, sem comparação com o mês anterior, "Alta Relevância", "DKIM/SPF" nem "links & minutos" do protótipo (sem dado)

#### AC-535 — A tabela mostra o andamento de cada campanha

- **Dado** a lista carregada
- **Quando** a tabela é renderizada
- **Então** cada linha mostra o nome e o assunto, o total de destinatários, o selo de status ("Rascunho", "Enviando" com a barra de progresso e "% concluído", ou "Concluída"), "enviados / total" (com "na fila: N" e "N falhas" quando houver), a abertura e os cliques em porcentagem sobre os enviados (traço quando não enviou nada), a data de criação e as ações; o código "CMP-xxxx", a segmentação em texto e "Pausada" do protótipo **não aparecem** (não existem)

#### AC-536 — Filtros, busca e paginação

- **Dado** mais de 10 campanhas
- **Quando** o usuário escolhe um status, digita na busca, escolhe "Últimos 7/30/90 dias", usa "Limpar" ou troca de página
- **Então** a tela pede ao servidor só o recorte pedido (10 por página), mostra "Mostrando N a M de T campanhas registradas" e os botões de página, e sem resultado diz "Nenhuma campanha encontrada"; o filtro "Todos os Tipos" do protótipo **não aparece** (não há tipo de campanha)

#### AC-537 — Abrir, criar e excluir

- **Dado** a lista
- **Quando** o usuário clica numa campanha, em "+ Nova Campanha" ou no ícone de excluir
- **Então** abrir leva a `/campanhas/[id]`, "+ Nova Campanha" leva a `/campanhas/nova`, e excluir pede confirmação mostrando o nome, chama `DELETE /api/campanhas/[id]` e relê a lista; campanha "Enviando" não tem o botão de excluir (a API recusa com 409 `CAMPANHA_EM_ENVIO`, e a tela mostra o motivo se isso acontecer)

#### AC-538 — A lista se atualiza enquanto há envio e o resto fica "em breve"

- **Dado** a lista com campanha em "Enviando"
- **Quando** passam 15 segundos, ou o usuário olha "Exportar Histórico (CSV)" e "Auditar Entregabilidade"
- **Então** a lista e os indicadores são relidos sozinhos (só enquanto houver campanha enviando); os dois itens aparecem visíveis, marcados "em breve", sem disparar ação; o bloco "Governança de Entregabilidade" (score, SPF, DKIM, DMARC, IP) **não aparece** (o CRM não tem esses dados)

### US-130 — Criar e editar uma campanha em rascunho (tela 21)

Como gerente ou master, quero montar a campanha escolhendo para quem vai e o texto
do e-mail, para só então revisar e disparar.

#### AC-539 — A tela abre dentro da casca, para criar ou editar

- **Dado** um usuário com sessão que pode acessar campanhas
- **Quando** ele abre `/campanhas/nova` (ou `/campanhas/nova?rascunho=<id>` pelo "Editar" do detalhe)
- **Então** vê o título "Nova Campanha de Comunicação Médica" (ou "Editar Campanha"), o botão "Voltar para Campanhas" (`/campanhas`) e as três seções; sem sessão vai ao login; ao editar, a tela carrega nome, assunto e corpo do rascunho, e a seção de destinatários mostra só "Destinatários já definidos: N" (não se muda quem recebe)

#### AC-540 — O servidor conta os destinatários das etapas escolhidas antes de criar

- **Dado** leads com e-mail, repetidos e sem e-mail, em várias etapas do funil e em outra empresa
- **Quando** a tela pede `GET /api/campanhas/previa-destinatarios?etapaIds=7,9,10`
- **Então** a resposta traz `porEtapa` (a quantidade de leads com e-mail válido em cada etapa pedida), `total` (e-mails únicos entre todas as etapas pedidas, sem os inválidos e sem repetir) e `valorEmPipeline` (a soma do valor dos cards dessas etapas, cada lead uma vez), só da empresa da sessão; `etapaIds` ausente, vazio ou fora das 15 etapas é 400; sem sessão é 401 e ATENDENTE é 403

#### AC-541 — A campanha pode nascer de várias etapas do funil

- **Dado** cards com e-mail em etapas diferentes
- **Quando** a tela cria a campanha (`POST /api/campanhas`) com origem `{ "tipo": "etapas", "etapaIds": [..] }`
- **Então** os destinatários são os leads com e-mail válido de todas essas etapas, sem repetir e-mail (os inválidos e os repetidos são contados como descartados, como na origem de uma etapa só), só da empresa da sessão; a origem de uma etapa (`etapa`) e a de planilha continuam funcionando como antes; `etapaIds` vazio ou com valor que não é inteiro é 400

#### AC-542 — A seção de destinatários mostra as etapas com a contagem real

- **Dado** a seção "Segmentação de destinatários"
- **Quando** o usuário marca e desmarca etapas, ou troca para "Lista colada" (nome e e-mail por linha)
- **Então** cada etapa aparece com a quantidade de leads com e-mail, "Destinatários qualificados" mostra o total único da prévia (com "Recalcular"), e na lista colada o total é o de e-mails válidos e únicos digitados; especialidade, porte da clínica e "Proteção de frequência" do protótipo aparecem "em breve" (sem dado nem backend)

#### AC-543 — Nome, assunto e corpo são obrigatórios e a criação grava o rascunho

- **Dado** o formulário preenchido ou incompleto
- **Quando** o usuário usa "Salvar Rascunho" ou "Avançar para Envio & Revisão"
- **Então** sem nome, assunto, corpo ou destinatário (pelo menos um e-mail válido) a tela mostra o que falta e não envia; com tudo, cria a campanha em rascunho e leva "Salvar Rascunho" para `/campanhas` e "Avançar para Envio & Revisão" para `/campanhas/[id]`; o aviso de quantos e-mails foram descartados (inválidos e repetidos) aparece; nenhum e-mail é enviado nesta tela

#### AC-544 — Editar um rascunho salva nome, assunto e corpo, e só enquanto é rascunho

- **Dado** uma campanha em rascunho, e outra que já foi iniciada
- **Quando** o usuário edita e salva (`PATCH /api/campanhas/[id]`)
- **Então** o rascunho é atualizado e a tela volta ao detalhe; na campanha iniciada, a tela avisa "Esta campanha já foi iniciada e não pode ser editada" (409 `CAMPANHA_NAO_EDITAVEL`) e não altera nada

#### AC-545 — A composição mostra a prévia do e-mail e as estimativas reais

- **Dado** assunto e corpo digitados
- **Quando** o usuário olha a coluna da direita
- **Então** a prévia mostra o assunto e o corpo do e-mail renderizado de forma isolada (sem executar script nem estilo da página), com os botões "Desktop" e "Mobile" que mudam a largura; a estimativa mostra "Volume de decisores" (o total único) e "Pipeline impactado" (o valor em pipeline da prévia); "Checklist de qualidade", "Taxa esperada de abertura" e "De/Para" do protótipo **não aparecem** (sem dado)

#### AC-546 — Itens do protótipo sem backend aparecem "em breve"

- **Dado** a nova campanha
- **Quando** o usuário olha "Canal de envio", "E-mail de resposta", "Nome e assinatura do remetente", "Texto de pré-cabeçalho", os modelos (Institucional, TISS, Reativação), a barra de formatação, "+ Variável", "Inserir tag" e "Enviar E-mail de Teste para Mim"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação (o corpo é digitado como HTML simples numa caixa de texto)

### US-131 — Acompanhar uma campanha e agir sobre ela (tela 22)

Como gerente ou master, quero abrir uma campanha, disparar, reenviar as falhas e ver
quem recebeu, abriu e clicou, para saber o resultado de cada disparo.

#### AC-547 — O detalhe abre dentro da casca com o resumo da campanha

- **Dado** um usuário com sessão que pode acessar campanhas
- **Quando** ele abre `/campanhas/[id]`
- **Então** vê o nome, o assunto, o selo de status, "Criada em" (data) e "Criada por" (o nome de quem criou, vindo do servidor), o botão "Voltar" (`/campanhas`) e o total de destinatários; campanha de outra empresa ou inexistente mostra "Campanha não encontrada" (404 da API); sem sessão vai ao login

#### AC-548 — Os indicadores do detalhe vêm das contagens da campanha

- **Dado** uma campanha com destinatários em vários status
- **Quando** o detalhe é carregado
- **Então** a barra de progresso mostra enviados, na fila, falhas e o percentual concluído; os cartões mostram "Volume total" (com enviados, na fila e falhas), "Taxa de entrega" (enviados ÷ (enviados + falhas)), "Taxa de abertura única" (abertos e clicados ÷ enviados) e "Taxa de cliques" (clicados ÷ enviados, com a quantidade), com traço quando não há base; benchmark, bounce, "mediana de abertura" e conversas de WhatsApp do protótipo **não aparecem**

#### AC-549 — Play, reenviar falhas e finalizar usam as rotas que já existem

- **Dado** uma campanha em rascunho com destinatários, e outra com falhas
- **Quando** o usuário usa "Iniciar Disparo" (rascunho) ou "Reenviar Falhas" (com falhas, pelo botão e pelo aviso amarelo)
- **Então** a tela chama `POST /api/campanhas/[id]/iniciar` ou `/reenviar-falhas`, pede confirmação antes do Play, mostra o resultado e relê o detalhe; as recusas (já iniciada, sem destinatário, sem falhas, em envio) aparecem em português; enquanto a campanha está "Enviando", o botão de Play fica desabilitado

#### AC-550 — A tabela de destinatários tem filtros por status, busca e paginação

- **Dado** destinatários em vários status
- **Quando** o usuário escolhe "Todos", "Abertos", "Clicados", "Enviados/Não abertos" ou "Falhas" (cada um com a contagem), digita na busca ou troca de página
- **Então** a tabela mostra só os destinatários do filtro e da busca (nome ou e-mail), 20 por página, cada linha com iniciais, nome, e-mail, o selo do status ("Rascunho", "Na fila", "Enviado", "Aberto", "Clicou", "Falha"), as tentativas e a data de envio; sem resultado diz "Nenhum destinatário neste filtro"; etapa do funil, último evento e horário de abertura, cliques por pessoa e seleção em massa do protótipo **não aparecem**

#### AC-551 — Editar, excluir e a prévia do conteúdo enviado

- **Dado** o detalhe de uma campanha
- **Quando** o usuário usa "Editar" (só rascunho), "Excluir" (confirmação com o nome; não em envio) ou a aba "Conteúdo Enviado (Prévia)"
- **Então** "Editar" leva a `/campanhas/nova?rascunho=<id>`, "Excluir" chama o `DELETE` e volta à lista, e a prévia mostra o assunto e o corpo em área isolada (sem executar script); "Pausar Disparo", "CSV", "Mapa de Calor de Cliques e Links", "Eventos em Linha do Tempo", "Desempenho dos Links" e "Impacto Direto no Funil" aparecem como itens "em breve" ou não aparecem (os dois últimos blocos, sem dado, não aparecem)

#### AC-552 — O detalhe se atualiza enquanto a campanha envia

- **Dado** uma campanha "Enviando"
- **Quando** passam 15 segundos
- **Então** o detalhe, a barra e os indicadores são relidos sem recarregar a página, e a leitura para quando a campanha vira "Concluída" (o servidor finaliza ao consultar o detalhe)

### US-132 — Navegar pelas campanhas sem 404 e com estados de verdade

Como usuário, quero que o item "Campanhas" do menu abra uma tela de verdade, com
carregando, vazio e erro.

#### AC-553 — O item do menu e as três rotas apontam para páginas que existem

- **Dado** o item "Campanhas" do menu lateral
- **Quando** o teste lê o `href` e as rotas filhas
- **Então** existem as páginas do Next dentro de `src/app/(app)` para `/campanhas`, `/campanhas/nova` e `/campanhas/[id]`, o item aparece para os três papéis (como hoje), a casca marca "Campanhas" nas três rotas, e as rotas não são públicas

#### AC-554 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das três telas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo ("Nenhuma campanha ainda" com o atalho "+ Nova Campanha"; "Nenhum destinatário" no detalhe) e uma mensagem de erro com "Tentar de novo"

## Fora de escopo

- **Envio de e-mail, pausa do disparo, limites e entregabilidade:** quem envia é o motor externo; "Pausar Disparo" e "Pausada" não existem (Q-055). A tela só libera a fila e acompanha.
- **Hora da abertura/clique, tipo de falha (soft/hard bounce), link clicado, mapa de calor, linha do tempo, desempenho dos links e impacto no funil:** o sistema não guarda; "em breve" ou removidos.
- **Exportar CSV (histórico e campanha), e-mail de teste, modelos, variáveis, pré-cabeçalho, remetente, canal e e-mail de resposta:** sem backend; "em breve".
- **Segmentação por especialidade, porte da clínica e proteção de frequência:** sem dado; "em breve".
- **Mudar os destinatários de um rascunho já criado:** a edição só altera nome, assunto e corpo.
- **Governança de entregabilidade (score, SPF, DKIM, DMARC, IP):** o CRM não tem esses dados.
- Os componentes legados `src/components/campanhas/*` e os testes deles **ficam como estão**.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-181 | Os selos de status da campanha são: RASCUNHO → "Rascunho", PROCESSANDO → "Enviando", FINALIZADA → "Concluída"; e os do destinatário: RASCUNHO "Rascunho", PENDENTE "Na fila", ENVIADO "Enviado", ABERTO "Aberto", CLICADO "Clicou", ERRO "Falha" | aberta | São os valores que o motor e o webhook do Resend gravam hoje |
| ASM-182 | "Enviado" para as taxas = ENVIADO, ABERTO ou CLICADO; "falha" = ERRO; taxa de entrega = enviados ÷ (enviados + falhas) | aberta | O protótipo não define; PENDENTE e RASCUNHO ainda não foram tentados |
| ASM-183 | Os indicadores da lista são sobre todas as campanhas da empresa (exceto "disparos no mês", que é do mês corrente); não dependem dos filtros da tabela | aberta | O protótipo mostra comparação com o mês anterior, que o sistema não guarda |
| ASM-184 | O filtro "Últimos N dias" usa a data de criação da campanha | aberta | Não há data de início do disparo |
| ASM-185 | A lista e o detalhe só aparecem a MASTER, GERENTE e super admin; o item do menu continua visível aos três papéis, e o ATENDENTE vê a mensagem de acesso restrito | aberta | Mantém a regra da fase2d (ASM-076) sem esconder o item do menu |
| ASM-186 | O corpo do e-mail é HTML digitado numa caixa de texto e mostrado em prévia dentro de um quadro isolado (`iframe` com `sandbox` e `srcdoc`), sem scripts | aberta | Evita executar HTML de campanha na página do CRM |
| ASM-187 | "Pipeline impactado" = soma do `valor` dos cards das etapas escolhidas, contando cada lead uma vez; leads sem e-mail válido não contam | aberta | O protótipo mostra "R$ 840k" sem dizer a regra |
| ASM-188 | A atualização automática é por leitura a cada 15 s, só enquanto há campanha "Enviando" | aberta | Não há evento de campanha no fluxo de eventos |
| ASM-189 | O Play pede confirmação e dispara a fila na hora (o CRM só libera, ASM-075 da fase2d); nada é enviado ao salvar o rascunho | aberta | Evita disparo por engano |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-055 | O motor externo suporta pausar um disparo e variáveis no texto ({{primeiro_nome}}, {{nome_clinica}}...)? O protótipo mostra os dois. Enquanto isso, "Pausar Disparo", "Variável" e "Inserir tag" ficam "em breve" | aberta | — |
| Q-056 | Existem benchmarks oficiais para as taxas (o protótipo cita "saúde > 25%" de abertura)? Enquanto isso, as taxas aparecem sem selo de qualidade | aberta | — |
