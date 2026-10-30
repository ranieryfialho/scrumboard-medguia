# Tasks: Fase 1 — Auth + RBAC

> feature: fase1-auth-rbac

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - Toda tarefa referencia em `Refs:` pelo menos uma história de usuário
    (US-xxx) ou critério de aceite (AC-xxx).
  - Toda tarefa lista os arquivos que cria/altera em `Arquivos:` — capriche:
    é o que decide o que `onp-spec plano` roda em PARALELO (arquivos
    disjuntos) e o que roda em sequência.
  - Campos opcionais por tarefa, usados pelo plano de execução:
    `- Modelo: claude-sonnet-5` e `- Esforço: alto` (baixo|medio|alto|xalto|max).
  - Uma tarefa só pode virar [concluida] quando os critérios de aceite dela
    tiverem prova PASS registrada por `onp-spec verify`.
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)
-->

## T-026 — Instala e configura o Better Auth sobre o schema existente [concluida]
- Refs: US-014
- Arquivos: package.json, src/lib/auth/server.ts, test/auth/config.test.ts
- Modelo: claude-sonnet-5
- Esforço: alto
- Notas: adaptador Drizzle do Better Auth mapeado para `contas`/`sessoes`/
  `tokens_verificacao` (src/db/schema/auth.ts) e `usuarios`
  (src/db/schema/identidade.ts), sem criar tabelas novas em inglês. Testes
  sobem Postgres efêmero (test/support/postgres-efemero.ts) — nunca tocam
  `crm_staging`/`crm_prod` da VPS (ASM-010). Base para todas as tarefas
  seguintes.

## T-027 — Login com e-mail/senha [concluida]
- Refs: US-014, AC-033, AC-034, AC-035
- Arquivos: src/lib/auth/login.ts, test/auth/login.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-026 (config do Better Auth). Cobre credencial correta
  (cria sessão), credencial incorreta (recusa) e usuário `ativo = false`
  (bloqueia mesmo com credencial correta).

## T-028 — Convite de usuário por administrador da empresa [concluida]
- Refs: US-015, AC-036, AC-037, AC-038
- Arquivos: src/lib/auth/convites.ts, test/auth/convites.test.ts
- Modelo: claude-sonnet-5
- Esforço: alto
- Notas: depende de T-026. RBAC de quem pode convidar (MASTER/GERENTE dentro
  da própria empresa, conforme papel do convidado — ASM-012; super admin
  para qualquer empresa com evento de auditoria).

## T-029 — Definição de senha a partir do convite [concluida]
- Refs: US-016, AC-039, AC-040
- Arquivos: src/lib/auth/definir-senha.ts, test/auth/definir-senha.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-026 e do token gerado por T-028. Token de uso único:
  válido define a credencial; expirado ou já usado é recusado.

## T-030 — Reset de senha [concluida]
- Refs: US-017, AC-041, AC-042
- Arquivos: src/lib/auth/reset-senha.ts, test/auth/reset-senha.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-026. Reset revoga todas as sessões ativas do usuário;
  a resposta da solicitação não distingue e-mail existente de inexistente
  (evita enumeração de contas).

## T-031 — Resolução de sessão e tenant no servidor [concluida]
- Refs: US-018, AC-043, AC-044
- Arquivos: src/lib/auth/tenant.ts, test/auth/tenant.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-026 e T-027 (precisa de sessão criada). `empresa_id` e
  papel resolvidos exclusivamente da sessão — nunca aceitos do corpo da
  requisição.

## T-032 — Troca de empresa pelo super admin [concluida]
- Refs: US-019, AC-045, AC-046
- Arquivos: src/lib/auth/troca-empresa.ts, test/auth/troca-empresa.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-031 (usa a resolução de tenant). Só super admin troca;
  a troca gera evento de auditoria com usuário, empresa anterior e nova.

## T-033 — Rate limit de login, convite e reset [concluida]
- Refs: US-020, AC-047
- Arquivos: src/lib/auth/rate-limit.ts, test/auth/rate-limit.test.ts
- Modelo: claude-sonnet-5
- Esforço: medio
- Notas: depende de T-026 (aplicado sobre login/convite/reset de T-027,
  T-028 e T-030). Limite por IP e por e-mail — números exatos ficam em
  Q-005 (usar um default razoável documentado até a resposta).

## T-280 — A empresa ativa do super admin é gravada na sessão e vale para todos os dados [pendente]
- Refs: US-019, AC-728, AC-729
- Arquivos: drizzle/0025_sessao_empresa_ativa.sql, src/db/schema/auth.ts, src/lib/auth/troca-empresa.ts, src/lib/auth/tenant.ts, src/app/api/empresa-ativa/route.ts, src/app/api/me/route.ts, test/auth/empresa-ativa-sessao.test.ts
- Notas: até aqui a troca vivia num mapa em memória que só o /api/me consultava; todas as APIs de dados usavam o primeiro vínculo do usuário.
