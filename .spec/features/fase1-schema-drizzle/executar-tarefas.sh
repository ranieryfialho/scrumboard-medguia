#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase1-schema-drizzle` em 2026-09-23 17:58
# NÃO edite à mão: mudou tasks.md ou a config, regenere o plano.
#
# uso:
#   bash executar-tarefas.sh                  tudo (ondas → sequenciais → gate)
#   bash executar-tarefas.sh --faixa <id>     reexecuta UMA faixa (+ merge + gate)
#   bash executar-tarefas.sh --seq <T-xxx>    reexecuta UMA tarefa sequencial
#   bash executar-tarefas.sh --gate           só o gate (verify + audit)
#   bash executar-tarefas.sh --listar         mostra faixas, tarefas e estados
#   (acrescente --sem-gate para não rodar o gate ao final)
#
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase1-schema-drizzle
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase1-schema-drizzle-mueeq3ry'
FEATURE='fase1-schema-drizzle'
BASE_BRANCH='spec/fase1-schema-drizzle'
ENGINE='.claude/skills/onp-spec-driven/scripts/onp-spec.mjs'
CLAUDE_FLAGS=(--permission-mode acceptEdits --allowedTools 'Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(npx:*)')
STREAM_FLAGS=(--output-format stream-json --verbose)
FALHAS=""
COM_GATE=1
RESUMO_MODEL='claude-haiku-4-5'
RESUMO_PID=""

verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$*"; }
info()     { printf '· %s\n' "$*"; }
falhar()   { vermelho "✘ $*"; exit 1; }

# eventos vão para o ledger GLOBAL (~/.onp-spec/painel/ledger.jsonl):
# um arquivo para todos os projetos, é o que o onp-spec resumo lê
evento() { node "$ENGINE" evento --run "$RUN_ID" "$@" >/dev/null 2>&1 || true; }

# ── ambiente (todos os modos passam por aqui) ────────────────────────
preparar_ambiente() {
  command -v git >/dev/null 2>&1 || falhar "git não encontrado"
  command -v node >/dev/null 2>&1 || falhar "node não encontrado"
  command -v claude >/dev/null 2>&1 || falhar "Claude Code CLI (claude) não encontrado — instale-o ou siga o modo manual em plano-execucao.md"
  TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || falhar "fora de um repositório git"
  cd "$TOPLEVEL" || exit 1
  # artefatos recém-gerados pelo `onp-spec plano` são sujeira esperada:
  # se forem a ÚNICA sujeira, o script mesmo commita; qualquer outra, aborta
  if [ -n "$(git status --porcelain)" ]; then
    if [ -z "$(git status --porcelain | grep -v -e 'plano-execucao\.' -e 'plano\.json' -e 'executar-tarefas\.sh')" ]; then
      git add -A
      git commit -q -m "plano de execução: $FEATURE (artefatos gerados)"
      info "artefatos do plano commitados"
    else
      falhar "árvore suja além dos artefatos do plano — commite ou faça git stash antes (os worktrees partem do último commit)"
    fi
  fi
  git ls-files --error-unmatch -- '.spec/features/fase1-schema-drizzle/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
  ATUAL=$(git rev-parse --abbrev-ref HEAD)
  [ "$ATUAL" != "HEAD" ] || falhar "HEAD destacado — troque para uma branch"
  if [ "$ATUAL" != "$BASE_BRANCH" ]; then
    if git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then
      git checkout -q "$BASE_BRANCH" || falhar "não consegui trocar para $BASE_BRANCH"
    else
      git checkout -q -b "$BASE_BRANCH" || falhar "não consegui criar $BASE_BRANCH"
    fi
    info "branch de trabalho: $BASE_BRANCH (a partir de $ATUAL)"
  fi
  git worktree prune
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase1-schema-drizzle-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase1-schema-drizzle"
  STREAMS_DIR="${ONP_SPEC_HOME:-$HOME/.onp-spec}/painel/streams/$RUN_ID"
  mkdir -p "$LOG_DIR" "$STREAMS_DIR"
}

