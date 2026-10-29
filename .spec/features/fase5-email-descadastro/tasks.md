# Tasks: Fase 5 — E-mail das campanhas, parte 2 (descadastro)

> feature: fase5-email-descadastro

## T-270 — Migration e token assinado do descadastro [pendente]

- Refs: AC-714, AC-717
- Arquivos: drizzle/0023_email_descadastros.sql, src/db/schema/legado.ts, src/lib/email/descadastro-token.ts
- Notas: tabela com RLS e índice único (empresa, e-mail); token HMAC com contexto próprio e comparação em tempo constante

## T-271 — Repositório e rodapé/cabeçalhos [pendente]

- Refs: AC-715, AC-716, AC-717, AC-718, AC-720
- Arquivos: src/repositories/email-descadastros.ts, src/lib/email/descadastro-rodape.ts
- Notas: descadastrar é idempotente; `prepararCorpoComDescadastro` não repete o rodapé

## T-272 — Página pública, rota de um clique e rotas públicas [pendente]

- Refs: AC-715, AC-716, AC-721
- Arquivos: src/app/descadastro/[token]/page.tsx, src/components/email/descadastro.tsx, src/app/api/descadastro/[token]/route.ts, src/lib/auth/rotas.ts
- Notas: a página fica fora do grupo `(app)` (sem casca nem login); abrir não descadastra

## T-273 — Nova campanha sem descadastrados e contagem na tela de e-mail [pendente]

- Refs: AC-718, AC-719
- Arquivos: src/repositories/campanhas.ts, src/app/api/campanhas/previa-destinatarios/route.ts, src/components/campanhas/nova-campanha.tsx, src/components/admin/email-empresa.tsx, src/app/api/configuracoes/email/route.ts
- Notas: a prévia e a criação usam a mesma regra; a contagem entra no `GET` da configuração de e-mail

## T-274 — Testes dos critérios de aceite [pendente]

- Refs: AC-714, AC-715, AC-716, AC-717, AC-718, AC-719, AC-720, AC-721
- Arquivos: test/lib/descadastro-token.test.ts, test/lib/descadastro-rodape.test.ts, test/api/descadastro.test.ts, test/api/campanhas-descadastro.test.ts, test/components/email/descadastro.test.tsx, test/auth/rotas-descadastro.test.ts
- Notas: o token e o rodapé são testados sem banco
