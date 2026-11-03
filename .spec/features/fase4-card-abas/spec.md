# Spec: Fase 4 — Abas do card: anexos, cadência e conversa (telas 10 a 12)

> feature: fase4-card-abas
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

Terceira das quatro features que colocam o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. O detalhe do card
(`/pipeline/[id]`, `fase4-pipeline-telas`) tem quatro abas: Resumo, Cadência,
WhatsApp e Anexos & Evidências. **Só a primeira existe**: as rotas
`/pipeline/[id]/cadencia`, `/pipeline/[id]/conversa` e `/pipeline/[id]/anexos`
não foram criadas, e hoje as três abas levam a um 404 (erro da PR #37: o
AC-411 dizia que elas "já existiam" e o teste só conferia o `href`). Esta
feature **cria as três telas** (telas 10, 11 e 12 do inventário
`docs/ui/inventario-telas.md`) com o visual do protótipo, sobre APIs que já
existem (anexos, concluir toque, iniciar cadência, mensagens do WhatsApp) e
sobre três pontos novos de backend: a listagem de anexos e a listagem da
cadência de um card, e o nome original do anexo.

Regras herdadas (decisões do usuário, 23/10 e 26/10): a marcação e as classes
do `code.html` de cada tela são a referência; o que o protótipo traz só para
desenhar (seletor de estado, etiquetas de história, dados fictícios) não
entra; **blocos que mostram dado inexistente no sistema são removidos**, e
**ações sem backend aparecem visíveis e marcadas "em breve"**.

Decisões do usuário nesta feature (27/10): (1) uma feature só, com as três
telas; (2) a regra acima vale para os blocos sem dado (proposta, qualificação
técnica, script do toque, taxa de engajamento, SLA, espaço usado, respostas
rápidas); (3) o conserto do 404 das abas é esta feature, sem hotfix antes;
(4) o anexo passa a **guardar o nome original** do arquivo (migration nova).

Lição da feature anterior: cada tela é conferida contra o `screen.png` do
protótipo no navegador antes da PR, e os critérios de tela exigem o que o
protótipo mostra (cabeçalho, filtros, botões), não só a API.

## Histórias

### US-111 — Navegar entre as abas do card sem sair do card

Como atendente, quero que as abas Resumo, Cadência, WhatsApp e Anexos do card
levem a telas de verdade, com o cabeçalho do card sempre no lugar, para
alternar entre elas sem perder o contexto.

#### AC-419 — As quatro abas levam a páginas que existem, e a ativa fica marcada

- **Dado** o detalhe de um card
- **Quando** o usuário clica em "Cadência", "WhatsApp" ou "Anexos & Evidências" (e depois em "Resumo")
- **Então** abre `/pipeline/[id]/cadencia`, `/pipeline/[id]/conversa`, `/pipeline/[id]/anexos` e `/pipeline/[id]`, cada uma dentro da casca (menu com "Funil Pipeline" marcado), nenhuma responde 404, e a aba da tela aberta aparece marcada

#### AC-420 — O cabeçalho do card é o mesmo nas quatro telas

- **Dado** qualquer das quatro telas de um card
- **Quando** ela é renderizada
- **Então** mostra o caminho "Voltar ao funil", o nome do lead, o selo da etapa atual e o responsável, mais o contador de cada aba que tem contagem ("Cadência" com os toques feitos de 18 e "Anexos & Evidências" com o total de anexos)

#### AC-421 — Card de outra empresa ou inexistente mostra "não encontrado" nas três telas novas

- **Dado** um id de card que não existe ou é de outra empresa
- **Quando** o usuário abre `/pipeline/[id]/cadencia`, `/conversa` ou `/anexos`
- **Então** a tela diz que o card não foi encontrado, com caminho de volta ao funil, sem vazar nenhum dado, e sem sessão a pessoa é mandada ao login

#### AC-422 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das três telas novas
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo (ex.: "Nenhum anexo ainda — envie o primeiro") e uma mensagem de erro com "Tentar de novo"

### US-112 — Ver e organizar os anexos do card (tela 12)

