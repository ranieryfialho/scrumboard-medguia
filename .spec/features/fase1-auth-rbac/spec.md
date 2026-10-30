# Spec: Fase 1 — Auth + RBAC

> feature: fase1-auth-rbac
> status: auditada

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

A `fase1-schema-drizzle` entregou as tabelas de identidade (`usuarios`,
`empresas_usuarios`) e as tabelas do adaptador Better Auth (`contas`,
`sessoes`, `tokens_verificacao`), mas deixou explícito que "configurar a
biblioteca em si é escopo da feature `fase1-auth-rbac`" (comentário em
`src/db/schema/auth.ts`). Esta feature liga o Better Auth a esse schema e
entrega a camada de servidor de autenticação/autorização (login, convite,
definição de senha, reset, resolução de sessão/tenant, RBAC por papel) que o
TDD-001 §4.7 e §6 descrevem — provada contra Postgres efêmero de teste, nos
mesmos moldes da `fase1-schema-drizzle` (ver ASM-010).

## Histórias

<!-- História de usuário: quem precisa, o que precisa e por quê. -->

### US-014 — Login com e-mail e senha cria sessão persistida

Como usuário com credencial definida, quero logar com e-mail e senha, para
acessar o sistema com uma sessão válida.

#### AC-033 — Login com credenciais corretas cria sessão

- **Dado** um usuário ativo com credencial (senha) já definida
- **Quando** ele envia e-mail e senha corretos ao endpoint de login
- **Então** uma sessão é criada em `sessoes`, vinculada ao usuário, com
  token, expiração e cookie `httpOnly`/`Secure`/`SameSite=Lax`

#### AC-034 — Login com credenciais incorretas é recusado

- **Dado** um usuário existente com credencial definida
- **Quando** ele envia uma senha incorreta
- **Então** o login é recusado e nenhuma sessão é criada

#### AC-035 — Login de usuário inativo é bloqueado

- **Dado** um usuário com `ativo = false`
- **Quando** ele tenta logar com e-mail e senha corretos
- **Então** o login é recusado e nenhuma sessão é criada

### US-015 — Convite de novo usuário por administrador da empresa

Como usuário MASTER ou GERENTE de uma empresa, quero convidar alguém por
e-mail com um papel definido, para que essa pessoa ganhe acesso ao sistema
sob o tenant correto.

#### AC-036 — Convite válido cria vínculo pendente e token de uso único

- **Dado** um usuário MASTER autenticado na empresa X
- **Quando** ele convida um e-mail novo informando um papel
  (`MASTER`/`GERENTE`/`ATENDENTE`)
- **Então** um vínculo em `empresas_usuarios` é criado para a empresa X com
  esse papel, e um token de convite de uso único com prazo curto é gerado em
  `tokens_verificacao`

#### AC-037 — Papel sem permissão de convidar é recusado

- **Dado** um usuário com papel `ATENDENTE` autenticado
- **Quando** ele tenta convidar um novo usuário
- **Então** a ação é recusada e nenhum convite é criado

#### AC-038 — Super admin convida explicitamente para qualquer empresa

- **Dado** um usuário com `is_super_admin = true` autenticado
- **Quando** ele convida um e-mail informando explicitamente a empresa de
  destino
- **Então** o convite é criado para aquela empresa e um evento de auditoria
  registra quem convidou, para qual empresa e com qual papel

### US-016 — Definição de senha a partir do convite

Como usuário convidado, quero definir minha senha a partir do link de
convite, para poder acessar minha conta.

#### AC-039 — Token de convite válido define a senha e habilita o login

- **Dado** um token de convite válido e não expirado
- **Quando** o usuário define uma senha através dele
- **Então** a credencial é criada, o token é invalidado (uso único) e o
  usuário passa a conseguir logar

#### AC-040 — Token expirado ou já usado é recusado

- **Dado** um token de convite expirado ou já utilizado
- **Quando** alguém tenta definir senha com ele
- **Então** a operação é recusada e nenhuma credencial é criada ou alterada

### US-017 — Reset de senha

Como usuário, quero solicitar a redefinição da minha senha, para recuperar o
acesso sem depender de um administrador.

