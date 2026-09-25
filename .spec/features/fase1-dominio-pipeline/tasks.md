# Tasks: Fase 1 — Domínio do pipeline (transições)

> feature: fase1-dominio-pipeline

## T-034 — Tipos e carregamento do grafo (etapas, transições) [concluida]
- Refs: US-021, AC-048, AC-049
- Arquivos: src/domain/pipeline/tipos.ts, src/domain/pipeline/grafo.ts
- Notas: módulo puro (sem I/O) — recebe as listas de `pipeline_etapas` e
  `pipeline_transicoes` já carregadas (o repositório fica para a feature da
  rota HTTP). `encontrarTransicao(transicoes, origemId, destinoId)`.

## T-035 — Validação de papel do ator (com bypass de super admin) [concluida]
- Refs: US-022, AC-050, AC-051, AC-052
- Arquivos: src/domain/pipeline/papel.ts

## T-036 — Guards de dados obrigatórios da etapa de destino [concluida]
- Refs: US-023, AC-053, AC-054, AC-055, AC-056, AC-057, AC-058, AC-059, AC-060
- Arquivos: src/domain/pipeline/guards.ts
- Notas: recebe `agora: Date` como parâmetro (não `new Date()` interno) para
  o teste de "próxima ação no passado" ser determinístico.

## T-037 — Justificativa obrigatória na reabertura [concluida]
- Refs: US-024, AC-061, AC-062
- Arquivos: src/domain/pipeline/guards.ts

## T-038 — Orquestração `validarTransicao` com ordem determinística de erro [concluida]
- Refs: US-025, AC-063, AC-064
- Arquivos: src/domain/pipeline/validar-transicao.ts
- Notas: compõe T-034 a T-037 na ordem grafo → papel → guards de destino →
  justificativa, parando no primeiro erro. Depende de T-034, T-035, T-036,
  T-037 estarem concluídas.