Como atendente, quero ver todos os prints e PDFs do card, abri-los com
segurança e enviar novos, para manter o dossiê da negociação em um lugar só.

#### AC-423 — O servidor lista os anexos do card, só os da empresa da sessão

- **Dado** um card com anexos e outro card, de outra empresa, também com anexos
- **Quando** a tela pede a lista (`GET /api/oportunidades/[id]/anexos`)
- **Então** voltam só os anexos desse card, do mais novo ao mais antigo, cada um com nome, tipo, tamanho, hash, quem enviou e quando; card de outra empresa responde 404 e sem sessão responde 401

#### AC-424 — Cada anexo mostra o que o protótipo mostra, e só o que existe

- **Dado** a lista de anexos renderizada
- **Quando** o usuário olha uma linha
- **Então** vê o ícone do tipo (PDF ou imagem), o nome, o tamanho legível, quem enviou, a data e o início do hash SHA-256; anexos usados como evidência numa mudança de etapa mostram o selo "Evidência" com o nome da etapa; os selos do protótipo "aprovada", "em revisão" e "válida" **não aparecem** (não existem no sistema)

#### AC-425 — Busca e filtros por tipo restringem a lista

- **Dado** anexos de vários tipos e nomes
- **Quando** o usuário digita na busca ou escolhe "Todos", "Evidências", "PDFs" ou "Imagens"
- **Então** a lista mostra só os que atendem aos dois, cada filtro mostra a contagem dele, e sem resultado a tela diz "Nenhum anexo com estes filtros"

#### AC-426 — "Link Seguro" abre o anexo por link de curta duração

- **Dado** um anexo da lista
- **Quando** o usuário clica em "Link Seguro (15m)" ou no ícone de baixar
- **Então** o anexo abre ou baixa pelo link assinado de curta duração que o sistema já gera (`/api/anexos/[id]`), nunca por um endereço permanente do arquivo

#### AC-427 — O envio de arquivo aceita arrastar ou escolher e mostra o resultado

- **Dado** a área "Adicionar Arquivos ou Evidências ao Dossiê"
- **Quando** o usuário arrasta ou escolhe um PDF, PNG, JPG ou WebP dentro do limite (imagem até 5 MB, PDF até 10 MB)
- **Então** o arquivo é enviado, aparece no topo da lista com o nome original e a contagem da aba sobe; um tipo não permitido ou um arquivo grande demais mostra a mensagem do motivo ("tipo não permitido", "arquivo grande demais") e nada é gravado

#### AC-428 — O nome original do arquivo é guardado e mostrado

- **Dado** a migration nova que acrescenta o nome ao anexo
- **Quando** um arquivo chamado `Proposta Comercial v1.2.pdf` é enviado
- **Então** o anexo guarda esse nome (sem pastas, até 120 caracteres, caracteres de controle removidos) e a lista o mostra; anexos antigos, sem nome, aparecem como "Anexo PDF — 27/10/2026 10:41" (tipo e data)

#### AC-429 — Ações do protótipo sem backend aparecem como "em breve"

- **Dado** a tela de anexos
- **Quando** o usuário olha a caixa "Marcar como evidência" e "Vincular à etapa" do envio
- **Então** aparecem visíveis, marcados "em breve", sem disparar nenhuma ação; o bloco de governança "ISO-27799" e o "espaço utilizado" **não aparecem** (sem dado)

### US-113 — Acompanhar a cadência de 18 toques do card (tela 10)

Como atendente, quero ver a régua de 18 toques do card, o toque da vez e o que
já foi feito, e concluir o toque da vez ali mesmo, para não depender só da fila
do turno.

#### AC-430 — O servidor lista os toques da cadência do card

- **Dado** um card com a cadência iniciada, e outro, de outra empresa, também com cadência
- **Quando** a tela pede os toques (`GET /api/oportunidades/[id]/cadencia`)
- **Então** voltam os 18 toques desse card em ordem de sequência, cada um com dia, turno, canal, tipo, resultado, quando foi feito, por quem e a observação, mais o total de concluídos e qual é o toque da vez; card de outra empresa responde 404 e sem sessão responde 401

#### AC-431 — O resumo do topo mostra progresso, toque da vez, respostas e situação da régua