#### AC-041 — Reset com token válido troca a senha e revoga sessões ativas

- **Dado** um token de reset de senha válido
- **Quando** o usuário define uma nova senha através dele
- **Então** a senha é atualizada, o token é invalidado e todas as sessões
  ativas desse usuário em `sessoes` são revogadas

#### AC-042 — Solicitação de reset não revela se o e-mail existe

- **Dado** um e-mail qualquer, cadastrado ou não
- **Quando** o reset de senha é solicitado para esse e-mail
- **Então** a resposta observável é idêntica nos dois casos (não dá para
  distinguir e-mail existente de inexistente pela resposta)

### US-018 — Resolução de sessão e tenant no servidor

Como servidor, preciso resolver `empresa_id` e papel a partir da sessão
autenticada, nunca do corpo da requisição, para que nenhuma rota confie em
tenant informado pelo cliente.

#### AC-043 — `empresa_id` da sessão prevalece sobre o do corpo da requisição

- **Dado** um usuário autenticado com papel `GERENTE` na empresa X
- **Quando** uma requisição a uma rota protegida chega com um `empresa_id`
  diferente no corpo
- **Então** o servidor ignora o valor do corpo e resolve o `empresa_id` a
  partir da sessão (empresa X)

#### AC-044 — Requisição sem sessão válida é bloqueada

- **Dado** nenhuma sessão válida (ausente, expirada ou revogada)
- **Quando** uma rota protegida por sessão é chamada
- **Então** a resposta é de não autenticado e nenhum dado é retornado

### US-019 — Troca de empresa pelo super admin

Como super admin, quero alternar explicitamente a empresa em que estou
atuando, para operar sob o tenant de qualquer cliente quando necessário, com
o registro de que fiz isso.

#### AC-045 — Super admin troca de empresa com evento de auditoria

- **Dado** um usuário com `is_super_admin = true` autenticado, atuando na
  empresa X
- **Quando** ele seleciona explicitamente a empresa Y para atuar
- **Então** as próximas resoluções de tenant nessa sessão retornam a
  empresa Y, e um evento de auditoria registra o usuário, a empresa anterior
  e a nova

#### AC-046 — Usuário comum não pode alternar de empresa

- **Dado** um usuário sem `is_super_admin` autenticado na empresa X
- **Quando** ele tenta selecionar outra empresa para atuar
- **Então** a ação é recusada e o `empresa_id` resolvido da sessão continua
  sendo X

#### AC-728 — A empresa escolhida pelo super admin vale para todos os dados

- **Dado** um super admin que trocou a empresa ativa pelo seletor
- **Quando** ele abre qualquer tela ou chama qualquer API de dados (cards, campanhas, equipe...)
- **Então** só enxerga e só grava dados da empresa escolhida (o isolamento por empresa é aplicado com ela), e não os da primeira empresa dele
- **E** a escolha fica gravada na sessão: sobrevive a reinício do servidor e vale também para o `/api/me`

#### AC-729 — Só o super admin atua numa empresa escolhida

- **Dado** um usuário que não é super admin, com a empresa ativa de uma sessão preenchida à força
- **Quando** o contexto da sessão é resolvido
- **Então** o valor é ignorado e vale o vínculo dele, sempre o mais antigo, e nunca "o primeiro que o banco devolver"

### US-020 — Rate limit em login, convite e reset

Como sistema, preciso limitar tentativas de login, convite e reset por IP e
por e-mail, para mitigar força bruta e abuso, com as tentativas registradas.

#### AC-047 — Excesso de tentativas de login bloqueia temporariamente

- **Dado** um número de tentativas de login malsucedidas acima do limite
  configurado, para o mesmo e-mail ou IP, dentro de uma janela de tempo
- **Quando** uma nova tentativa é feita dentro dessa janela, mesmo com
  credenciais corretas
- **Então** a requisição é recusada por limite de taxa

## Fora de escopo

- Substituir o Supabase Auth em produção: religar `src/middleware.ts`, as
  rotas atuais de `src/app/api/usuarios`, ou as telas de login/convite/reset
  hoje ativas. Isso é trabalho de cutover da Fase 3 — enquanto o cutover não
  acontece, a base atual em produção continua no Supabase Auth.
