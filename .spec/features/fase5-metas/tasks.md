# Tasks: Fase 5 — Metas cadastradas pela gestão

> feature: fase5-metas

## T-219 — Tabela de metas, catálogo e repositório [pendente]

- Refs: AC-615, AC-616, AC-617, AC-618, AC-619
- Arquivos: drizzle/0015_empresa_metas.sql, src/db/schema/operacao.ts, src/lib/metas/catalogo.ts, src/repositories/metas.ts
- Notas: migration escrita à mão no estilo da 0014, RLS por tenant com SELECT/INSERT/UPDATE/DELETE; meta é upsert por (empresa, chave); `descreverMeta(valor, alvo)` também em `catalogo.ts`

## T-220 — API de metas (leitura e gravação) e regra de papel [pendente]

- Refs: AC-616, AC-617, AC-618, AC-620
- Arquivos: src/app/api/metas/route.ts, src/lib/auth/rotas.ts
- Notas: GET para qualquer sessão; PUT (corpo `{ metas: { chave: número|null } }`) para gerente+

## T-221 — Tela de metas e item no menu [pendente]

- Refs: AC-615, AC-616, AC-617, AC-618, AC-620, AC-626
- Arquivos: src/components/admin/metas.tsx, src/app/(app)/configuracoes/metas/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: atualizar a contagem de itens do menu no teste da casca

## T-222 — Selo de meta nos indicadores e atalhos "Configurar Metas" [pendente]

- Refs: AC-621, AC-622, AC-623, AC-624, AC-625, AC-626
- Arquivos: src/components/pipeline/pecas/cartao-indicador.tsx, src/lib/metas/usar-metas.ts, src/components/pipeline/indicadores-funil.tsx, src/components/agenda/agenda-tela.tsx, src/components/analises/relatorio-comercial.tsx, src/components/analises/indicadores-funil.tsx, src/components/campanhas/detalhe-campanha.tsx
- Notas: `CartaoIndicador` ganha prop opcional `meta`; hook `useMetas` busca `GET /api/metas`

## T-223 — Testes dos critérios de aceite [pendente]

- Refs: AC-615, AC-616, AC-617, AC-618, AC-619, AC-620, AC-621, AC-622, AC-623, AC-624, AC-625, AC-626
- Arquivos: test/api/metas.test.ts, test/auth/rotas-metas.test.ts, test/components/admin/metas.test.tsx, test/components/metas/selo.test.tsx
- Notas: o teste de rota segue `test/auth/rotas-admin.test.ts`
