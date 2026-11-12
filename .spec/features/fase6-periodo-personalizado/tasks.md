# Tasks: Fase 6 — Período personalizado nas análises

> feature: fase6-periodo-personalizado

## T-330 — Tipo "período escolhido" e funções de intervalo [em-andamento]
- Refs: AC-801, AC-802
- Arquivos: src/components/analises/comum.ts
- Notas: `PeriodoEscolhido = { preset } | { de, ate }`; `periodoDe(escolha)`, `periodoAnteriorDe(escolha)` (mesmo tamanho, imediatamente antes), `validarIntervalo(de, ate)` devolvendo a mensagem de erro ou `null`; `periodoDoPreset` e `periodoAnterior` continuam iguais

## T-331 — Filtro com a opção Personalizado [em-andamento]
- Refs: AC-800, AC-802
- Arquivos: src/components/analises/filtro-periodo.tsx
- Notas: `valor` passa a ser o período escolhido; o botão "Personalizado" abre os campos De/Até (inputs `date`), com o botão Aplicar; mostra a mensagem de erro de `validarIntervalo`

## T-332 — Ligar as três telas ao período escolhido [em-andamento]
- Refs: AC-801, AC-803
- Arquivos: src/components/analises/relatorio-marketing.tsx, src/components/analises/relatorio-comercial.tsx, src/components/analises/indicadores-funil.tsx, src/components/analises/relatorio-executivo.tsx
- Notas: trocar `preset` por `periodo`; rótulos e nomes de CSV usam `rotuloDoPeriodo`

## T-333 — Testes dos critérios de aceite [em-andamento]
- Refs: AC-800, AC-801, AC-802, AC-803
- Arquivos: test/components/analises/periodo-personalizado.test.tsx, test/components/analises/pecas.test.tsx
- Notas: segue o padrão dos testes de `test/components/analises/`

## T-346 — Filtro de período no servidor (lista e arquivados) [em-andamento]
- Refs: AC-822, AC-823, AC-824, AC-825
- Arquivos: src/repositories/pipeline-lista.ts, src/app/api/oportunidades/lista/route.ts, src/app/api/oportunidades/arquivados/route.ts, src/app/api/oportunidades/lista/exportar/route.ts, src/app/api/oportunidades/arquivados/exportar/route.ts
- Notas: `de`, `ate`, `data` (`entrada` | `movimentacao`) em `FiltroLista`/`condicoesDaLista` e na consulta de arquivados; expressão SQL única da "última movimentação" (último `transicao_etapa`, senão `criado_em`); 400 `PERIODO_INVALIDO`; o parâmetro antigo dos arquivados continua aceito

## T-347 — Controle de período do pipeline (períodos prontos, Personalizado e escolha da data) [em-andamento]
- Refs: AC-820, AC-824
- Arquivos: src/components/pipeline/filtro-periodo-pipeline.tsx
- Notas: reaproveita `FiltroPeriodo` e `validarIntervalo` de T-330/T-331; acrescenta o seletor "Data" (Entrada do lead | Última movimentação); depende de T-330 e T-331

## T-348 — Período no funil (quadro) [em-andamento]
- Refs: AC-820, AC-821
- Arquivos: src/components/pipeline/filtros-funil.tsx, src/components/pipeline/board-kanban.tsx
- Notas: troca o `ItemEmBreve` "Período"; `buscarIdsPermitidos` passa `de`/`ate`/`data` às duas rotas; `filtroFunilAtivo` e o "Limpar" consideram o período

## T-349 — Período na lista e nos arquivados [em-andamento]
- Refs: AC-822, AC-823
- Arquivos: src/components/pipeline/filtros-lista.tsx, src/components/pipeline/filtros-arquivados.tsx, src/app/(app)/pipeline/lista/page.tsx, src/app/(app)/pipeline/arquivados/page.tsx
- Notas: remove o campo "a partir de" da tela de arquivados; a exportação usa os mesmos parâmetros

## T-350 — Testes do período no pipeline [em-andamento]
- Refs: AC-820, AC-821, AC-822, AC-823, AC-824, AC-825
- Arquivos: test/api/pipeline-periodo.test.ts, test/repositories/pipeline-lista-periodo.test.ts, test/components/pipeline/funil.test.tsx, test/components/pipeline/topo-lista-e-filtros-arquivados.test.tsx, test/components/pipeline/exportar-tela.test.tsx
- Notas: o de repositório segue o harness de Postgres efêmero; cobre o card migrado sem mudança de etapa (AC-825); os de tela estendem os testes existentes do funil, da lista e dos arquivados (o AC-393 e o AC-418 antigos foram atualizados)