# worktree limpo mesmo depois de uma tentativa que falhou
preparar_worktree() { # $1=faixa $2=branch $3=worktree
  git worktree prune
  if [ -e "$3" ]; then git worktree remove --force "$3" >/dev/null 2>&1; rm -rf "$3"; fi
  if git show-ref --verify --quiet "refs/heads/$2"; then git branch -D "$2" >/dev/null 2>&1; fi
  git worktree add "$3" -b "$2" >/dev/null 2>&1 || { vermelho "✘ não consegui criar o worktree de $1 em $3"; return 1; }
}

tentativa() { # $1=faixa — conta reexecuções (vai para o ledger)
  local arq="$LOG_DIR/.tentativa-$1"
  local n=1
  [ -f "$arq" ] && n=$(( $(cat "$arq") + 1 ))
  printf "%s" "$n" > "$arq"
  printf "%s" "$n"
}

# uma tarefa = uma sessão claude headless com contexto limpo.
# o JSONL da sessão vira o stream da tarefa no ledger
rodar_tarefa() { # $1=escopo(faixa|seq) $2=T-xxx $3=prompt $4=modelo $5=esforço
  local chave="$1--$2"
  local stream="$STREAMS_DIR/$chave.jsonl"
  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado executando --stream "$chave"
  info "$2 — claude -p ($4 · $5) · stream: $chave"
  if claude -p "$3" --model "$4" --effort "$5" "${STREAM_FLAGS[@]}" "${CLAUDE_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then
    evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado concluida --stream "$chave"
    node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true
    return 0
  fi
  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado falhou --stream "$chave"
  node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true
  return 1
}

mesclar_faixa() { # $1=faixa $2=branch $3=worktree $4=exit-da-faixa
  if [ "$4" -ne 0 ]; then
    evento --tipo faixa --faixa "$1" --estado falhou
    vermelho "✘ $1 falhou (log: $LOG_DIR/$1.log) — worktree mantido para inspeção: $3"
    amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --faixa $1"
    FALHAS="$FALHAS $1"; return 1
  fi
  evento --tipo faixa --faixa "$1" --estado mesclando
  if git merge --no-ff "$2" -m "merge $1 ($FEATURE)"; then
    git worktree remove --force "$3" >/dev/null 2>&1
    git branch -d "$2" >/dev/null 2>&1
    evento --tipo faixa --faixa "$1" --estado mesclada
    verde "✔ $1 mesclada em $BASE_BRANCH"
  else
    git merge --abort >/dev/null 2>&1
    evento --tipo faixa --faixa "$1" --estado conflito
    vermelho "✘ conflito ao mesclar $1 — resolva na mão: git merge $2 (worktree mantido: $3)"
    FALHAS="$FALHAS $1"; return 1
  fi
}

marcar_concluidas() { # $@=T-xxx
  for t in "$@"; do node "$ENGINE" tarefa "$FEATURE" "$t" concluida >/dev/null || true; done
}

