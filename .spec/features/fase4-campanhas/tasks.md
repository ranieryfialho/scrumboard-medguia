# Tasks: Fase4 campanhas

> feature: fase4-campanhas

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

## T-196 — API de campanhas: lista com contagens e indicadores, prévia de destinatários e várias etapas (servidor) [concluida]
- Refs: AC-533, AC-534, AC-540, AC-541, AC-544
- Arquivos: src/repositories/campanhas.ts, src/repositories/campanhas-resumo.ts, src/app/api/campanhas/route.ts, src/app/api/campanhas/previa-destinatarios/route.ts, src/app/api/campanhas/[id]/route.ts, test/api/campanhas-telas.test.ts
- Esforço: alto
- Notas: `GET /api/campanhas` ganha `criadoEm`, `contagens`, `resumo` e os filtros/paginação opcionais (sem parâmetros devolve tudo, como antes; os testes de fase2d AC-243 seguem sem edição). `GET /api/campanhas/previa-destinatarios?etapaIds=` (rota estática antes de `[id]`). Origem `{ tipo: 'etapas', etapaIds }` em `criarCampanha`/`validarOrigem`. O detalhe `GET /api/campanhas/[id]` ganha `criadoPorNome` (AC-547). Só MASTER/GERENTE/super admin (ASM-076).

## T-197 — Lista de campanhas (tela) [concluida]
- Refs: US-129, AC-532, AC-535, AC-536, AC-537, AC-538
- Arquivos: src/app/(app)/campanhas/page.tsx, src/components/campanhas/lista-campanhas.tsx, src/components/campanhas/comum.ts, test/components/campanhas/lista-campanhas.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/20*`. Reaproveita `CartaoIndicador`, `Paginacao`, `ItemEmBreve`. Depende de T-196.

## T-198 — Nova campanha e edição de rascunho (tela) [concluida]
- Refs: US-130, AC-539, AC-542, AC-543, AC-545, AC-546
- Arquivos: src/app/(app)/campanhas/nova/page.tsx, src/components/campanhas/nova-campanha.tsx, src/components/campanhas/previa-email.tsx, test/components/campanhas/nova-campanha.test.tsx
- Esforço: xalto
- Notas: fonte `21*`. Prévia em `iframe sandbox srcdoc` (ASM-186). Edição por `?rascunho=<id>` (PATCH). Depende de T-196.

## T-199 — Detalhe da campanha (tela) [concluida]
- Refs: US-131, AC-547, AC-548, AC-549, AC-550, AC-551, AC-552
- Arquivos: src/app/(app)/campanhas/[id]/page.tsx, src/components/campanhas/detalhe-campanha.tsx, test/components/campanhas/detalhe-campanha.test.tsx
- Esforço: xalto
- Notas: fonte `22*`. Play com confirmação (ASM-189). Depende de T-196.

## T-200 — Menu, navegação sem 404 e estados [concluida]
- Refs: US-132, AC-553, AC-554
- Arquivos: src/components/campanhas/estados.tsx, test/auth/rotas-campanhas.test.ts
- Esforço: medio
- Notas: teste no molde de `test/auth/rotas-whatsapp.test.ts`. Depende das demais.