- **Dado** uma cadência com toques concluídos
- **Quando** a tela de cadência é aberta
- **Então** mostra "N de 18 toques" com a barra de progresso, o toque da vez (número, dia, turno e canal), a contagem de respostas obtidas ("conectou") e de "sem resposta", e a situação da régua (em andamento, encerrada ou com toque atrasado); taxa de engajamento e SLA do protótipo **não aparecem** (sem dado)

#### AC-432 — A matriz mostra os 18 toques por dia e turno com o estado de cada um

- **Dado** a cadência de 18 toques em 3 dias, manhã e tarde
- **Quando** a matriz é renderizada
- **Então** vê os três dias, cada um com os turnos Manhã e Tarde (3 toques por turno), e cada toque com canal, tipo (ligação, mensagem ou despedida) e estado: concluído com resultado, toque da vez em destaque ou programado; o contador de cada dia mostra "N/6 concluídos"

#### AC-433 — Sem cadência iniciada, a tela mostra o caminho para iniciar

- **Dado** um card sem cadência
- **Quando** o usuário abre a aba Cadência
- **Então** vê o estado vazio "A cadência deste card ainda não foi iniciada" com o botão "Iniciar cadência" (a mesma ação do funil, que só existe para card em "Entrada de leads"), e ao usar o botão a matriz aparece sem recarregar a página; card em outra etapa não mostra o botão e a tela explica que a cadência só começa em "Entrada de leads", dizendo em que etapa o card está

#### AC-434 — Concluir o toque da vez pela tela, com as regras da cadência

- **Dado** o toque da vez em destaque
- **Quando** o usuário usa "Registrar Sucesso" ou "Não Atendeu"
- **Então** o toque é concluído como "conectou" ou "sem resposta" (a mesma API da fila do turno), a tela avança para o próximo toque e o progresso sobe; se o turno ainda não liberou, o bloco anterior está pendente, a cadência já encerrou ou outra pessoa mexeu antes, a tela mostra a mensagem do motivo e nada muda

#### AC-435 — O histórico lista os toques já feitos, com atalho para a conversa

- **Dado** toques concluídos
- **Quando** o usuário olha o "Histórico Consolidado de Interações da Régua"
- **Então** vê cada toque feito, do mais novo ao mais antigo, com número e dia, canal, quem fez, quando e o resultado; os de WhatsApp têm o link "Ver conversa" para `/pipeline/[id]/conversa`, e o filtro "por canal" restringe a lista

#### AC-436 — Ações e blocos da cadência sem backend

- **Dado** a tela de cadência
- **Quando** o usuário olha "Pausar Cadência", "Reiniciar Régua", "Pediu Retorno Mais Tarde", "Exportar Relatório (PDF)" e "Editar Script"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; o "script recomendado" do toque e a coluna de "resultado detalhado" do protótipo **não aparecem** (sem dado)

### US-114 — Conversar com o lead pelo WhatsApp dentro do card (tela 11)

Como atendente, quero ver e responder a conversa do lead na tela do card, com a
cadência ao lado, para agir sem trocar de tela.

#### AC-437 — A conversa do lead aparece com o histórico completo

- **Dado** um lead com mensagens enviadas e recebidas
- **Quando** o usuário abre `/pipeline/[id]/conversa`
- **Então** vê as mensagens em ordem de hora, as recebidas de um lado e as enviadas do outro, cada uma com a hora e (nas enviadas) o status, separadas por dia ("Hoje", "Ontem" ou a data), e a conversa já rolada até a mensagem mais recente; só mensagens do lead desse card, da empresa da sessão

#### AC-438 — O seletor de telefone troca a conversa

- **Dado** um lead com telefone principal e telefones extras
- **Quando** o usuário escolhe outro telefone no seletor do topo da conversa
- **Então** o seletor mostra cada número com o rótulo (e "Principal"), e a conversa e o envio passam a valer para o número escolhido

#### AC-439 — Enviar uma mensagem pelo campo da conversa

