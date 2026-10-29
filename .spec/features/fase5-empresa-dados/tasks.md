# Tasks: Fase 5 — Dados da empresa

> feature: fase5-empresa-dados

## T-235 — Colunas da empresa, validações e repositório [concluida]
- Refs: AC-651, AC-652, AC-653, AC-654
- Arquivos: drizzle/0018_empresa_dados.sql, src/db/schema/identidade.ts, src/lib/empresa/validacao.ts, src/repositories/empresas-admin.ts
- Notas: migration só acrescenta colunas e um índice único parcial do CNPJ; CNPJ válido pelos dígitos verificadores

## T-236 — API de empresas com os novos dados [concluida]
- Refs: AC-651, AC-652, AC-653, AC-654
- Arquivos: src/app/api/admin/empresas/route.ts, src/app/api/admin/empresas/[id]/route.ts
- Notas: POST e PATCH validam por campo (400) e CNPJ repetido dá 409

## T-237 — Cota de assentos no convite e na reativação [concluida]
- Refs: AC-655, AC-656
- Arquivos: src/lib/empresa/assentos.ts, src/lib/auth/convites.ts, src/repositories/equipe.ts, src/app/api/equipe/route.ts, src/app/api/equipe/convites/route.ts
- Notas: a checagem roda dentro da transação, com a linha da empresa travada, para dois convites simultâneos não furarem a cota

## T-238 — Telas de empresas e equipe com os novos dados [concluida]
- Refs: AC-657, AC-658, AC-659
- Arquivos: src/components/admin/nova-empresa.tsx, src/components/admin/editar-empresa.tsx, src/components/admin/empresas.tsx, src/components/admin/equipe.tsx, src/components/admin/convidar-usuario.tsx, src/components/admin/comum.ts
- Notas: o resumo da equipe passa a devolver os assentos

## T-239 — Testes dos critérios de aceite [concluida]
- Refs: AC-651, AC-652, AC-653, AC-654, AC-655, AC-656, AC-657, AC-658, AC-659
- Arquivos: test/lib/empresa-validacao.test.ts, test/api/empresas-dados.test.ts, test/api/equipe-assentos.test.ts, test/components/admin/empresa-dados.test.tsx
- Notas: ajustar os testes antigos de empresas e equipe que afirmam "em breve" ou o formato do resumo