- Telas de UI novas de login/convite/reset (esta feature entrega a camada de
  servidor e a biblioteca; a UI é escopo de Fase 2/Fase 3).
- Login social/OAuth ou SSO com provedores externos.
- Migração de credenciais e sessões existentes do Supabase (isso é ETL de
  Fase 3, com convites de senha no cutover — TDD-001 §6, linha do Cutover).
- Validar se o ator tem o papel permitido numa transição de etapa do
  pipeline (guards de domínio) — isso é escopo de `fase1-dominio-pipeline`;
  esta feature entrega o papel resolvido da sessão, não a regra de negócio
  que o consome.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-010 | Os testes desta feature sobem seu próprio Postgres 15 efêmero (mesmo padrão de `fase0-fundacao-ci-staging`/`fase1-schema-drizzle`), sem tocar `crm_staging`/`crm_prod` da VPS — Better Auth fica configurado e provado, mas não substitui a autenticação da aplicação em produção até o cutover | confirmada | Confirmado: os 8 arquivos de teste desta feature usam `test/support/postgres-efemero.ts` (mesmo harness Docker de `fase1-schema-drizzle`). |
| ASM-011 | O Better Auth consegue ser configurado para usar os nomes de tabela/coluna em português já definidos em `src/db/schema/auth.ts` (`contas`, `sessoes`, `tokens_verificacao`) e `identidade.ts` (`usuarios`) via mapeamento de campos, sem exigir tabelas adicionais no padrão em inglês da biblioteca | confirmada | Confirmado via `modelName`/`fields` em `src/lib/auth/server.ts` (T-026) — `sessoes`/`contas`/`tokens_verificacao` mapearam 1:1; `usuarios` precisou de 2 colunas novas (`email_verificado`, `imagem`), adicionadas nesta feature (migration `drizzle/0006_...`). Confirmado também que os campos internos do Better Auth (`providerId="credential"`, `accountId=<id do usuário>`) são literais fixos da lib — T-028/T-029/T-030 foram ajustadas para escrevê-los corretamente, corrigindo uma incompatibilidade que a implementação inicial (hand-rolled, sem a lib) tinha introduzido. |
| ASM-012 | Um usuário `GERENTE` pode convidar apenas para o papel `ATENDENTE` (não pode criar outro `MASTER` ou `GERENTE`); apenas `MASTER` e super admin podem convidar para qualquer papel dentro da própria empresa | confirmada | Implementado em `podeConvidar` (T-028, `src/lib/auth/convites.ts`) e provado por `AC-037`. |
| ASM-277 | Sem vínculo na empresa escolhida, o super admin atua nela como MASTER | aberta | Achado em 30/10: o seletor de empresa só trocava o nome no topo, e os dados seguiam os da primeira empresa |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-005 | Qual o limite exato de tentativas e a janela de tempo do rate limit de login/convite/reset (TDD-001 §7 menciona "limite por IP e por e-mail" sem números)? | respondida | Decidido pelo usuário (Raniery) em 2026-09-25: 5 tentativas / 15 minutos, por IP e por e-mail. Aplicado em `src/lib/auth/rate-limit.ts` (`LIMITE_PADRAO_TENTATIVAS`/`JANELA_PADRAO_MS`, já batia com o default) e no `rateLimit` interno do Better Auth em `src/lib/auth/server.ts` (`window: 15 * 60, max: 5`). |
| Q-006 | Qual o prazo de expiração da sessão (TDD-001 §4.7 diz "expiração configurável" sem valor) e do token de convite/reset? | respondida | Decidido pelo usuário (Raniery) em 2026-09-25: sessão expira em 7 dias, convite e reset de senha em 24h. Aplicado em `src/lib/auth/server.ts` (`session.expiresIn = 60*60*24*7`), `src/lib/auth/convites.ts` (`TTL_CONVITE_MS` de 48h para 24h) e `src/lib/auth/reset-senha.ts` (`TTL_RESET_MS` de 1h para 24h). |
