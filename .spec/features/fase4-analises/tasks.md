# Tasks: Fase4 analises

> feature: fase4-analises

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - Toda tarefa referencia em `Refs:` pelo menos uma história de usuário
    (US-xxx) ou critério de aceite (AC-xxx).
  - Toda tarefa lista os arquivos que cria/altera em `Arquivos:` — capriche:
    é o que decide o que `onp-spec plano` roda em PARALELO (arquivos
    disjuntos) e o que roda em sequência.
  - Campos opcionais por tarefa, usados pelo plano de execução:
    `- Modelo: claude-sonnet-5` e `- Esforço: alto` (baixo|medio|alto|xalto|max).
  - Uma tarefa só pode virar [concluida] quando os critérios de aceite dela
    tiverem prova PASS registrada por `onp-spec verify`.
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)
-->

## T-201 — API do funil e do desempenho por responsável (servidor) [concluida]
- Refs: AC-557
- Arquivos: src/repositories/kpis.ts, src/repositories/analises-funil.ts, src/app/api/relatorios/funil/route.ts, test/api/relatorios-funil.test.ts
- Esforço: alto
- Notas: `GET /api/relatorios/funil?de&ate&responsavelId` na mesma coorte de `obterKpis` (cards criados no período, ASM-191). Reaproveita a regra de "chegou à etapa" (ASM-190); se der para extrair a consulta compartilhada de `kpis.ts` sem mudar o resultado dos 7 indicadores, extrai (os testes AC-221..230 seguem sem edição). Mesmas validações de data e papel da rota `/kpis` (GERENTE+, `/api/relatorios` já exige GERENTE em `rotas.ts`).

## T-202 — API do relatório de marketing (servidor) [concluida]
- Refs: AC-563
- Arquivos: src/repositories/analises-marketing.ts, src/app/api/relatorios/marketing/route.ts, test/api/relatorios-marketing.test.ts
- Esforço: alto
- Notas: `GET /api/relatorios/marketing?de&ate&origem&agrupar`. Leads criados no período (ASM-191), origem em `leads.origem` (ASM-196), série por dia/semana/mês sem buracos (ASM-197). Período máximo de 366 dias (ASM-192).

## T-203 — API do relatório comercial (servidor) [concluida]
- Refs: AC-569
- Arquivos: src/repositories/analises-comercial.ts, src/app/api/relatorios/comercial/route.ts, test/api/relatorios-comercial.test.ts
- Esforço: alto
- Notas: `GET /api/relatorios/comercial?de&ate&responsavelId`. Eventos no período (ASM-191), valor atual do card (ASM-193), pipeline de hoje (ASM-194), win rate e ciclo (ASM-195), motivos de perda de `motivos_perda`.

## T-204 — Peças compartilhadas: filtro de período e gráfico de linhas [concluida]
- Refs: AC-556, AC-564, AC-565, AC-571
- Arquivos: src/components/analises/comum.ts, src/components/analises/filtro-periodo.tsx, src/components/analises/grafico-linhas.tsx, src/components/analises/estados.tsx, test/components/analises/pecas.test.tsx
- Esforço: alto
- Notas: `comum.ts` calcula `de`/`ate` dos períodos prontos (ASM-192), formata porcentagem/moeda/data. `GraficoLinhas`: SVG próprio com eixo, legenda, valores e `<table>` equivalente para leitor de tela (ASM-198); sem dados mostra "Sem dados no período".

## T-205 — Tela de indicadores (/indicadores) [concluida]
- Refs: US-133, AC-555, AC-556, AC-558, AC-559, AC-560, AC-561
- Arquivos: src/app/(app)/indicadores/page.tsx, src/components/analises/indicadores-funil.tsx, test/components/analises/indicadores-funil.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/23*`. Usa `/api/relatorios/kpis` e `/api/relatorios/funil`. Depende de T-201 e T-204.

## T-206 — Tela do relatório de marketing (/relatorios) [concluida]
- Refs: US-134, AC-562, AC-564, AC-565, AC-566, AC-567
- Arquivos: src/app/(app)/relatorios/page.tsx, src/components/analises/relatorio-marketing.tsx, test/components/analises/relatorio-marketing.test.tsx
- Esforço: xalto
- Notas: fonte `24*`. Depende de T-202 e T-204.

## T-207 — Tela do relatório comercial (/relatorios-comerciais) [concluida]
- Refs: US-135, AC-568, AC-570, AC-571, AC-572, AC-573, AC-574
- Arquivos: src/app/(app)/relatorios-comerciais/page.tsx, src/components/analises/relatorio-comercial.tsx, test/components/analises/relatorio-comercial.test.tsx
- Esforço: xalto
- Notas: fonte `25*`. Depende de T-203 e T-204.

## T-208 — Navegação sem tela antiga e estados [concluida]
- Refs: US-136, AC-575, AC-576
- Arquivos: test/auth/rotas-analises.test.ts
- Esforço: medio
- Notas: remove as três páginas antigas (`git rm`; as duas de relatórios liam a planilha). O teste confere os três itens do menu por papel, as páginas novas, a ausência das antigas, `podeAcessarRota` falso para ATENDENTE (inclusive `/api/relatorios/funil`) e a casca marcando o item certo. Depende das demais.
