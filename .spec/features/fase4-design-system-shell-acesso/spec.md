# Spec: Fase 4 — Design system, casca e acesso (MedCRM)

> feature: fase4-design-system-shell-acesso
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

O CRM novo (pipeline, tarefas, indicadores, WhatsApp, campanhas) existe como
APIs e telas soltas, **sem identidade visual, sem menu e sem porta de entrada**:
o login e o `src/middleware.ts` ainda falam com o Supabase do legado, então
nenhuma API do CRM novo é alcançável por um navegador. Esta é a primeira de
quatro features que colocam no projeto o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`, 31 telas + `DESIGN.md`), com
a marca **MedCRM**. Ela entrega a base das outras três: o design system (cores,
fontes, ícones), a **casca** (menu lateral e topo) e as **5 telas de acesso**
(telas 1 a 5 do inventário `docs/ui/inventario-telas.md`), mais as rotas HTTP
e o middleware que ligam a biblioteca de autenticação já pronta
(`src/lib/auth/*`, fase1-auth-rbac) ao navegador.

Regra de fidelidade (decisão do usuário, 23/10): a marcação e as classes do
`code.html` de cada tela são a referência; o que o protótipo traz só para
desenhar (seletor de estado, etiquetas de história de usuário, dados fictícios)
não entra no produto. Itens do protótipo sem backend entram **visíveis e
marcados "em breve"**.

## Histórias

### US-097 — Ter a identidade visual do protótipo no projeto

Como membro da equipe, quero que o sistema tenha a cara do protótipo aprovado
(cores, tipografia, ícones), para que todas as telas pareçam um produto só.

#### AC-345 — Os tokens do protótipo viram classes utilizáveis

- **Dado** o tema do Tailwind do projeto
- **Quando** uma tela usa `bg-primary`, `bg-sidebar-surface`, `text-text-secondary`, `bg-danger-surface`, `font-headline-lg` ou `p-margin`
- **Então** a classe existe e resolve para o valor do protótipo (primária `#0954c9`, menu `#1E293B`, canvas `#F4F6FA`, escala de texto e espaçamentos do `tailwind.config` do `code.html`)

#### AC-346 — As fontes e os ícones do protótipo são carregados

- **Dado** qualquer página do sistema
- **Quando** ela é renderizada
- **Então** Plus Jakarta Sans e Inter estão disponíveis como fontes de título e de texto, e os ícones Material Symbols Outlined (com suporte a `FILL`) estão disponíveis

#### AC-347 — As telas de acesso não trazem artefatos do protótipo

- **Dado** as cinco telas de acesso renderizadas
- **Quando** o texto delas é lido
- **Então** não aparece seletor de estado ("Estado:", "Simular Expirado", "Ver estado de erro do link"), código de história ou critério (`US-014`, `US-056`…), nem afirmação de certificação (HIPAA, ISO 27001, "SSL 256-bit") nem versão ou razão social inventadas (ver Q-042)

### US-098 — Navegar pelo sistema por uma casca única

Como usuário logado, quero um menu lateral e um topo iguais em todas as telas,
para ir de uma área à outra sem perder o contexto.

#### AC-348 — O menu traz os grupos e itens do protótipo

- **Dado** um usuário MASTER logado
- **Quando** a casca é renderizada
- **Então** o menu mostra os grupos Operação (Funil Pipeline, Lista, Arquivados, Tarefas do Turno, Tarefas Atrasadas, Agenda), Comunicação (WhatsApp Inbox, Campanhas), Análises (Indicadores, Relatórios, Comercial) e Administração (Equipe, Motivos de Perda, Empresas), nessa ordem, cada item com o ícone e a rota do protótipo, e no rodapé "Ajuda & Suporte" e a versão do sistema

#### AC-349 — O menu esconde o que o papel não pode ver

- **Dado** usuários de papéis diferentes logados
- **Quando** a casca é renderizada para cada um
- **Então** o ATENDENTE vê só Operação e Comunicação; o GERENTE vê também Análises e, em Administração, só Equipe e Motivos de Perda; o MASTER vê tudo menos Empresas; o super admin vê tudo, inclusive Empresas (matriz em ASM-123)

#### AC-350 — O item da tela atual aparece destacado

- **Dado** o usuário em `/tarefas/atrasadas`, ou em `/pipeline/<id>/cadencia`
- **Quando** o menu é renderizado
- **Então** "Tarefas Atrasadas" (no primeiro caso) ou "Funil Pipeline" (no segundo) tem o estilo ativo do protótipo (`bg-sidebar-surface-active`, texto claro, `font-semibold`) e nenhum outro item o tem

#### AC-351 — Os contadores do menu mostram números reais

- **Dado** 12 toques no turno, 4 atrasados e 5 mensagens de WhatsApp não lidas na empresa do usuário
- **Quando** o menu é renderizado
- **Então** Tarefas do Turno mostra 12, Tarefas Atrasadas mostra 4 (em vermelho) e WhatsApp Inbox mostra 5 (em verde); com contagem zero ou com a consulta falhando, o contador some em vez de mostrar 0 ou um número inventado

#### AC-352 — O topo mostra quem está logado

- **Dado** a usuária Ana Souza, papel GERENTE, e-mail `ana@clinica.com.br`, empresa "Clínica São Lucas"
- **Quando** o topo é renderizado
- **Então** ele mostra o nome, o papel (selo `GERENTE`), o e-mail e o nome da empresa ativa, todos vindos da sessão

#### AC-353 — Só o super admin vê e usa o seletor de empresa

- **Dado** um super admin e um MASTER, ambos logados
- **Quando** o topo é renderizado para cada um
- **Então** só o super admin tem o seletor de empresa, com a lista das empresas e a ativa marcada; ao escolher outra, a empresa ativa da sessão muda (US-019, AC-045) e a tela recarrega com os dados da nova empresa

#### AC-354 — O indicador de tempo real diz a verdade

- **Dado** a conexão de tempo real (SSE)
- **Quando** ela está aberta, e depois quando cai
- **Então** o topo mostra "Tempo real conectado" (verde, pulsando) enquanto aberta, e "Reconectando…" (âmbar) quando caiu, voltando ao verde sem recarregar a página

#### AC-355 — O que não tem backend aparece como "em breve"

- **Dado** o topo e o rodapé do menu
- **Quando** o usuário vê a busca global (Ctrl+K), o sino de notificações e "Ajuda & Suporte"
- **Então** os três continuam visíveis como no protótipo, com o selo "em breve", e clicar neles não navega nem abre nada

#### AC-356 — No celular o menu vira gaveta

- **Dado** uma tela com menos de 768 px de largura
- **Quando** a casca é renderizada
- **Então** o menu fica escondido, um botão no topo o abre como gaveta sobre um fundo escurecido, e ele fecha ao escolher um item ou tocar no fundo

#### AC-357 — Sair encerra a sessão

- **Dado** um usuário logado
- **Quando** ele escolhe "Sair" no menu do usuário (topo)
- **Então** a sessão é revogada (linha apagada em `sessoes`), o cookie é limpo e ele cai em `/login`; voltar com o botão do navegador não mostra dados da empresa

### US-099 — Entrar no sistema

Como usuário, quero entrar com e-mail e senha numa tela com a cara do produto,
para acessar o meu trabalho.

#### AC-358 — Login correto leva ao sistema

- **Dado** um usuário ativo com e-mail e senha corretos, vindo de `/login?next=/tarefas`
- **Quando** ele envia o formulário
- **Então** a sessão é criada (AC-033) e ele vai para `/tarefas`; sem `next`, vai para `/pipeline`; um `next` de outro domínio (`//site.com`, `https://…`) é ignorado

#### AC-359 — Credenciais erradas mostram o aviso com as tentativas que restam

- **Dado** uma senha incorreta na 2ª tentativa dentro da janela
- **Quando** o formulário é enviado
- **Então** aparece o aviso vermelho "Credenciais Inválidas" dizendo que restam 3 tentativas, os dois campos ganham realce vermelho por alguns segundos, e a mensagem é a mesma para e-mail inexistente e para usuário inativo (não revela se a conta existe)

#### AC-360 — Excesso de tentativas bloqueia a tela com contagem regressiva

- **Dado** 5 tentativas incorretas em 15 minutos (AC-047)
- **Quando** a 6ª tentativa é feita, ou a tela é aberta de novo ainda dentro do bloqueio
- **Então** a tela mostra o aviso âmbar "Acesso Temporariamente Suspenso" com a contagem regressiva (mm:ss), campos e botão desabilitados com o texto "Acesso Bloqueado Temporariamente"; quando a contagem chega a zero, o formulário volta a funcionar

#### AC-361 — Enquanto envia, o botão não aceita novo clique

- **Dado** um envio de login em andamento
- **Quando** o usuário clica de novo em "Entrar na Plataforma"
- **Então** o botão mostra o spinner no lugar do texto, está desabilitado e nenhum segundo envio é feito

#### AC-362 — Quem já está logado não vê o login

- **Dado** uma sessão válida
- **Quando** o usuário abre `/login`
- **Então** ele é levado direto para `/pipeline`

### US-100 — Recuperar a senha

Como usuário que esqueceu a senha, quero pedir um link de redefinição, para
voltar a acessar sem depender de outra pessoa.

#### AC-363 — E-mail inválido é recusado na própria tela

- **Dado** a tela `/esqueci-senha`
- **Quando** o usuário envia um texto que não é um e-mail
- **Então** o campo mostra "Por favor, insira um e-mail válido." em vermelho e nada é enviado ao servidor

#### AC-364 — A confirmação é a mesma para qualquer e-mail

- **Dado** um e-mail cadastrado e outro inexistente
- **Quando** cada um é enviado na tela
- **Então** nos dois casos a tela mostra "Instruções enviadas!" com a mesma mensagem, citando o e-mail digitado e o prazo de **24 horas** do link (Q-006); nada na resposta ou na tela distingue os dois casos (AC-042)

#### AC-365 — O e-mail só é enviado quando a conta existe

- **Dado** um e-mail cadastrado e ativo
- **Quando** o pedido é feito
- **Então** é enviado um e-mail marcado MedCRM com o link `/redefinir-senha/<token>` (token do AC-041); para e-mail inexistente ou usuário inativo nenhum e-mail é enviado (envio em Q-043)

#### AC-366 — Dá para tentar outro e-mail

- **Dado** a tela de confirmação
- **Quando** o usuário clica em "Tentar outro e-mail"
- **Então** volta o formulário vazio, e "Voltar ao login" leva a `/login`

### US-101 — Definir uma nova senha pelo link

Como usuário com um link de redefinição, quero criar uma senha nova vendo as
regras, para entrar de novo com segurança.

#### AC-367 — Os critérios de senha acendem enquanto o usuário digita

- **Dado** a tela `/redefinir-senha/<token>` com token válido
- **Quando** o usuário digita a nova senha
- **Então** cada critério da lista (mínimo 8 caracteres, letra maiúscula, número ou símbolo) troca de círculo vazio cinza para marca verde assim que é atendido, e volta a cinza se deixar de ser

#### AC-368 — Senhas diferentes impedem o envio

- **Dado** a nova senha e uma confirmação diferente
- **Quando** o usuário olha o formulário
- **Então** aparece "As senhas informadas não coincidem." e o botão "Salvar nova senha e entrar" fica desabilitado até as duas coincidirem e todos os critérios serem atendidos

#### AC-369 — Salvar troca a senha e já entra no sistema

- **Dado** um token válido e uma senha que atende a política
- **Quando** o usuário salva
- **Então** a senha é trocada, as sessões antigas são revogadas e o token é consumido (AC-041), uma sessão nova é criada e o usuário vai para `/pipeline`

#### AC-370 — Link expirado ou já usado mostra a tela de erro, sem pedir senha

- **Dado** um token expirado, inexistente ou já utilizado
- **Quando** `/redefinir-senha/<token>` é aberta
- **Então** a tela mostra "Link expirado ou inválido" com os botões "Solicitar novo link" (vai para `/esqueci-senha`) e "Voltar ao login", sem exibir o formulário; abrir a página não consome o token

### US-102 — Ativar a conta pelo convite

Como pessoa convidada, quero ver para onde fui convidada e criar minha senha,
para começar a usar o sistema.

#### AC-371 — A tela mostra para quem é o convite

- **Dado** um token de convite válido para a empresa "Clínica São Lucas", papel ATENDENTE, e-mail `dra.juliana@saolucas.med.br`
- **Quando** `/convite/<token>` é aberta
- **Então** a tela mostra a empresa, o selo "Convite Ativo", o papel com a descrição do que ele acessa e o e-mail em campo somente leitura marcado "Verificado e vinculado"

#### AC-372 — Ativar exige nome, senha válida e aceite dos termos

- **Dado** o formulário do convite
- **Quando** falta o nome, a senha não atende a política, a confirmação difere ou o aceite de Termos de Uso e LGPD não está marcado
- **Então** o botão "Ativar minha conta" fica desabilitado

#### AC-373 — Ativar cria a senha, grava o nome e entra

- **Dado** o formulário completo e válido
- **Quando** o usuário clica em "Ativar minha conta"
- **Então** o convite é consumido e a senha definida (AC-039), o nome informado é gravado no usuário, uma sessão é criada e o usuário vai para `/pipeline`

#### AC-374 — Convite inválido mostra o erro sem vazar dados da empresa

- **Dado** um token expirado, inexistente ou já utilizado (AC-040)
- **Quando** `/convite/<token>` é aberta
- **Então** a tela mostra "Convite expirado ou já utilizado" orientando falar com o administrador da clínica, com "Ir para login" e "Voltar para validação"; não mostra nome de empresa, de administrador nem e-mail (ASM-128)

### US-103 — Entender por que não tenho acesso

Como usuário sem permissão (ou com a sessão vencida), quero uma explicação
clara e um caminho de volta, para não ficar perdido numa tela de erro.

#### AC-375 — A tela mostra o perfil e o que foi pedido

- **Dado** um ATENDENTE logado que tentou abrir `/indicadores`
- **Quando** ele é levado a `/sem-acesso?de=/indicadores`
- **Então** a tela mostra "Código 403", o perfil autenticado (`ATENDENTE`) e o recurso solicitado com nome legível ("Indicadores"); para uma rota que o sistema não conhece, mostra o caminho tal como veio

#### AC-376 — As ações da tela levam aonde dizem

- **Dado** a tela `/sem-acesso`
- **Quando** o usuário usa os botões
- **Então** "Entrar novamente" leva a `/login`, "Minhas Tarefas" leva a `/tarefas`, e "Solicitar permissão ao Administrador" aparece com o selo "em breve", desabilitado

#### AC-377 — Sem sessão, a tela se apresenta como sessão expirada

- **Dado** a tela aberta sem sessão válida
- **Quando** ela é renderizada
- **Então** o título é "Sessão Expirada", não mostra perfil nem recurso, e o botão principal é "Entrar novamente"

### US-104 — Ligar o navegador à autenticação do CRM novo

Como sistema, preciso de rotas HTTP e de um middleware que usem o Better Auth,
para que só quem tem sessão chegue às telas e APIs do CRM.

#### AC-378 — As rotas do Better Auth atendem pelo navegador

- **Dado** o app rodando
- **Quando** o navegador faz `POST /api/auth/sign-in/email` e `POST /api/auth/sign-out`
- **Então** o Better Auth responde (sessão criada e cookie `HttpOnly`/`Secure`/`SameSite=Lax` no login; sessão apagada no logout), usando o schema em português e o `BETTER_AUTH_SECRET`

#### AC-379 — Sem sessão, páginas vão para o login e APIs respondem 401

- **Dado** um visitante sem sessão
- **Quando** ele abre `/pipeline/abc` e chama `GET /api/oportunidades`
- **Então** a página redireciona para `/login?next=/pipeline/abc` e a API responde 401 com `{codigo:'NAO_AUTENTICADO'}` (sem redirecionar)

#### AC-380 — O que precisa ser público continua público

- **Dado** um visitante sem sessão
- **Quando** ele chama `/login`, `/esqueci-senha`, `/redefinir-senha/x`, `/convite/x`, `/sem-acesso`, `/api/auth/*`, `/api/health`, `/api/whatsapp/webhook`, `/api/webhooks/resend`, `/api/cron/*`, `/_next/*` ou imagens
- **Então** nenhuma delas é redirecionada nem bloqueada pelo middleware (as rotas de webhook e cron seguem protegidas pelos próprios segredos, AC-203, AC-304)

#### AC-381 — Papel sem permissão vai para a tela de sem acesso

- **Dado** um ATENDENTE logado
- **Quando** ele abre a página `/indicadores` e chama `GET /api/relatorios/kpis`
- **Então** a página redireciona para `/sem-acesso?de=/indicadores` e a API responde 403 `{codigo:'SEM_PERMISSAO'}`

#### AC-382 — A raiz leva ao lugar certo

- **Dado** a rota `/`
- **Quando** é aberta por um usuário logado e por um visitante
- **Então** o logado vai para `/pipeline` e o visitante para `/login`

#### AC-383 — `/api/me` entrega o necessário para a casca

- **Dado** um usuário logado
- **Quando** `GET /api/me` é chamado
- **Então** responde nome, e-mail, papel, `isSuperAdmin`, empresa ativa (id e nome) e, só para super admin, a lista de empresas; sem sessão, 401

#### AC-384 — O middleware já não consulta o Supabase

- **Dado** o app sem `NEXT_PUBLIC_SUPABASE_URL` definida
- **Quando** qualquer rota passa pelo middleware
- **Então** ele decide só pela sessão do Better Auth e não faz nenhuma chamada de rede ao Supabase

### US-105 — Ter uma política de senha só

Como usuário, quero as mesmas regras de senha ao ativar a conta e ao
redefinir, para não ser surpreendido por exigências diferentes.

#### AC-385 — O servidor recusa senha fora da política

- **Dado** um token válido de convite ou de redefinição
- **Quando** a senha enviada tem menos de 8 caracteres, ou não tem letra maiúscula, ou não tem número nem símbolo
- **Então** a operação é recusada (400, `SENHA_FRACA`, com a lista dos critérios não atendidos), o token continua válido e nenhuma credencial é gravada

#### AC-386 — As duas telas mostram exatamente as regras que o servidor aplica

- **Dado** as telas de convite e de redefinição
- **Quando** o critério "mínimo 8 caracteres / letra maiúscula / número ou símbolo" é avaliado na tela e no servidor para as mesmas senhas
- **Então** o resultado é idêntico (as duas usam o mesmo módulo de política)

## Fora de escopo

- As telas 6 a 31 do inventário (pipeline, tarefas, agenda, WhatsApp, campanhas, indicadores, relatórios, equipe, motivos de perda, empresas): features 2, 3 e 4 do mesmo roteiro.
- A tela e a rota para **convidar** usuário (`/equipe/convidar`): feature 4. Aqui só se consome o token do convite.
- Busca global (Ctrl+K), notificações e "Solicitar permissão ao Administrador": aparecem como "em breve".
- Conteúdo das páginas de Termos de Uso e de Suporte (os links aparecem como "em breve").
- Modo escuro (o protótipo declara `darkMode: "class"`, mas nenhuma tela o desenha).
- Reescrever as telas legadas (`/admin`, `/relatorios`, `/relatorios-comerciais`): saem nas features 3 e 4 (Q-045).

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-123 | Matriz do menu por papel: ATENDENTE = Operação + Comunicação; GERENTE = + Análises + Equipe e Motivos de Perda; MASTER = tudo menos Empresas; super admin = tudo. Baseada no legado (Indicadores só para GERENTE e MASTER, AC-231) e em ASM-012 (GERENTE convida só ATENDENTE) | aberta | Falta o usuário confirmar, em especial se Relatórios e Comercial podem ser vistos por GERENTE |
| ASM-124 | A largura do menu é a do código do protótipo (`w-64`, 256 px), não os 240 px do texto do `DESIGN.md`; a cor primária é a do código (`#0954c9`), não a `#4379EE` do texto | aberta | O código é o que o Stitch renderizou nos prints; o texto do DESIGN.md diverge dele |
| ASM-125 | As cores do protótipo (`primary`, `secondary`, `background`, `error`…) substituem as do shadcn em `globals.css`; os componentes `src/components/ui/*` passam a ter a nova identidade | aberta | Os componentes legados que usam esses tokens mudam de aparência; as telas legadas serão substituídas nas features 3 e 4 |
| ASM-126 | Após redefinir a senha ou ativar o convite, o sistema cria uma sessão e entra direto (o botão do protótipo diz "Salvar nova senha e entrar" / "Ativar minha conta"), mesmo o AC-041 revogando as sessões antigas | aberta | Implementado como login no servidor logo depois da operação |
| ASM-127 | O nome digitado na tela de convite é gravado em `usuarios.nome` (o convite hoje não carrega nome: `ConvidarUsuarioInput` só tem e-mail, papel e empresa) | aberta | Exige um pequeno ajuste em `definirSenhaComToken` para receber o nome |
| ASM-128 | A tela de convite inválido não mostra os "Contatos do Administrador" que o protótipo traz, porque um token apagado ou inexistente não identifica a empresa e mostrar o contato do MASTER a um desconhecido vazaria dado pessoal | aberta | Desvio deliberado do protótipo, por LGPD |
| ASM-129 | A marca nas telas é **MedCRM** (decisão do usuário em 23/10), com o subtítulo "MedGuia B2B" no menu como no protótipo; os textos do protótipo que dizem "MedGuia" sozinhos (ex.: "registrado no MedGuia") passam a dizer MedCRM | aberta | — |
| ASM-130 | Os itens "em breve" (busca, notificações, ajuda, solicitar permissão, links de Termos e Suporte) são decisão do usuário em 23/10: "manter visual, marcado em breve" | confirmada | Respondido pelo usuário na conversa de 23/10 |
| ASM-131 | O app é servido em HTTPS (o cookie do Better Auth é sempre `Secure`, `useSecureCookies: true`); em desenvolvimento local usa-se o middleware de demonstração ou HTTPS local | aberta | Já era assim em fase1-auth-rbac |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-041 | Qual é a política de senha? O protótipo mostra 4 critérios na redefinição (8+, maiúscula, número, caractere especial) e 3 no convite (8+, maiúscula, número **ou símbolo**). A spec usa os 3 do convite para as duas telas (AC-385) | respondida | Decidido pelo usuário em 2026-10-23: 8+ caracteres, letra maiúscula, número ou símbolo, nas duas telas (a redefinição passa a mostrar 3 critérios, não 4) |
| Q-042 | O protótipo tem selos e textos de conformidade que o sistema não pode afirmar: "HIPAA", "ISO 27001", "SSL 256-bit", "criptografia de ponta a ponta", "Versão 2.4.0/4.12", "MedGuia Tecnologia em Saúde S.A. © 2025". Troco por afirmações verdadeiras ("Conexão segura", versão real do `package.json`, "© 2026 MedGuia")? | respondida | Decidido pelo usuário em 2026-10-23: trocar por afirmações verdadeiras ("Conexão segura", versão do `package.json`, "© 2026 MedGuia"); nenhum selo de certificação sem comprovação |
| Q-043 | Como o sistema envia os e-mails de redefinição (e, na feature 4, de convite)? Não existe envio hoje (só a assinatura do webhook do Resend). Preciso de: a chave `RESEND_API_KEY`, o domínio e o remetente (ex.: `no-reply@medguia.cloud`) | aberta | Sem isso, o reset funciona na tela mas o e-mail não sai. No staging a chave foi deixada de fora de propósito |
| Q-044 | O protótipo tem "Lembrar de mim por 30 dias", mas a sessão dura 7 dias (Q-006). Remover o campo, ou marcado = 30 dias e desmarcado = 7? | respondida | Decidido pelo usuário em 2026-10-23: remover o campo; a sessão continua de 7 dias (Q-006) |
| Q-045 | Enquanto as features 3 e 4 não chegam, as telas legadas (`/` com abas, `/admin`, `/relatorios`, `/relatorios-comerciais`) ainda usam o Supabase e vão quebrar atrás do middleware novo. A raiz `/` passa a redirecionar (AC-382). Posso deixar as outras três quebradas até serem substituídas, ou as redireciono para `/pipeline`? | aberta | Recomendado: redirecionar para `/pipeline` com aviso "em breve", em vez de deixar erro |
