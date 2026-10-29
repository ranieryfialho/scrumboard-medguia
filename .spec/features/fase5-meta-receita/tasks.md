# Tasks: Fase 5 — Meta de receita mensal (Novo MRR)

> feature: fase5-meta-receita

## T-255 — Migration e catálogo com unidade [concluida]
- Refs: AC-688, AC-689, AC-692, AC-693
- Arquivos: drizzle/0022_meta_receita.sql, src/lib/metas/catalogo.ts, src/repositories/metas.ts, src/app/api/metas/route.ts
- Notas: coluna `valor` vira `numeric(12,2)`; limite por chave no banco; o catálogo ganha `unidade` (porcentagem ou reais), `metaValida(chave, valor)`, `ehMesInteiro` e o texto do selo em reais

## T-256 — Tela de metas com o campo em reais [concluida]
- Refs: AC-687, AC-689
- Arquivos: src/components/admin/metas.tsx
- Notas: bloco "Comercial"; aceita `50000`, `50.000` e `50.000,50`; sufixo "R$" no lugar de "%"

## T-257 — Selo da meta de receita no relatório comercial [concluida]
- Refs: AC-690, AC-691
- Arquivos: src/components/analises/relatorio-comercial.tsx
- Notas: só em período de mês inteiro e sem filtro de responsável (ASM-255)

## T-258 — Testes dos critérios de aceite [concluida]
- Refs: AC-687, AC-688, AC-689, AC-690, AC-691, AC-692, AC-693
- Arquivos: test/lib/metas-receita.test.ts, test/api/metas-receita.test.ts, test/db/metas-receita.test.ts, test/components/admin/metas-receita.test.tsx, test/components/analises/meta-receita.test.tsx
- Notas: os testes antigos de metas (AC-615 a AC-626) continuam passando sem mudança de comportamento
