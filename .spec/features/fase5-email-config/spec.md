# Spec: Fase 5 — E-mail das campanhas, parte 1: chave do Resend por empresa e variáveis

> feature: fase5-email-config
> status: rascunho

## Contexto

O motor de disparo de e-mail é hoje um projeto à parte (`worker-medguia-hub`, Python) que lê o
Supabase e usa uma chave do Resend **por empresa**. A decisão do dono do produto é **incorporar o motor
ao CRM** e manter a **chave do Resend por empresa** (cada clínica envia pelo próprio domínio). Esta parte
1 entrega o que o disparo vai precisar, sem enviar nada: a tela e a API para cadastrar a chave e o
remetente da empresa (guardados **cifrados**) e as variáveis `{{nome}}` e `{{primeiro_nome}}` no corpo do
e-mail, com a explicação na tela de nova campanha. O disparo e o pausar são a parte 2
(`fase5-email-disparo`).

## Histórias

### US-169 — Cadastrar a chave do Resend e o remetente da empresa

Como gerente ou master, quero cadastrar a chave do Resend e o remetente da minha empresa, para que as campanhas saiam pelo meu domínio.

#### AC-694 — Tela de e-mail da empresa

- **Dado** a tela `/configuracoes/email`
- **Quando** o gerente a abre
- **Então** vê o campo da chave do Resend (nunca preenchido com a chave salva: mostra "Chave configurada (termina em …abcd)" ou "Chave não configurada") e o campo do remetente; salvar mostra "Configuração salva"; "Remover chave" apaga só a chave; erros aparecem junto do campo; o atendente não abre a tela

#### AC-695 — API: nunca devolve a chave

- **Dado** `GET` e `PUT /api/configuracoes/email`
- **Quando** o gerente lê e grava
- **Então** `GET` devolve `chaveConfigurada`, `chaveFinal` (os 4 últimos caracteres, ou nulo) e `remetente`, **nunca a chave**; `PUT` aceita `chave` (começa com `re_`, de 20 a 200 caracteres, sem espaços) e `remetente` (`email@dominio.com` ou `Nome <email@dominio.com>`, até 200 caracteres); omitir `chave` mantém a atual; `chave: null` remove; valores inválidos dão 400 com o campo e nada é gravado; atendente 403 e sem sessão 401

#### AC-696 — A chave fica cifrada no banco

- **Dado** uma chave salva
- **Quando** se olha o valor guardado em `empresa_configuracoes`
- **Então** ele não contém a chave em texto puro (cifra AES-256-GCM, com o segredo `SEGREDO_CONFIGURACOES`); só o worker de disparo a decifra (`lerConfiguracaoDeEmail`); sem o segredo configurado, salvar uma chave dá 503 `CONFIGURACAO_INDISPONIVEL` e nada é gravado

#### AC-697 — Cada empresa tem a sua

- **Dado** a empresa A com uma chave e remetente e a empresa B com outros
- **Quando** cada gerente lê e a leitura do worker é feita por empresa
- **Então** cada uma vê e usa só a própria configuração; trocar ou remover a chave da A não mexe na da B

#### AC-698 — Menu e acesso

- **Dado** o menu de Administração
- **Quando** o gerente ou master o abre
- **Então** vê "E-mail" apontando para uma página que existe; o atendente não vê o item e é barrado na tela e na API

### US-170 — Variáveis no corpo do e-mail

Como gerente, quero personalizar o e-mail com o nome do destinatário, para que a mensagem não seja genérica.

#### AC-699 — O que cada variável vira

- **Dado** o corpo de um e-mail com `{{nome}}` e `{{primeiro_nome}}` e um destinatário "Maria Souza"
- **Quando** o corpo é preenchido para o envio ou para a prévia
- **Então** `{{nome}}` vira "Maria Souza" e `{{primeiro_nome}}` vira "Maria"; as grafias antigas do motor anterior (`{{Nome}}`, `{nome}`, `{Nome}`, `[nome]`, `[Nome]`) continuam valendo e viram o nome completo; destinatário sem nome vira "Cliente"; o nome é escapado como HTML (um nome com `<` ou `&` não vira marcação); `{{outra}}` desconhecida fica como está

#### AC-700 — Explicação e prévia na tela de nova campanha

- **Dado** a tela de nova campanha
- **Quando** o gerente escreve o corpo
- **Então** a seção "Variáveis disponíveis" explica `{{nome}}` e `{{primeiro_nome}}` (o que cada uma vira e um exemplo, como na tela de templates do WhatsApp), o botão "Inserir" coloca o shortcode onde está o cursor, e a prévia do e-mail mostra o corpo já preenchido com um nome de exemplo ("Maria Souza")

## Fora de escopo

- **Enviar** e-mail, a fila, o ritmo e pausar a campanha: parte 2 (`fase5-email-disparo`).
- Validar a chave chamando o Resend, verificar o domínio do remetente e mostrar o estado do domínio.
- Rotacionar o segredo de cifra (trocar `SEGREDO_CONFIGURACOES` invalida as chaves salvas: elas precisam ser cadastradas de novo).
- Mais variáveis (clínica, telefone, etapa) e a conversão de campanhas antigas.
- Remetente padrão da MedGuia para empresas sem configuração: sem chave, a campanha não envia (parte 2).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-256 | A chave e o remetente ficam em `empresa_configuracoes` (chaves `resend_api_key` e `resend_remetente`, como no sistema legado), com RLS por empresa; o valor da chave é guardado cifrado (`iv:tag:texto` em base64) e o remetente em texto | aberta | Não precisa de migration |
| ASM-257 | O segredo de cifra é a variável de ambiente `SEGREDO_CONFIGURACOES` (mínimo de 32 caracteres), nova no `.env` e no cutover | aberta | Sem ela, o resto do CRM funciona; só salvar a chave fica indisponível |
| ASM-258 | A tela é de gerente, master e super admin, no grupo Administração; o atendente nunca vê a chave nem a tela | aberta | Mesma regra de motivos de perda e metas |
| ASM-259 | Sem remetente cadastrado vale o remetente padrão `RESEND_REMETENTE` do ambiente (ou `no-reply@medguia.cloud`); a chave nunca tem padrão | aberta | A chave é sempre da empresa |
| ASM-260 | O renderizador de variáveis é uma função pura de `src/lib/email/`, usada pela prévia (cliente) e pelo disparo (worker) | aberta | A prévia mostra o que sai |

## Perguntas em aberto

Nenhuma.