# ── resumo geral de andamento: 1/min enquanto a execução roda ─────────
# escrito por IA (claude -p, sem ferramentas) com fallback do motor; vai
# para o terminal e para o ledger — o agente repassa o texto no chat.
gerar_resumo() {
  local ctx ia
  ctx=$(node "$ENGINE" resumo "$FEATURE" --contexto 2>/dev/null) || ctx=""
  [ -n "$ctx" ] || return 0
  ia=$(claude -p "Você narra, para o dono do produto, uma execução de tarefas de código em andamento. Estado mecânico:

$ctx

Escreva o RESUMO GERAL DE ANDAMENTO: um parágrafo único de 2 a 4 frases, em português simples, dizendo o que está acontecendo agora, o que já terminou, o que falhou e se o usuário precisa agir. Sem markdown, sem listas." --model "$RESUMO_MODEL" 2>/dev/null)
  if [ -n "$ia" ]; then
    node "$ENGINE" resumo "$FEATURE" --gravar --origem ia --texto "$ia" >/dev/null 2>&1 || true
    printf '\n📣 resumo (IA): %s\n' "$ia"
  else
    node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true
    printf '\n📣 resumo: %s\n' "$(node "$ENGINE" resumo "$FEATURE" 2>/dev/null)"
  fi
}

# mata o loop E o sleep filho — senão o sleep herda o stdout e quem chamou
# o script via pipe fica esperando EOF por até 60s depois do exit
parar_resumos() {
  [ -n "$RESUMO_PID" ] || return 0
  command -v pkill >/dev/null 2>&1 && pkill -P "$RESUMO_PID" 2>/dev/null
  kill "$RESUMO_PID" 2>/dev/null
  RESUMO_PID=""
}

iniciar_resumos() {
  ( while :; do sleep 60; gerar_resumo; done ) &
  RESUMO_PID=$!
  # ao sair: para o loop e grava um último resumo (o estado final, do motor)
  trap 'parar_resumos; node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true' EXIT
}

# ── sequencial T-010 (ordem do tasks.md) ──
executar_seq_T_010() {
  info 'sequencial T-010 — Instalar e configurar Drizzle ORM + drizzle-kit'
  if rodar_tarefa seq 'T-010' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-010 — "Instalar e configurar Drizzle ORM + drizzle-kit"
  critérios/refs: US-007
  arquivos permitidos (e seus testes): package.json, package-lock.json, drizzle.config.ts, src/db/client.ts
  mensagem de commit: "T-010 fase1-schema-drizzle: Instalar e configurar Drizzle ORM + drizzle-kit"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-010 fase1-schema-drizzle: Instalar e configurar Drizzle ORM + drizzle-kit (auto-commit do plano)'
    fi
    marcar_concluidas T-010
    verde "✔ T-010 concluída"
    return 0
  fi
  vermelho "✘ T-010 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-010"
  FALHAS="$FALHAS T-010"
  return 1
}

# ── sequencial T-011 (ordem do tasks.md) ──
executar_seq_T_011() {
  info 'sequencial T-011 — Modelar tabelas de identidade/tenant e Better Auth'
  if rodar_tarefa seq 'T-011' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-011 — "Modelar tabelas de identidade/tenant e Better Auth"
  critérios/refs: AC-015 (Migrations aplicam o schema completo num Postgres limpo), AC-016 (As tabelas do Better Auth existem no schema), AC-018 (Colunas de tenant são `NOT NULL`)
  arquivos permitidos (e seus testes): src/db/schema/identidade.ts, src/db/schema/auth.ts, src/db/schema/index.ts
  mensagem de commit: "T-011 fase1-schema-drizzle: Modelar tabelas de identidade/tenant e Better Auth"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-011 fase1-schema-drizzle: Modelar tabelas de identidade/tenant e Better Auth (auto-commit do plano)'
    fi
    marcar_concluidas T-011
    verde "✔ T-011 concluída"
    return 0
  fi
  vermelho "✘ T-011 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-011"
  FALHAS="$FALHAS T-011"
  return 1
}

# ── sequencial T-012 (ordem do tasks.md) ──
executar_seq_T_012() {
  info 'sequencial T-012 — Modelar tabelas do pipeline'
  if rodar_tarefa seq 'T-012' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-012 — "Modelar tabelas do pipeline"
  critérios/refs: AC-015 (Migrations aplicam o schema completo num Postgres limpo), AC-018 (Colunas de tenant são `NOT NULL`)
  arquivos permitidos (e seus testes): src/db/schema/pipeline.ts
  mensagem de commit: "T-012 fase1-schema-drizzle: Modelar tabelas do pipeline"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-012 fase1-schema-drizzle: Modelar tabelas do pipeline (auto-commit do plano)'
    fi
    marcar_concluidas T-012
    verde "✔ T-012 concluída"
    return 0
  fi
  vermelho "✘ T-012 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-012"
  FALHAS="$FALHAS T-012"
  return 1
}

# ── sequencial T-013 (ordem do tasks.md) ──
executar_seq_T_013() {
  info 'sequencial T-013 — Modelar tabelas de operação e as reescritas do modelo legado'
  if rodar_tarefa seq 'T-013' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-013 — "Modelar tabelas de operação e as reescritas do modelo legado"
  critérios/refs: AC-015 (Migrations aplicam o schema completo num Postgres limpo), AC-018 (Colunas de tenant são `NOT NULL`)
  arquivos permitidos (e seus testes): src/db/schema/operacao.ts, src/db/schema/legado.ts
  mensagem de commit: "T-013 fase1-schema-drizzle: Modelar tabelas de operação e as reescritas do modelo legado"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-013 fase1-schema-drizzle: Modelar tabelas de operação e as reescritas do modelo legado (auto-commit do plano)'
    fi
    marcar_concluidas T-013
    verde "✔ T-013 concluída"
    return 0
  fi
  vermelho "✘ T-013 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-013"
  FALHAS="$FALHAS T-013"
  return 1
}

# ── sequencial T-014 (ordem do tasks.md) ──
executar_seq_T_014() {
  info 'sequencial T-014 — Gerar e versionar a migration inicial do schema'
  if rodar_tarefa seq 'T-014' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-014 — "Gerar e versionar a migration inicial do schema"
  critérios/refs: AC-015 (Migrations aplicam o schema completo num Postgres limpo), AC-017 (Migrations reaplicadas não falham nem duplicam nada)
  arquivos permitidos (e seus testes): drizzle/0000_schema_inicial.sql, drizzle/meta/_journal.json, drizzle/meta/0000_snapshot.json
  mensagem de commit: "T-014 fase1-schema-drizzle: Gerar e versionar a migration inicial do schema"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-014 fase1-schema-drizzle: Gerar e versionar a migration inicial do schema (auto-commit do plano)'
    fi
    marcar_concluidas T-014
    verde "✔ T-014 concluída"
    return 0
  fi
  vermelho "✘ T-014 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-014"
  FALHAS="$FALHAS T-014"
  return 1
}

# ── sequencial T-015 (ordem do tasks.md) ──
executar_seq_T_015() {
  info 'sequencial T-015 — Migration de RLS (ativar + policy por tenant em toda tabela de negócio)'
  if rodar_tarefa seq 'T-015' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-015 — "Migration de RLS (ativar + policy por tenant em toda tabela de negócio)"
  critérios/refs: AC-019 (RLS ativo em toda tabela com `empresa_id`), AC-020 (Sem `app.empresa_id` definido, a role de runtime não lê nem escreve linha nenhuma)
  arquivos permitidos (e seus testes): drizzle/0001_rls.sql
  mensagem de commit: "T-015 fase1-schema-drizzle: Migration de RLS (ativar + policy por tenant em toda tabela de negócio)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-015 fase1-schema-drizzle: Migration de RLS (ativar + policy por tenant em toda tabela de negócio) (auto-commit do plano)'
    fi
    marcar_concluidas T-015
    verde "✔ T-015 concluída"
    return 0
  fi
  vermelho "✘ T-015 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-015"
  FALHAS="$FALHAS T-015"
  return 1
}

# ── sequencial T-016 (ordem do tasks.md) ──
executar_seq_T_016() {
  info 'sequencial T-016 — Migration das invariantes do pipeline (constraints + privilégios)'
  if rodar_tarefa seq 'T-016' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-016 — "Migration das invariantes do pipeline (constraints + privilégios)"
  critérios/refs: AC-021 (Card não entra em `Proposta` sem `valor > 0`), AC-022 (Card não entra em `Perdido` sem motivo), AC-023 (Card não entra em etapas de acompanhamento sem próxima ação), AC-024 (Sequência de cadência é única e limitada por oportunidade), AC-025 (Log de eventos é imutável para a aplicação), AC-032 (`crm_app` não executa DDL)
  arquivos permitidos (e seus testes): drizzle/0002_constraints.sql
  mensagem de commit: "T-016 fase1-schema-drizzle: Migration das invariantes do pipeline (constraints + privilégios)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-016 fase1-schema-drizzle: Migration das invariantes do pipeline (constraints + privilégios) (auto-commit do plano)'
    fi
    marcar_concluidas T-016
    verde "✔ T-016 concluída"
    return 0
  fi
  vermelho "✘ T-016 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-016"
  FALHAS="$FALHAS T-016"
  return 1
}

# ── sequencial T-017 (ordem do tasks.md) ──
executar_seq_T_017() {
  info 'sequencial T-017 — Função SQL `mover_oportunidade` (transição + evento + lock otimista)'
  if rodar_tarefa seq 'T-017' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-017 — "Função SQL `mover_oportunidade` (transição + evento + lock otimista)"
  critérios/refs: AC-026 (`mover_oportunidade` grava estado e evento juntos, ou nenhum dos dois), AC-027 (Escrita com versão desatualizada é rejeitada (lock otimista))
  arquivos permitidos (e seus testes): drizzle/0003_fn_mover_oportunidade.sql
  mensagem de commit: "T-017 fase1-schema-drizzle: Função SQL `mover_oportunidade` (transição + evento + lock otimista)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-017 fase1-schema-drizzle: Função SQL `mover_oportunidade` (transição + evento + lock otimista) (auto-commit do plano)'
    fi
    marcar_concluidas T-017
    verde "✔ T-017 concluída"
    return 0
  fi
  vermelho "✘ T-017 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-017"
  FALHAS="$FALHAS T-017"
  return 1
}

# ── sequencial T-018 (ordem do tasks.md) ──
executar_seq_T_018() {
  info 'sequencial T-018 — Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia)'
  if rodar_tarefa seq 'T-018' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-018 — "Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia)"
  critérios/refs: AC-028 (`concluir_atividade` grava o resultado do toque e o efeito em cadeia, atomicamente)
  arquivos permitidos (e seus testes): drizzle/0004_fn_concluir_atividade.sql
  mensagem de commit: "T-018 fase1-schema-drizzle: Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-018 fase1-schema-drizzle: Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia) (auto-commit do plano)'
    fi
    marcar_concluidas T-018
    verde "✔ T-018 concluída"
    return 0
  fi
  vermelho "✘ T-018 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-018"
  FALHAS="$FALHAS T-018"
  return 1
}

# ── sequencial T-019 (ordem do tasks.md) ──
executar_seq_T_019() {
  info 'sequencial T-019 — Seeds idempotentes (etapas, grafo de transições, motivos de perda)'
  if rodar_tarefa seq 'T-019' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-019 — "Seeds idempotentes (etapas, grafo de transições, motivos de perda)"
  critérios/refs: AC-029 (As 15 etapas existem após a migration, na ordem certa), AC-030 (O grafo de transições permitido existe e bloqueia o resto por omissão), AC-031 (Seeds de `motivos_perda` cobrem os motivos já exigidos pelo mapeamento de migração)
  arquivos permitidos (e seus testes): drizzle/0005_seeds.sql
  mensagem de commit: "T-019 fase1-schema-drizzle: Seeds idempotentes (etapas, grafo de transições, motivos de perda)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-019 fase1-schema-drizzle: Seeds idempotentes (etapas, grafo de transições, motivos de perda) (auto-commit do plano)'
    fi
    marcar_concluidas T-019
    verde "✔ T-019 concluída"
    return 0
  fi
  vermelho "✘ T-019 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-019"
  FALHAS="$FALHAS T-019"
  return 1
}

# ── sequencial T-020 (ordem do tasks.md) ──
executar_seq_T_020() {
  info 'sequencial T-020 — Harness de teste com Postgres efêmero (CI)'
  if rodar_tarefa seq 'T-020' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-020 — "Harness de teste com Postgres efêmero (CI)"
  critérios/refs: US-007
  arquivos permitidos (e seus testes): test/support/postgres-efemero.ts
  mensagem de commit: "T-020 fase1-schema-drizzle: Harness de teste com Postgres efêmero (CI)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-020 fase1-schema-drizzle: Harness de teste com Postgres efêmero (CI) (auto-commit do plano)'
    fi
    marcar_concluidas T-020
    verde "✔ T-020 concluída"
    return 0
  fi
  vermelho "✘ T-020 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-020"
  FALHAS="$FALHAS T-020"
  return 1
}

# ── sequencial T-021 (ordem do tasks.md) ──
executar_seq_T_021() {
  info 'sequencial T-021 — Testes de schema e tenant obrigatório'
  if rodar_tarefa seq 'T-021' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-021 — "Testes de schema e tenant obrigatório"
  critérios/refs: AC-015 (Migrations aplicam o schema completo num Postgres limpo), AC-016 (As tabelas do Better Auth existem no schema), AC-017 (Migrations reaplicadas não falham nem duplicam nada), AC-018 (Colunas de tenant são `NOT NULL`)
  arquivos permitidos (e seus testes): test/db/schema.test.ts
  mensagem de commit: "T-021 fase1-schema-drizzle: Testes de schema e tenant obrigatório"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-021 fase1-schema-drizzle: Testes de schema e tenant obrigatório (auto-commit do plano)'
    fi
    marcar_concluidas T-021
    verde "✔ T-021 concluída"
    return 0
  fi
  vermelho "✘ T-021 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-021"
  FALHAS="$FALHAS T-021"
  return 1
}

# ── sequencial T-022 (ordem do tasks.md) ──
executar_seq_T_022() {
  info 'sequencial T-022 — Testes de RLS (isolamento por tenant)'
  if rodar_tarefa seq 'T-022' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-022 — "Testes de RLS (isolamento por tenant)"
  critérios/refs: AC-019 (RLS ativo em toda tabela com `empresa_id`), AC-020 (Sem `app.empresa_id` definido, a role de runtime não lê nem escreve linha nenhuma)
  arquivos permitidos (e seus testes): test/db/rls.test.ts
  mensagem de commit: "T-022 fase1-schema-drizzle: Testes de RLS (isolamento por tenant)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-022 fase1-schema-drizzle: Testes de RLS (isolamento por tenant) (auto-commit do plano)'
    fi
    marcar_concluidas T-022
    verde "✔ T-022 concluída"
    return 0
  fi
  vermelho "✘ T-022 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-022"
  FALHAS="$FALHAS T-022"
  return 1
}

# ── sequencial T-023 (ordem do tasks.md) ──
executar_seq_T_023() {
  info 'sequencial T-023 — Testes das invariantes (constraints) e dos privilégios de DDL'
  if rodar_tarefa seq 'T-023' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-023 — "Testes das invariantes (constraints) e dos privilégios de DDL"
  critérios/refs: AC-021 (Card não entra em `Proposta` sem `valor > 0`), AC-022 (Card não entra em `Perdido` sem motivo), AC-023 (Card não entra em etapas de acompanhamento sem próxima ação), AC-024 (Sequência de cadência é única e limitada por oportunidade), AC-025 (Log de eventos é imutável para a aplicação), AC-032 (`crm_app` não executa DDL)
  arquivos permitidos (e seus testes): test/db/constraints.test.ts
  mensagem de commit: "T-023 fase1-schema-drizzle: Testes das invariantes (constraints) e dos privilégios de DDL"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-023 fase1-schema-drizzle: Testes das invariantes (constraints) e dos privilégios de DDL (auto-commit do plano)'
    fi
    marcar_concluidas T-023
    verde "✔ T-023 concluída"
    return 0
  fi
  vermelho "✘ T-023 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-023"
  FALHAS="$FALHAS T-023"
  return 1
}

# ── sequencial T-024 (ordem do tasks.md) ──
executar_seq_T_024() {
  info 'sequencial T-024 — Testes das funções SQL transacionais'
  if rodar_tarefa seq 'T-024' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-024 — "Testes das funções SQL transacionais"
  critérios/refs: AC-026 (`mover_oportunidade` grava estado e evento juntos, ou nenhum dos dois), AC-027 (Escrita com versão desatualizada é rejeitada (lock otimista)), AC-028 (`concluir_atividade` grava o resultado do toque e o efeito em cadeia, atomicamente)
  arquivos permitidos (e seus testes): test/db/funcoes.test.ts
  mensagem de commit: "T-024 fase1-schema-drizzle: Testes das funções SQL transacionais"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-024 fase1-schema-drizzle: Testes das funções SQL transacionais (auto-commit do plano)'
    fi
    marcar_concluidas T-024
    verde "✔ T-024 concluída"
    return 0
  fi
  vermelho "✘ T-024 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-024"
  FALHAS="$FALHAS T-024"
  return 1
}

# ── sequencial T-025 (ordem do tasks.md) ──
executar_seq_T_025() {
  info 'sequencial T-025 — Testes dos seeds'
  if rodar_tarefa seq 'T-025' 'Você executa UMA tarefa da feature "fase1-schema-drizzle" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-schema-drizzle/spec.md, .spec/features/fase1-schema-drizzle/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-025 — "Testes dos seeds"
  critérios/refs: AC-029 (As 15 etapas existem após a migration, na ordem certa), AC-030 (O grafo de transições permitido existe e bloqueia o resto por omissão), AC-031 (Seeds de `motivos_perda` cobrem os motivos já exigidos pelo mapeamento de migração)
  arquivos permitidos (e seus testes): test/db/seeds.test.ts
  mensagem de commit: "T-025 fase1-schema-drizzle: Testes dos seeds"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-025 fase1-schema-drizzle: Testes dos seeds (auto-commit do plano)'
    fi
    marcar_concluidas T-025
    verde "✔ T-025 concluída"
    return 0
  fi
  vermelho "✘ T-025 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --seq T-025"
  FALHAS="$FALHAS T-025"
  return 1
}

# ── gate: quem decide é a máquina ────────────────────────────────────
rodar_gate() {
  echo
  info "gate: verify + audit --ci"
  evento --tipo gate --etapa inicio
  node "$ENGINE" verify "$FEATURE"
  local v=$?
  evento --tipo gate --etapa verify --exit "$v"
  node "$ENGINE" audit --ci
  AUDIT=$?
  evento --tipo gate --etapa audit --exit "$AUDIT"
  # fecha a contabilidade: status das tarefas + prova do verify no git
  if [ -n "$(git status --porcelain -- '.spec')" ]; then
    git add -A -- '.spec'
    git commit -q -m "$FEATURE: status das tarefas + prova do verify (plano)"
    info "status das tarefas e prova do verify commitados"
  fi
  return "$AUDIT"
}

encerrar() { # $1=escopo
  echo
  if [ -n "$FALHAS" ]; then vermelho "faixas/tarefas com falha:$FALHAS"; fi
  # sem gate não existe veredito: NUNCA anunciar alinhamento sem o audit
  if [ "$COM_GATE" -eq 0 ]; then
    evento --tipo fim --exit 1 --escopo "$1"
    if [ -z "$FALHAS" ]; then
      amarelo "○ trabalho de '$1' terminou SEM o gate (--sem-gate) — isto NÃO é prova de nada"
      amarelo "  para o veredito: bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh --gate"
      exit 0
    fi
    vermelho "e ainda há falhas — conserte e rode o gate"
    exit 1
  fi
  rodar_gate
  local audit=$?
  if [ "$audit" -eq 0 ] && [ -z "$FALHAS" ]; then
    evento --tipo fim --exit 0 --escopo "$1"
    verde "✔ plano concluído — especificação e código alinhados (audit exit 0) na branch $BASE_BRANCH"
    info "próximo passo: revise e leve para a main quando quiser (git merge $BASE_BRANCH)"
    exit 0
  fi
  evento --tipo fim --exit 1 --escopo "$1"
  vermelho "plano terminou com pendências — leia a saída do audit acima e os logs em $LOG_DIR"
  amarelo "dica: reexecute só o que falhou (--faixa <id> / --seq <T-xxx>)"
  exit 1
}

executar_tudo() {
  evento --tipo inicio --escopo tudo
  iniciar_resumos
  info "logs em: $LOG_DIR"
  info "resumo geral de andamento: a cada 1 min aqui no terminal (e via: onp-spec resumo)"
  executar_seq_T_010 || true
  executar_seq_T_011 || true
  executar_seq_T_012 || true
  executar_seq_T_013 || true
  executar_seq_T_014 || true
  executar_seq_T_015 || true
  executar_seq_T_016 || true
  executar_seq_T_017 || true
  executar_seq_T_018 || true
  executar_seq_T_019 || true
  executar_seq_T_020 || true
  executar_seq_T_021 || true
  executar_seq_T_022 || true
  executar_seq_T_023 || true
  executar_seq_T_024 || true
  executar_seq_T_025 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-010 (sequencial)"
  echo "  seq       T-011 (sequencial)"
  echo "  seq       T-012 (sequencial)"
  echo "  seq       T-013 (sequencial)"
  echo "  seq       T-014 (sequencial)"
  echo "  seq       T-015 (sequencial)"
  echo "  seq       T-016 (sequencial)"
  echo "  seq       T-017 (sequencial)"
  echo "  seq       T-018 (sequencial)"
  echo "  seq       T-019 (sequencial)"
  echo "  seq       T-020 (sequencial)"
  echo "  seq       T-021 (sequencial)"
  echo "  seq       T-022 (sequencial)"
  echo "  seq       T-023 (sequencial)"
  echo "  seq       T-024 (sequencial)"
  echo "  seq       T-025 (sequencial)"
  echo
  echo "reexecutar uma faixa:    --faixa <id>"
  echo "reexecutar sequencial:   --seq <T-xxx>"
  echo "só o gate:               --gate"
}

MODO="tudo"
ALVO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --listar) MODO="listar" ;;
    --gate) MODO="gate" ;;
    --sem-gate) COM_GATE=0 ;;
    --faixa) MODO="faixa"; ALVO="${2:-}"; shift ;;
    --seq) MODO="seq"; ALVO="${2:-}"; shift ;;
    -h|--help) sed -n "2,14p" "$0"; exit 0 ;;
    *) vermelho "argumento desconhecido: $1"; sed -n "2,14p" "$0"; exit 2 ;;
  esac
  shift