- **Dado** o campo "Digite uma mensagem..." e um telefone escolhido
- **Quando** o usuário escreve e aperta Enter (ou o botão de enviar), ou só espaços
- **Então** a mensagem é enviada pelo WhatsApp da empresa (`POST /api/whatsapp/send` com o lead e o telefone), aparece na conversa e o campo é limpo; texto vazio não envia, e a falha mostra o motivo ("WhatsApp não configurado", "número sem WhatsApp" ou "falha no envio") sem perder o texto digitado

#### AC-440 — Abrir a conversa marca as mensagens recebidas como lidas

- **Dado** mensagens recebidas ainda não lidas
- **Quando** o usuário abre a tela de conversa
- **Então** as mensagens do lead são marcadas como lidas (`/api/whatsapp/lidas`) e o contador de não lidas do menu lateral diminui sem recarregar

#### AC-441 — A conexão do WhatsApp aparece no topo da conversa

- **Dado** a instância do WhatsApp da empresa conectada, desconectada ou não configurada
- **Quando** a tela de conversa é aberta
- **Então** a faixa mostra o estado ("Conectada • nome da instância" ou o aviso de desconectada/não configurada com o link para a configuração do WhatsApp), e com o WhatsApp fora do ar o envio fica desabilitado com a explicação

#### AC-442 — Mensagem nova do lead aparece sem recarregar

- **Dado** a conversa aberta
- **Quando** o lead responde (evento de mensagem recebida do fluxo em tempo real que já existe)
- **Então** a mensagem aparece no fim da conversa sem recarregar a página, e é marcada como lida porque a conversa está aberta; evento de lead de outra empresa nunca chega

#### AC-443 — O painel lateral mostra a cadência e as anotações internas do card

- **Dado** a tela de conversa
- **Quando** o usuário olha a coluna da direita
- **Então** vê "Cadência Comercial" (toque da vez, progresso e a próxima ação) e "Notas Internas" com as anotações internas do card (as da aba Resumo) e o campo "Adicionar nota interna rápida" que grava uma nova anotação no card; entre os dois ficam "Dados da Proposta" e "Qualificação Técnica" (AC-742)

#### AC-744 — Gravar e enviar áudio

- **Dado** a tela de conversa com o WhatsApp conectado
- **Quando** o usuário clica no microfone, grava e clica em enviar
- **Então** o áudio vai para o telefone escolhido do lead como mensagem de voz, aparece na conversa como mensagem enviada com o player, e o microfone do navegador é liberado
- **E** durante a gravação aparece o tempo e dá para descartar sem enviar nada; a gravação para sozinha aos 5 minutos
- **E** se o navegador não grava áudio ou o microfone é negado, a tela avisa em vez de quebrar; sem WhatsApp conectado, gravar e anexar ficam desabilitados
- **E** enviar áudio nunca move o card nem encerra a cadência

#### AC-745 — Ouvir e abrir a mídia da conversa

- **Dado** mensagens com áudio, imagem, vídeo ou documento (as que o lead mandou e as que a equipe enviou)
- **Quando** a conversa abre
- **Então** cada uma aparece com o player de áudio ou de vídeo, a imagem (que abre em tamanho grande) ou o documento para baixar, sem o texto marcador "[áudio]", "[imagem]" etc., e a legenda, quando houver, continua escrita
- **E** o arquivo recebido é buscado na Evolution só na primeira vez que alguém o abre e fica guardado no servidor; as próximas aberturas não chamam a Evolution
- **E** o arquivo só abre para quem está na empresa da mensagem; de outra empresa, inexistente ou de mensagem sem mídia é "não encontrado"; se o arquivo não existe mais, a tela mostra "Mídia indisponível" no lugar do player

#### AC-746 — Anexar arquivo

- **Dado** a tela de conversa com o WhatsApp conectado
- **Quando** o usuário escolhe um arquivo em "Anexar arquivo", pode escrever uma legenda e clica em enviar
- **Então** o arquivo vai para o telefone escolhido do lead (imagem e vídeo como tal; PDF, Office, texto, CSV e áudio-arquivo como documento), a legenda vai junto, e a conversa mostra a mídia; antes de enviar, o arquivo escolhido aparece com nome e tamanho e dá para removê-lo

