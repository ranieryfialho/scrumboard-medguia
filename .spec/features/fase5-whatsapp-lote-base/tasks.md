# Tasks: Fase 5 — WhatsApp em lote, parte 1 (base)

> feature: fase5-whatsapp-lote-base

## T-245 — Migration, regras puras e templates (repositório) [concluida]
- Refs: AC-667, AC-670, AC-671, AC-672, AC-674, AC-675
- Arquivos: drizzle/0020_whatsapp_lote_base.sql, src/db/schema/legado.ts, src/db/schema/pipeline.ts, src/lib/whatsapp/lote-regras.ts, src/lib/whatsapp/template.ts, src/repositories/whatsapp-templates.ts
- Notas: colunas de consentimento em `leads`; tabela `whatsapp_templates` com RLS; regras e renderização são funções puras

## T-246 — API de consentimento do lead [concluida]
- Refs: AC-667, AC-668
- Arquivos: src/repositories/lead-consentimento.ts, src/app/api/leads/[id]/consentimento/route.ts
- Notas: GET e PUT por lead; 404 para outra empresa

## T-247 — API de templates, regras e prévia do lote [concluida]
- Refs: AC-670, AC-671, AC-672, AC-674, AC-675, AC-676
- Arquivos: src/app/api/whatsapp/templates/route.ts, src/app/api/whatsapp/templates/[id]/route.ts, src/app/api/whatsapp/lote/regras/route.ts, src/app/api/whatsapp/lote/previa/route.ts, src/repositories/whatsapp-lote-previa.ts
- Notas: criar, editar, aprovar e arquivar são gerente+; a lista do atendente só traz aprovados

## T-248 — Telas: consentimento no card e templates [concluida]
- Refs: AC-669, AC-673
- Arquivos: src/components/pipeline/detalhe/consentimento-whatsapp.tsx, src/app/(app)/pipeline/[id]/page.tsx, src/components/whatsapp/templates.tsx, src/app/(app)/whatsapp/templates/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: bloco novo abaixo de Informações Principais (não altera o AC-407); atualizar a lista de ids do menu na casca

## T-249 — Testes dos critérios de aceite [concluida]
- Refs: AC-667, AC-668, AC-669, AC-670, AC-671, AC-672, AC-673, AC-674, AC-675, AC-676
- Arquivos: test/lib/whatsapp-lote-regras.test.ts, test/api/lead-consentimento.test.ts, test/api/whatsapp-templates.test.ts, test/api/whatsapp-lote-previa.test.ts, test/components/whatsapp/templates.test.tsx, test/components/pipeline/consentimento-whatsapp.test.tsx, test/auth/rotas-templates.test.ts
- Notas: o teste de menu segue `test/auth/rotas-metas.test.ts`
