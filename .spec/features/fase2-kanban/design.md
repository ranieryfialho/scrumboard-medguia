# Design: Fase 2 — Kanban de 15 etapas

> feature: fase2-kanban

## Visão geral

```
UI (React, dnd-kit)          API (Next.js route handlers)         Domínio/dados (já prontos)
─────────────────────        ─────────────────────────────        ──────────────────────────
BoardKanban                  GET  /api/oportunidades       ──►    listarOportunidades (repo)
 └─ ColunaEtapa × 15          POST /api/oportunidades       ──►    criarOportunidade (repo, NOVO)
 └─ CardOportunidade          GET  /api/oportunidades/:id   ──►    buscarOportunidadePorId (repo)
 └─ ModalDadoFaltante         POST /api/oportunidades/:id/
                                   transicao                ──►    validarTransicao (domínio)
                                                             ──►    moverOportunidade (repo, NOVO,
                                                                     chama mover_oportunidade
                                                                     estendida)
```

Nada na camada de domínio (`src/domain/pipeline/*`) ou nos repositórios já
existentes (`buscarOportunidadePorId`, `listarOportunidades`) muda de
contrato. Duas peças novas de dados: a migration que estende
`mover_oportunidade` (ASM-019) e um repositório `criarOportunidade` (não
existe ainda — `oportunidades.ts` só tem busca/lista/atualização simples).

## Decisões

- **`mover_oportunidade` ganha parâmetros novos, migration própria.**
  `p_valor numeric DEFAULT NULL, p_motivo_perda_id uuid DEFAULT NULL,
  p_proxima_acao_em timestamptz DEFAULT NULL` — todos `DEFAULT NULL` para não
  quebrar quem já chama a função com a assinatura antiga. O `UPDATE` dentro
  da função passa a incluir esses campos só quando informados (`COALESCE`
  com o valor atual, para uma transição que não mexe em `valor` não apagar o
  que já estava lá). Fica numa migration nova
  (`drizzle/0006_fn_mover_oportunidade_guards.sql`), nunca editando a 0003
  (convenção do projeto: migration é histórico, não se reescreve).
- **A rota de transição é o único lugar que chama a função SQL estendida.**
  Fluxo dentro da rota: `resolverContextoTenant` → carrega etapa
  origem/destino e o grafo (`pipeline_etapas`, `pipeline_transicoes`) →
  `validarTransicao` (domínio puro, síncrono) → se `ok`, chama
  `moverOportunidade` (repo, um único `SELECT` na função SQL, dentro de
  `comTenant`) → se `!ok`, devolve `422` com o código de erro do domínio, sem
  tocar o banco de escrita.
- **`CONFLITO_DE_VERSAO` sobe como exceção do Postgres (`RAISE EXCEPTION`),
  não como retorno do domínio** — o domínio nem sabe qual é a `version`
  atual (só o banco sabe, sob lock). A rota captura essa exceção específica
  (por `ERRCODE`, já usado na 0003) e traduz pra `409`.
- **Board novo mora em `src/components/pipeline/`, não em
  `src/components/kanban/`.** A pasta `kanban/` é a UI antiga (Supabase, 9
  colunas fixas, `@/types/lead`) que continua servindo o sistema atual até o
  cutover único (decisão de 17/09/2026, ver memória do projeto). Criar o
  board novo ao lado, sem tocar no antigo, evita quebrar o que está em
  produção enquanto os dois convivem.
- **Estado do board no cliente: `fetch` direto + estado local (React
  `useState`/`useEffect`), sem lib nova.** Nem React Query nem SWR estão
  instaladas — não vale introduzir dependência nova só para esta feature.
  zustand (já uma dependência) fica só para o estado efêmero de UI do drag
  (card sendo arrastado, modal aberto), se necessário; o board revalida
  buscando de novo depois de cada transição bem-sucedida.
- **`GET /api/oportunidades` retorna o grafo embutido** (AC-094) como um
  mapa `{ [etapaId]: number[] }` calculado a partir de
  `pipeline_transicoes` filtrado pelo papel do ator da sessão (só destinos
  que aquele papel pode de fato executar — reaproveita a mesma lista que
  `papelPodeTransicionar` usa) — assim o frontend restringe o drop sem
  round-trip extra nem duplicar a regra de papel no cliente.

## Componentes da UI

| Componente | Responsabilidade |
|---|---|
| `BoardKanban` | Busca o board, mantém as 15 colunas, orquestra `DndContext` |
| `ColunaEtapa` | Uma das 15 colunas; sabe quais etapas de origem podem soltar nela (recebido do board) |
| `CardOportunidade` | Renderiza lead/responsável/valor; arrastável |
| `ModalDadoFaltante` | Um campo por código de erro (`VALOR_OBRIGATORIO` → input de valor, etc.); reenvia a transição ao confirmar (AC-088/089/090) |

## Fora deste design

Fila de atividades, reuniões, WhatsApp, anexos, relatórios — ver "Fora de
escopo" no spec.md.