#### AC-747 — Só tipos e tamanhos seguros

- **Dado** qualquer envio de áudio ou arquivo
- **Então** só entram imagens (JPEG, PNG, WebP, GIF), vídeo MP4, áudio (Ogg, WebM, MP4, MP3, WAV, AAC), PDF, Word, Excel, PowerPoint, texto e CSV, até 16 MB; HTML, SVG, executáveis e qualquer outro tipo são recusados (415), arquivo acima do limite é recusado (413) e vazio ou pedido mal formado é 400, sempre sem chamar a Evolution nem gravar mensagem
- **E** imagem, PDF e GIF precisam ter os bytes do tipo que declaram
- **E** o arquivo é servido de volta só com tipos da lista (qualquer outro como download genérico), com `nosniff`, e documentos sempre como download

#### AC-739 — Mover de etapa, ganho e perdido nas abas

- **Dado** o cabeçalho do card nas abas Cadência, WhatsApp e Anexos
- **Quando** o usuário escolhe uma etapa em "Mover de Etapa", ou clica em "Marcar como Ganho" ou "Perdido"
- **Então** o card se move pela mesma rota e com as mesmas regras do Resumo: só aparecem os destinos que o papel alcança, e quando falta um dado (valor na Proposta, motivo na perda) abre o mesmo modal
- **E** depois de mover, o cabeçalho já mostra a etapa nova

#### AC-740 — Novo número, busca e menu na conversa

- **Dado** a tela de conversa
- **Quando** o usuário clica em "Novo Número"
- **Então** abre um formulário (telefone e rótulo) que cadastra um telefone extra do lead e o coloca no seletor; se o servidor recusar (número inválido ou repetido), mostra o motivo e mantém o que foi digitado
- **E** a busca na conversa filtra as mensagens já carregadas, sem diferenciar acento nem maiúsculas, mostra quantas achou e avisa quando não acha nenhuma
- **E** o menu de três pontos tem "Atualizar conversa", "Marcar como lidas" e "Abrir no WhatsApp Web" (o número escolhido)

#### AC-741 — Respostas rápidas e templates

- **Dado** a tela de conversa e os templates aprovados da empresa
- **Quando** o usuário clica numa resposta rápida ou escolhe um template na lista
- **Então** o texto, com {{nome}} e {{primeiro_nome}} trocados pelos do lead, vai para o campo da mensagem (depois do que já estiver escrito) e nada é enviado até o usuário enviar
- **E** só templates aprovados aparecem; sem nenhum, a tela avisa "Nenhum template aprovado ainda."

#### AC-742 — Dados da proposta e qualificação técnica no card

- **Dado** a tela de conversa
- **Quando** o usuário olha a coluna da direita
- **Então** vê "Dados da Proposta" (MRR ofertado, previsão de fechamento, condição especial e plano) e "Qualificação Técnica" (porte da clínica, prontuário legado, faturamento TISS e termo LGPD validado), com "—" onde nada foi preenchido e o termo como "Não"
- **E** o "MRR ofertado" é o valor estimado do card, o mesmo que se edita no detalhe
- **E** cada bloco tem o próprio "Editar": qualquer papel que acessa o card salva só o que mudou, e o dado volta igual ao recarregar; data inexistente, texto acima de 200 caracteres ou tipo errado são recusados com o campo, sem gravar nada
- **E** "Qualificação Técnica" mostra a porcentagem dos quatro itens preenchidos (o termo conta quando validado)
- **E** os dados de um card nunca aparecem em outra empresa, e card de outra empresa ou inexistente é "não encontrado"

#### AC-743 — A edição comercial fica na linha do tempo

- **Dado** uma edição dos dados comerciais
- **Então** a linha do tempo do card ganha um evento com quem editou, quando, e o valor de antes e o de depois de cada campo que mudou (o termo aparece como "sim"/"não")
- **E** salvar sem mudar nada não registra nada

#### AC-748 — A conversa tem altura fixa

