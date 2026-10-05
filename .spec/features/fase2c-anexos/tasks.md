# Tasks: Fase 2c — Anexos

> feature: fase2c-anexos

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

## T-052 — Validação de conteúdo e armazenamento em volume [concluida]
- Refs: AC-096, AC-097, AC-098
- Arquivos: src/lib/anexos/conteudo.ts, src/lib/anexos/armazenamento.ts, test/anexos/conteudo.test.ts
- Esforço: medio
- Notas: `detectarTipo(bytes)` por magic bytes (PNG/JPEG/WebP/PDF) e `validarTamanho(tipo, n)` (imagem 5 MB, PDF 10 MB); `gravarAnexo` gera nome uuid dentro de `ANEXOS_DIR` (ASM-025) e nunca usa o nome original.

## T-053 — Assinatura HMAC de URL com expiração de 60 s [concluida]
- Refs: AC-101, AC-103, AC-104
- Arquivos: src/lib/anexos/assinatura.ts, test/anexos/assinatura.test.ts
- Esforço: medio
- Notas: `assinarUrl(id, agora)` e `verificarAssinatura(id, exp, sig, agora)` com comparação em tempo constante (ASM-024).

## T-054 — Repositório de anexos (isolado por tenant) [concluida]
- Refs: AC-095, AC-099, AC-102, AC-106
- Arquivos: src/repositories/anexos.ts, test/repositories/anexos.test.ts
- Esforço: medio
- Notas: via `comTenant`; `criarAnexo`, `buscarAnexoPorId`, `anexoValidoParaOportunidade(contexto, anexoId, oportunidadeId)`.

## T-055 — Rota POST /api/anexos [concluida]
- Refs: US-034, AC-095, AC-096, AC-097, AC-098, AC-099, AC-100
- Arquivos: src/app/api/anexos/route.ts, test/api/anexos-upload.test.ts, test/support/api-anexos.ts
- Esforço: alto
- Notas: depende de T-052 e T-054. Ordem: 401, 404 do card, tipo (415), tamanho (413), grava arquivo, registra.

## T-056 — Rotas GET /api/anexos/[id] e GET /api/anexos/arquivo/[id] [concluida]
- Refs: US-035, AC-100, AC-101, AC-102, AC-103, AC-104
- Arquivos: src/app/api/anexos/[id]/route.ts, src/app/api/anexos/arquivo/[id]/route.ts, test/api/anexos-acesso.test.ts
- Esforço: alto
- Notas: depende de T-052, T-053 e T-054. A rota de arquivo não exige sessão, só assinatura válida (AC-103).

## T-057 — Transição valida o anexo como evidência do próprio card [concluida]
- Refs: US-036, AC-105, AC-106
- Arquivos: src/app/api/oportunidades/[id]/transicao/route.ts, test/api/oportunidades-transicao-anexo.test.ts
- Esforço: medio
- Notas: depende de T-054. Anexo inexistente, de outro tenant ou de outra oportunidade vira `anexoId = null` antes de `validarTransicao` (resulta em EVIDENCIA_OBRIGATORIA, 422).

## T-058 — Modal: escolher ou colar o print [concluida]
- Refs: AC-107
- Arquivos: src/components/pipeline/modal-dado-faltante.tsx, test/components/pipeline/modal-anexo.test.tsx
- Esforço: alto
- Notas: usa POST /api/anexos (T-055); Ctrl+V de imagem no modal; mostra nome do arquivo e o erro do envio.

## T-059 — Volume `anexos` no docker-compose [concluida]
- Refs: US-034
- Arquivos: docker-compose.yml, Dockerfile
- Esforço: baixo
- Notas: ASM-025: volume nomeado `anexos` em `/data/anexos` e `ANEXOS_DIR` no ambiente. `ANEXOS_SEGREDO` (ASM-024) é segredo: precisa ser cadastrado no `.env` da VPS antes do deploy; nada é aplicado na VPS nesta feature.
