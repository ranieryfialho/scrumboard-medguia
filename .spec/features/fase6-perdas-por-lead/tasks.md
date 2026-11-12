# Tasks: Fase 6 — Quem perdeu, quando e por quê (no card e nos relatórios)

> feature: fase6-perdas-por-lead

## T-340 — Dados da perda no detalhe do card (API) [em-andamento]
- Refs: AC-813, AC-814, AC-815
- Arquivos: src/repositories/perda-do-card.ts, src/app/api/oportunidades/[id]/route.ts
- Notas: `perda: { motivo, etapaOrigem, responsavelNome, ocorridoEm, automatica } | null`; só quando o card está em Perdido; `automatica` quando o motivo é o sistêmico "Cadência esgotada" ou o ator do evento é `sistema`

## T-341 — Bloco "Perda" no detalhe do card [em-andamento]
- Refs: AC-813, AC-814, AC-815
- Arquivos: src/components/pipeline/detalhe/bloco-perda.tsx, src/app/(app)/pipeline/[id]/page.tsx
- Notas: segue o estilo de `bloco-fechamento.tsx`; fuso `America/Sao_Paulo`

## T-342 — Lista de leads perdidos e motivos do marketing (repositórios) [em-andamento]
- Refs: AC-816, AC-818, AC-819
- Arquivos: src/repositories/analises-comercial.ts, src/repositories/analises-marketing.ts
- Notas: `leadsPerdidos[]` na resposta do comercial (mesmo conjunto do bloco de motivos); `motivosDosCaptados` no marketing (coorte de entrada, card hoje em Perdido)

## T-343 — Lista "Leads perdidos" com filtro por motivo (relatório comercial) [em-andamento]
- Refs: AC-816, AC-817, AC-818
- Arquivos: src/components/analises/relatorio-comercial.tsx, src/components/analises/lista-leads-perdidos.tsx
- Notas: paginação 10/20/50/100 (padrão do projeto); clicar no motivo filtra; nome do lead leva a `/pipeline/[id]`

## T-344 — Motivos de perda dos leads captados (relatório de marketing) [em-andamento]
- Refs: AC-819
- Arquivos: src/components/analises/relatorio-marketing.tsx, src/components/analises/motivos-captados.tsx
- Notas: bloco novo "Motivos de perda dos leads captados"; depende de T-342

## T-345 — Testes dos critérios de aceite [em-andamento]
- Refs: AC-813, AC-814, AC-815, AC-816, AC-817, AC-818, AC-819
- Arquivos: test/repositories/analises-perdas.test.ts, test/components/pipeline/bloco-perda.test.tsx, test/components/analises/leads-perdidos.test.tsx
- Notas: os de repositório seguem o harness de Postgres efêmero