- **Dado** a tela de conversa numa janela larga
- **Quando** a conversa tem muitas mensagens
- **Então** a página não cresce: o quadro ocupa a altura da tela, o cabeçalho do card, as abas, o campo de mensagem e as respostas rápidas ficam sempre à vista, e só a lista de mensagens rola por dentro
- **E** a coluna da direita (cadência, proposta, qualificação e notas) rola sozinha quando não cabe
- **E** em janela estreita a página volta a rolar normalmente

#### AC-749 — Anexos e Cadência têm altura fixa

- **Dado** as telas de Anexos e de Cadência numa janela larga
- **Quando** há muitos anexos ou toques
- **Então** a página não cresce: o quadro ocupa a altura da tela, o cabeçalho do card, as abas e o título da tela ficam parados, e o resto (filtros, lista e envio em Anexos; resumo, matriz e histórico em Cadência) rola por dentro
- **E** nada posicionado dentro da área que rola (como o campo de arquivo escondido) pode empurrar a altura da página
- **E** em janela estreita a página volta a rolar normalmente

#### AC-750 — Exportar o dossiê do card

- **Dado** a tela de anexos de um card com ao menos um anexo
- **Quando** o usuário clica em "Exportar Dossiê (ZIP)"
- **Então** o navegador baixa um ZIP chamado `dossie-<nome-do-lead>-<data>.zip` com todos os anexos do card, do mais antigo ao mais novo, numa pasta `anexos/` com o nome original (nomes repetidos ganham "(2)", "(3)"; sem nome original, o arquivo recebe um nome gerado), mais um `manifesto.csv`
- **E** o manifesto tem uma linha por anexo com o arquivo, o nome original, o tipo, o tamanho, o SHA-256 gravado no envio, quem enviou, quando, a etapa de evidência (se houver) e a integridade
- **E** sem anexo o botão aparece desabilitado e a rota responde 422; anexos de outra empresa nunca entram, e card de outra empresa ou inexistente é "não encontrado"
- **E** um dossiê que passa de 100 MB é recusado (413)

#### AC-751 — Integridade e registro do dossiê

- **Dado** a exportação de um dossiê
- **Então** cada anexo é conferido contra o SHA-256 gravado no envio: "ok" se confere, "divergente" se o arquivo mudou no servidor, "ausente" se sumiu — e um arquivo ausente não derruba a exportação (fica só no manifesto, sem o arquivo)
- **E** a linha do tempo do card registra quem exportou, quando, quantos arquivos iam no dossiê e quantos tinham problema de integridade
- **E** o manifesto é CSV em UTF-8 com BOM, e textos que começariam com `=`, `+`, `-` ou `@` ganham um apóstrofo para o Excel não rodá-los como fórmula; nomes de arquivo dentro do ZIP nunca levam pasta, caractere de controle nem ponto na frente

#### AC-752 — Tornar um anexo evidência

- **Dado** um anexo que ainda não é evidência
- **Quando** qualquer usuário que acessa o card clica em "Tornar Evidência"
- **Então** o anexo passa a mostrar o selo "Evidência · <etapa atual do card>", e a linha do tempo registra quem marcou, quando e qual anexo
- **E** marcar de novo um anexo que já é evidência não muda nada nem registra de novo; anexo de outra empresa ou inexistente é "não encontrado"

#### AC-753 — Remover a evidência

- **Dado** um anexo que é evidência (de uma mudança de etapa ou marcado à mão)
- **Quando** o usuário clica em "Remover evidência"
- **Então** o selo some, a linha do tempo registra quem removeu e quando, e o registro da mudança de etapa que usou o anexo continua na linha do tempo
- **E** vale sempre o último que aconteceu com o anexo: marcar de novo depois de remover volta a valer

#### AC-754 — Excluir um anexo

- **Dado** um anexo que o usuário pode excluir
- **Quando** clica em "Excluir" e confirma na janela "Excluir este anexo?" (cancelar não faz nada)
- **Então** o registro e o arquivo saem do servidor, a lista se atualiza, o contador da aba diminui, e a linha do tempo registra quem excluiu, quando, e o nome, o tipo, o tamanho e o SHA-256 do que foi excluído
- **E** excluir um anexo que já foi excluído é "não encontrado"

#### AC-755 — Quem pode excluir e o que não se exclui

