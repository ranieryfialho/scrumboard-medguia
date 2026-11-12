# Tasks: Fase6 qualificação comercial

> feature: fase6-qualificacao-comercial

## T-354 — Domínio da qualificação (pontos, faixas, jornada) [concluida]
- Refs: AC-830, AC-833
- Arquivos: src/domain/qualificacao/qualificacao.ts

## T-355 — Tabela, repositório e API da qualificação [concluida]
- Refs: AC-831
- Arquivos: drizzle/0039_oportunidade_qualificacao.sql, src/db/schema/pipeline.ts, src/repositories/qualificacao.ts, src/app/api/oportunidades/[id]/qualificacao/route.ts

## T-356 — Bloco Qualificação no card e selo reutilizável [concluida]
- Refs: AC-832, AC-833
- Arquivos: src/components/pipeline/detalhe/bloco-qualificacao.tsx, src/components/pipeline/pecas/selo-qualificacao.tsx, src/app/(app)/pipeline/[id]/page.tsx

## T-357 — Selo no funil e coluna com filtro na lista [concluida]
- Refs: AC-834, AC-835
- Arquivos: src/app/api/oportunidades/route.ts, src/components/pipeline/card-oportunidade.tsx, src/repositories/pipeline-lista.ts, src/components/pipeline/tabela-lista.tsx, src/components/pipeline/filtros-lista.tsx