done

if [ "$MODO" = "listar" ]; then listar; exit 0; fi

preparar_ambiente

case "$MODO" in
  tudo) executar_tudo ;;
  gate) COM_GATE=1; iniciar_resumos; encerrar gate ;;
  faixa)
    case "$ALVO" in
      *) falhar "faixa desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
  seq)
    case "$ALVO" in
      T-010) evento --tipo inicio --escopo "seq:T-010"; iniciar_resumos; executar_seq_T_010 || true; encerrar "seq:T-010" ;;
      T-011) evento --tipo inicio --escopo "seq:T-011"; iniciar_resumos; executar_seq_T_011 || true; encerrar "seq:T-011" ;;
      T-012) evento --tipo inicio --escopo "seq:T-012"; iniciar_resumos; executar_seq_T_012 || true; encerrar "seq:T-012" ;;
      T-013) evento --tipo inicio --escopo "seq:T-013"; iniciar_resumos; executar_seq_T_013 || true; encerrar "seq:T-013" ;;
      T-014) evento --tipo inicio --escopo "seq:T-014"; iniciar_resumos; executar_seq_T_014 || true; encerrar "seq:T-014" ;;
      T-015) evento --tipo inicio --escopo "seq:T-015"; iniciar_resumos; executar_seq_T_015 || true; encerrar "seq:T-015" ;;
      T-016) evento --tipo inicio --escopo "seq:T-016"; iniciar_resumos; executar_seq_T_016 || true; encerrar "seq:T-016" ;;
      T-017) evento --tipo inicio --escopo "seq:T-017"; iniciar_resumos; executar_seq_T_017 || true; encerrar "seq:T-017" ;;
      T-018) evento --tipo inicio --escopo "seq:T-018"; iniciar_resumos; executar_seq_T_018 || true; encerrar "seq:T-018" ;;
      T-019) evento --tipo inicio --escopo "seq:T-019"; iniciar_resumos; executar_seq_T_019 || true; encerrar "seq:T-019" ;;
      T-020) evento --tipo inicio --escopo "seq:T-020"; iniciar_resumos; executar_seq_T_020 || true; encerrar "seq:T-020" ;;
      T-021) evento --tipo inicio --escopo "seq:T-021"; iniciar_resumos; executar_seq_T_021 || true; encerrar "seq:T-021" ;;
      T-022) evento --tipo inicio --escopo "seq:T-022"; iniciar_resumos; executar_seq_T_022 || true; encerrar "seq:T-022" ;;
      T-023) evento --tipo inicio --escopo "seq:T-023"; iniciar_resumos; executar_seq_T_023 || true; encerrar "seq:T-023" ;;
      T-024) evento --tipo inicio --escopo "seq:T-024"; iniciar_resumos; executar_seq_T_024 || true; encerrar "seq:T-024" ;;
      T-025) evento --tipo inicio --escopo "seq:T-025"; iniciar_resumos; executar_seq_T_025 || true; encerrar "seq:T-025" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