- **Dado** a lista de anexos de um card
- **Então** o botão "Excluir" só aparece para gerente, master e super admin (qualquer anexo) e para quem enviou o anexo (só os dele); quem não pode não vê o botão, e a rota responde 403
- **E** anexo que é evidência não é excluído: o botão aparece desabilitado com a dica "Remova a evidência antes de excluir", e a rota responde 409
- **E** anexo de outra empresa nunca é alterado (404)

## Fora de escopo

- **Enviar arquivo e áudio pelo WhatsApp**: feito em AC-744 a AC-747 (pedido de 03/11).
- **Conversa com número que não é lead** (botão "Novo Número"): é a tela 17 do inventário (`/whatsapp/nova`), de outra feature.
- **Caixa de entrada geral** (`/whatsapp`), conexão e configuração do WhatsApp (telas 16, 18 e 19): outra feature. Aqui só se mostra o estado da conexão e o link.
- **Pausar e reiniciar a cadência**, resultado "pediu retorno mais tarde" e editar o script do toque: sem backend.
- **Evidência de transição marcada no envio** (caixa "Marcar como evidência" e "Vincular à etapa"), **excluir anexo**, **exportar dossiê em ZIP** e pré-visualização de planilhas/DOCX: sem backend; o upload continua aceitando só PDF, PNG, JPG e WebP.
- **Dados da proposta, qualificação técnica, SLA, taxa de engajamento, espaço utilizado e selos de aprovação** do protótipo: não existem no sistema (decisão: removidos).
- **Mover etapa e ganho/perdido no cabeçalho** das três telas novas: só no Resumo (já feito); nas outras abas aparece "Mover Etapa" como "em breve".

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-141 | O cabeçalho do card e a barra de abas, hoje dentro de `/pipeline/[id]`, viram um componente compartilhado (`MoldeDoCard`) que as quatro páginas usam, sem mudar o que o Resumo mostra; não é um `layout.tsx`, para os testes atuais do Resumo (que montam a página inteira) seguirem valendo | aberta | Evita repetir o cabeçalho em quatro páginas sem reescrever os testes do Resumo |
| ASM-142 | O nome original do anexo passa a ser guardado numa coluna nova `nome` em `anexos` (migration 0013, nula para os anexos antigos); a migration entra na lista a levar ao cutover | confirmada | Decisão do usuário em 27/10 |
| ASM-143 | "Evidência" = anexo ligado a uma mudança de etapa (o `anexo_id` do evento de transição); não existe status de aprovação, então não há "aprovada/em revisão" | aberta | Vem do modelo atual (`oportunidade_eventos.anexo_id`) |
| ASM-144 | Pela tela só se conclui um toque como "conectou" ("Registrar Sucesso") ou "sem resposta" ("Não Atendeu"), os dois resultados que a API de concluir aceita | aberta | O enum tem ainda `cancelada`, mas a API de concluir recusa |
| ASM-145 | "Situação da régua" = "encerrada" se a cadência acabou, "com toque atrasado" se há toque pendente vencido (mesma regra da fila de atrasados), senão "em andamento" | aberta | Substitui o "No prazo/SLA" do protótipo, que não tem fonte |
| ASM-146 | O status mostrado em cada mensagem enviada é o que o sistema grava (`status` da mensagem), traduzido para "enviada", "entregue" ou "lida"; valores desconhecidos aparecem como "enviada" | aberta | O campo é texto livre no legado |
| ASM-147 | "Notas internas" são as anotações do card já existentes (evento `anotacao`, T-156 da feature anterior), sem tabela nova | aberta | A mesma lista da linha do tempo do Resumo, filtrada nas anotações |
| ASM-148 | Os limites do upload são os do servidor (PDF até 10 MB; PNG, JPG e WebP até 5 MB); o protótipo fala em DOCX, XLSX e 25 MB, que não existem no backend | aberta | Aumentar limite ou aceitar outros tipos é decisão de produto, não desta feature |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-049 | "Ligar Agora" no cabeçalho: abrir o discador do aparelho (`tel:`) com o telefone principal em vez de "em breve"? Hoje não existe telefonia no sistema | aberta | — |
