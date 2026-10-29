# Spec: Fase 5 — E-mail das campanhas, parte 2: descadastro (opt-out)

> feature: fase5-email-descadastro
> status: rascunho

## Contexto

E-mail de marketing precisa de um jeito de a pessoa **sair da lista** (LGPD). O motor de disparo atual não
tem isso. O dono do produto decidiu incluir o descadastro agora. Esta feature entrega: o **link de
descadastro** assinado (um por destinatário e empresa), a **página pública** onde a pessoa confirma, o
descadastro por **um clique** do cliente de e-mail (cabeçalhos `List-Unsubscribe`), a **lista de
descadastrados por empresa** e o respeito a ela ao montar a campanha. O envio em si (rodapé, cabeçalhos e
pular quem saiu) acontece no disparo (`fase5-email-disparo`). O descadastro vale só para **e-mail**; WhatsApp
tem o próprio consentimento.

## Histórias

### US-174 — Sair da lista de e-mails de uma empresa

Como destinatário de uma campanha, quero deixar de receber os e-mails da empresa com um clique, sem precisar de login.

#### AC-714 — Link assinado e à prova de adulteração

- **Dado** a empresa A e o e-mail "Maria@Clinica.com"
- **Quando** o sistema gera o link de descadastro e depois o confere
- **Então** o link é `<NEXT_PUBLIC_APP_URL>/descadastro/<token>`, o token é assinado (HMAC-SHA256, com contexto próprio) e o e-mail é tratado sem diferenciar maiúsculas; token adulterado, truncado, vazio ou de outra empresa/e-mail é recusado; o token não carrega a chave de ninguém e dois e-mails ou duas empresas nunca geram o mesmo token

#### AC-715 — Página pública de confirmação

- **Dado** a página `/descadastro/[token]`, aberta sem login
- **Quando** a pessoa a abre
- **Então** abrir **não** descadastra (programas de e-mail abrem links sozinhos): a página pergunta "Deseja deixar de receber e-mails de <nome da empresa>?" com o botão "Confirmar descadastro"; ao confirmar mostra "Pronto: você não receberá mais e-mails de <empresa>"; repetir é inofensivo (idempotente); token inválido mostra "Link inválido" sem dizer nada da empresa nem do e-mail

#### AC-716 — Um clique pelo cliente de e-mail

- **Dado** o `POST /api/descadastro/[token]` que o Gmail e outros chamam pelo cabeçalho `List-Unsubscribe-Post`
- **Quando** o cliente envia `List-Unsubscribe=One-Click`
- **Então** o e-mail é descadastrado na hora, sem tela (200); `GET` na mesma rota não altera nada; token inválido dá 400 e nada é gravado

#### AC-717 — Lista por empresa

- **Dado** o mesmo e-mail descadastrado da empresa A
- **Quando** se consulta quem está descadastrado em cada empresa
- **Então** ele está na lista da A (uma vez só, mesmo descadastrando duas vezes, em qualquer grafia de maiúsculas) e **não** na da B: a empresa B continua podendo enviar a ele; a gestão de cada empresa só vê a própria lista

#### AC-718 — Nova campanha deixa os descadastrados de fora

- **Dado** destinatários que a empresa já descadastrou, vindos das etapas do pipeline ou de uma lista colada
- **Quando** o gerente vê a prévia e cria a campanha
- **Então** a prévia diz quantos descadastrados ficam de fora e a campanha é criada sem eles (nenhum vira envio); a contagem da prévia e o total criado batem

#### AC-719 — A gestão vê a contagem, não recadastra

- **Dado** a tela de e-mail da empresa (`/configuracoes/email`)
- **Quando** o gerente a abre
- **Então** vê "N e-mails descadastrados"; não há como recadastrar alguém (só a própria pessoa decide, e o CRM não oferece essa ação)

#### AC-720 — Rodapé e cabeçalhos do e-mail

- **Dado** o corpo HTML de uma campanha e o link do destinatário
- **Quando** o e-mail é preparado para o envio
- **Então** o corpo ganha, no fim, o rodapé "Para deixar de receber estes e-mails, clique aqui" com o link (antes de `</body>`, quando existir), e o envio leva os cabeçalhos `List-Unsubscribe: <link>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; se o corpo já contém o link, o rodapé não é repetido

#### AC-721 — Rotas públicas, o resto protegido

- **Dado** as rotas `/descadastro/*` e `/api/descadastro/*`
- **Quando** alguém sem sessão as acessa
- **Então** elas respondem (são públicas); as demais rotas (por exemplo `/configuracoes/email`) seguem exigindo login e papel

## Fora de escopo

- **Recadastrar** quem saiu e importar uma lista de descadastrados de fora.
- Descadastro de WhatsApp (o consentimento do lead já cobre) e preferências parciais ("só receber novidades").
- Registrar o motivo do descadastro, o IP e o histórico; relatório de descadastros por campanha.
- Tratar `bounce` e `complaint` do Resend como descadastro (hoje só aberto e clicado voltam pelo webhook).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-268 | O token é `base64url(empresaId.email)` + `.` + HMAC-SHA256 (contexto `descadastro:`) com o segredo `SEGREDO_CONFIGURACOES` (o mesmo da cifra da chave do Resend, com contexto separado); trocar o segredo invalida os links já enviados | aberta | Evita mais uma variável de ambiente; links antigos param de valer se o segredo mudar |
| ASM-269 | A tabela `email_descadastros` (empresa, e-mail em minúsculas, data) tem RLS por empresa e índice único (empresa, e-mail); a página pública e a rota usam o contexto da empresa do token (`comTenant`) | aberta | Migration 0023 (a do disparo passa a 0024) |
| ASM-270 | A página pública mostra o nome da empresa (que está no token por id); não mostra o e-mail completo (só o mascarado, `m***@clinica.com`) | aberta | Privacidade de quem abre o link |
| ASM-271 | Descadastro vale para todos os e-mails da empresa, de qualquer campanha, para sempre; não há prazo | aberta | Simples e conservador (LGPD) |

## Perguntas em aberto

Nenhuma.
