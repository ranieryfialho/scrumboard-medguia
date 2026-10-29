# Tasks: Fase 5 — Investimento em mídia

> feature: fase5-investimento-midia

## T-224 — Tabela de investimento, regras de cálculo e repositório [pendente]

- Refs: AC-627, AC-628, AC-629, AC-630, AC-631, AC-632, AC-635
- Arquivos: drizzle/0016_investimento_midia.sql, src/db/schema/pipeline.ts, src/lib/investimento/calculo.ts, src/repositories/investimento.ts
- Notas: migration à mão no estilo da 0015; `calculo.ts` tem validação do valor, normalização do canal e o rateio por dias

## T-225 — API de investimento e regra de papel [pendente]

- Refs: AC-627, AC-628, AC-629, AC-630, AC-631, AC-633
- Arquivos: src/app/api/investimento/route.ts, src/lib/auth/rotas.ts
- Notas: `GET ?mes=YYYY-MM` e `PUT` (corpo `{ mes, valores: { canal: número|null } }`), ambos gerente+

## T-226 — Tela de investimento e item no menu [pendente]

- Refs: AC-627, AC-628, AC-629, AC-630, AC-631, AC-639
- Arquivos: src/components/admin/investimento.tsx, src/app/(app)/configuracoes/investimento/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: atualizar a lista de ids do menu no teste da casca

## T-227 — Custo no relatório de marketing [pendente]

- Refs: AC-634, AC-635, AC-636, AC-637, AC-638
- Arquivos: src/repositories/analises-marketing.ts, src/components/analises/relatorio-marketing.tsx
- Notas: cartões e colunas só quando há investimento no período; reaproveita `calculo.ts`

## T-228 — Testes dos critérios de aceite [pendente]

- Refs: AC-627, AC-628, AC-629, AC-630, AC-631, AC-632, AC-633, AC-634, AC-635, AC-636, AC-637, AC-638, AC-639
- Arquivos: test/api/investimento.test.ts, test/api/marketing-custo.test.ts, test/auth/rotas-investimento.test.ts, test/components/admin/investimento.test.tsx, test/components/analises/marketing-custo.test.tsx, test/lib/investimento-calculo.test.ts
- Notas: o teste de rota segue `test/auth/rotas-metas.test.ts`
