# Tasks: Fase 5 — E-mail das campanhas, parte 1

> feature: fase5-email-config

## T-259 — Cifra, configuração de e-mail e renderizador de variáveis [pendente]

- Refs: AC-695, AC-696, AC-697, AC-699
- Arquivos: src/lib/seguranca/cifra.ts, src/lib/email/campanha-corpo.ts, src/repositories/email-config.ts
- Notas: AES-256-GCM com `SEGREDO_CONFIGURACOES`; `lerConfiguracaoDeEmail(db, empresaId)` é o que o worker usa

## T-260 — API de configuração de e-mail e regras de acesso [pendente]

- Refs: AC-695, AC-696, AC-697, AC-698
- Arquivos: src/app/api/configuracoes/email/route.ts, src/lib/auth/rotas.ts
- Notas: gerente+; a chave nunca volta na resposta

## T-261 — Tela de e-mail da empresa e item de menu [pendente]

- Refs: AC-694, AC-698
- Arquivos: src/components/admin/email-empresa.tsx, src/app/(app)/configuracoes/email/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: atualizar a lista de ids do menu na casca

## T-262 — Variáveis e prévia na tela de nova campanha [pendente]

- Refs: AC-699, AC-700
- Arquivos: src/components/campanhas/nova-campanha.tsx, src/components/campanhas/previa-email.tsx
- Notas: reaproveita a seção "Variáveis disponíveis" e o botão Inserir da tela de templates (extrair como componente compartilhado)

## T-263 — Testes dos critérios de aceite [pendente]

- Refs: AC-694, AC-695, AC-696, AC-697, AC-698, AC-699, AC-700
- Arquivos: test/lib/cifra.test.ts, test/lib/email-campanha-corpo.test.ts, test/api/email-config.test.ts, test/components/admin/email-empresa.test.tsx, test/components/campanhas/variaveis-email.test.tsx, test/auth/rotas-email.test.ts
- Notas: a cifra é testada sem Postgres; o resto contra o banco efêmero
