#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase0-fundacao-ci-staging` em 2026-09-23 13:23
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase0-fundacao-ci-staging
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase0-fundacao-ci-staging-mue4w9ly'
FEATURE='fase0-fundacao-ci-staging'
BASE_BRANCH='spec/fase0-fundacao-ci-staging'
ENGINE='.claude/skills/onp-spec-driven/scripts/onp-spec.mjs'
CLAUDE_FLAGS=(--permission-mode acceptEdits --allowedTools 'Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(node:*)')
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
  git ls-files --error-unmatch -- '.spec/features/fase0-fundacao-ci-staging/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase0-fundacao-ci-staging-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase0-fundacao-ci-staging"
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
    amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-001 (ordem do tasks.md) ──
executar_seq_T_001() {
  info 'sequencial T-001 — Migrar runner de testes para Vitest'
  if rodar_tarefa seq 'T-001' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-001 — "Migrar runner de testes para Vitest"
  critérios/refs: US-001
  arquivos permitidos (e seus testes): package.json, vitest.config.ts, onpspec.config.json
  mensagem de commit: "T-001 fase0-fundacao-ci-staging: Migrar runner de testes para Vitest"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-001 fase0-fundacao-ci-staging: Migrar runner de testes para Vitest (auto-commit do plano)'
    fi
    marcar_concluidas T-001
    verde "✔ T-001 concluída"
    return 0
  fi
  vermelho "✘ T-001 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-001"
  FALHAS="$FALHAS T-001"
  return 1
}

# ── sequencial T-002 (ordem do tasks.md) ──
executar_seq_T_002() {
  info 'sequencial T-002 — CI com gates (lint → typecheck → test → build)'
  if rodar_tarefa seq 'T-002' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-002 — "CI com gates (lint → typecheck → test → build)"
  critérios/refs: AC-001 (Workflow de CI cobre os quatro gates na ordem certa), AC-002 (CI roda em todo Pull Request e em todo push)
  arquivos permitidos (e seus testes): .github/workflows/ci.yml, package.json
  mensagem de commit: "T-002 fase0-fundacao-ci-staging: CI com gates (lint → typecheck → test → build)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-002 fase0-fundacao-ci-staging: CI com gates (lint → typecheck → test → build) (auto-commit do plano)'
    fi
    marcar_concluidas T-002
    verde "✔ T-002 concluída"
    return 0
  fi
  vermelho "✘ T-002 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-002"
  FALHAS="$FALHAS T-002"
  return 1
}

# ── sequencial T-003 (ordem do tasks.md) ──
executar_seq_T_003() {
  info 'sequencial T-003 — Workflow de release: build e publish no GHCR por tag SHA'
  if rodar_tarefa seq 'T-003' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-003 — "Workflow de release: build e publish no GHCR por tag SHA"
  critérios/refs: AC-003 (Build sai da VPS e a imagem é publicada com tag rastreável)
  arquivos permitidos (e seus testes): .github/workflows/release.yml
  mensagem de commit: "T-003 fase0-fundacao-ci-staging: Workflow de release: build e publish no GHCR por tag SHA"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-003 fase0-fundacao-ci-staging: Workflow de release: build e publish no GHCR por tag SHA (auto-commit do plano)'
    fi
    marcar_concluidas T-003
    verde "✔ T-003 concluída"
    return 0
  fi
  vermelho "✘ T-003 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-003"
  FALHAS="$FALHAS T-003"
  return 1
}

# ── sequencial T-004 (ordem do tasks.md) ──
executar_seq_T_004() {
  info 'sequencial T-004 — Deploy por pull de imagem + rollback por tag'
  if rodar_tarefa seq 'T-004' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-004 — "Deploy por pull de imagem + rollback por tag"
  critérios/refs: AC-004 (Rollback é trocar a tag, sem rebuild)
  arquivos permitidos (e seus testes): .github/workflows/deploy.yml, docker-compose.yml
  mensagem de commit: "T-004 fase0-fundacao-ci-staging: Deploy por pull de imagem + rollback por tag"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-004 fase0-fundacao-ci-staging: Deploy por pull de imagem + rollback por tag (auto-commit do plano)'
    fi
    marcar_concluidas T-004
    verde "✔ T-004 concluída"
    return 0
  fi
  vermelho "✘ T-004 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-004"
  FALHAS="$FALHAS T-004"
  return 1
}

# ── sequencial T-005 (ordem do tasks.md) ──
executar_seq_T_005() {
  info 'sequencial T-005 — Databases crm_prod/crm_staging e roles crm_app/crm_migrator'
  if rodar_tarefa seq 'T-005' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-005 — "Databases crm_prod/crm_staging e roles crm_app/crm_migrator"
  critérios/refs: AC-005 (Staging usa um database Postgres separado de produção), AC-007 (`crm_app` não tem privilégio de superusuário nem DDL), AC-008 (`crm_migrator` é a única role com DDL, usada só pelo job de migration), AC-009 (Postgres não publica porta na internet)
  arquivos permitidos (e seus testes): infra/postgres/init/01-databases-and-roles.sql, docker-compose.yml
  mensagem de commit: "T-005 fase0-fundacao-ci-staging: Databases crm_prod/crm_staging e roles crm_app/crm_migrator"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-005 fase0-fundacao-ci-staging: Databases crm_prod/crm_staging e roles crm_app/crm_migrator (auto-commit do plano)'
    fi
    marcar_concluidas T-005
    verde "✔ T-005 concluída"
    return 0
  fi
  vermelho "✘ T-005 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-005"
  FALHAS="$FALHAS T-005"
  return 1
}

# ── sequencial T-006 (ordem do tasks.md) ──
executar_seq_T_006() {
  info 'sequencial T-006 — Topologia de staging atrás do proxy, sem porta nova exposta'
  if rodar_tarefa seq 'T-006' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-006 — "Topologia de staging atrás do proxy, sem porta nova exposta"
  critérios/refs: AC-006 (Staging é publicamente acessível só por quem tem o link/credencial da equipe)
  arquivos permitidos (e seus testes): docker-compose.yml, docker-compose.staging.yml
  mensagem de commit: "T-006 fase0-fundacao-ci-staging: Topologia de staging atrás do proxy, sem porta nova exposta"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-006 fase0-fundacao-ci-staging: Topologia de staging atrás do proxy, sem porta nova exposta (auto-commit do plano)'
    fi
    marcar_concluidas T-006
    verde "✔ T-006 concluída"
    return 0
  fi
  vermelho "✘ T-006 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-006"
  FALHAS="$FALHAS T-006"
  return 1
}

# ── sequencial T-007 (ordem do tasks.md) ──
executar_seq_T_007() {
  info 'sequencial T-007 — Backup diário (pg_dump + checksum + rclone) com alerta'
  if rodar_tarefa seq 'T-007' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-007 — "Backup diário (pg_dump + checksum + rclone) com alerta"
  critérios/refs: AC-010 (Backup diário roda e é enviado para fora da VPS), AC-011 (Alerta dispara se o backup falhar ou atrasar)
  arquivos permitidos (e seus testes): infra/backup/backup-crm.sh, infra/backup/crontab
  mensagem de commit: "T-007 fase0-fundacao-ci-staging: Backup diário (pg_dump + checksum + rclone) com alerta"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-007 fase0-fundacao-ci-staging: Backup diário (pg_dump + checksum + rclone) com alerta (auto-commit do plano)'
    fi
    marcar_concluidas T-007
    verde "✔ T-007 concluída"
    return 0
  fi
  vermelho "✘ T-007 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-007"
  FALHAS="$FALHAS T-007"
  return 1
}

# ── sequencial T-008 (ordem do tasks.md) ──
executar_seq_T_008() {
  info 'sequencial T-008 — Restore ensaiado, documentado e com script de verificação'
  if rodar_tarefa seq 'T-008' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-008 — "Restore ensaiado, documentado e com script de verificação"
  critérios/refs: AC-012 (Restore ensaiado recupera um dump em staging)
  arquivos permitidos (e seus testes): infra/backup/restore-crm.sh, docs/runbooks/restore-backup-crm.md
  mensagem de commit: "T-008 fase0-fundacao-ci-staging: Restore ensaiado, documentado e com script de verificação"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-008 fase0-fundacao-ci-staging: Restore ensaiado, documentado e com script de verificação (auto-commit do plano)'
    fi
    marcar_concluidas T-008
    verde "✔ T-008 concluída"
    return 0
  fi
  vermelho "✘ T-008 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-008"
  FALHAS="$FALHAS T-008"
  return 1
}

# ── sequencial T-009 (ordem do tasks.md) ──
executar_seq_T_009() {
  info 'sequencial T-009 — Endpoint `/api/health`'
  if rodar_tarefa seq 'T-009' 'Você executa UMA tarefa da feature "fase0-fundacao-ci-staging" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase0-fundacao-ci-staging/spec.md, .spec/features/fase0-fundacao-ci-staging/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-009 — "Endpoint `/api/health`"
  critérios/refs: AC-013 (`/api/health` reporta app, banco e idade do último backup), AC-014 (`/api/health` reporta falha quando o banco está inacessível)
  arquivos permitidos (e seus testes): src/app/api/health/route.ts, src/lib/env.ts
  mensagem de commit: "T-009 fase0-fundacao-ci-staging: Endpoint `/api/health`"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `node --test` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-009 fase0-fundacao-ci-staging: Endpoint `/api/health` (auto-commit do plano)'
    fi
    marcar_concluidas T-009
    verde "✔ T-009 concluída"
    return 0
  fi
  vermelho "✘ T-009 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --seq T-009"
  FALHAS="$FALHAS T-009"
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
      amarelo "  para o veredito: bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh --gate"
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
  executar_seq_T_001 || true
  executar_seq_T_002 || true
  executar_seq_T_003 || true
  executar_seq_T_004 || true
  executar_seq_T_005 || true
  executar_seq_T_006 || true
  executar_seq_T_007 || true
  executar_seq_T_008 || true
  executar_seq_T_009 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-001 (sequencial)"
  echo "  seq       T-002 (sequencial)"
  echo "  seq       T-003 (sequencial)"
  echo "  seq       T-004 (sequencial)"
  echo "  seq       T-005 (sequencial)"
  echo "  seq       T-006 (sequencial)"
  echo "  seq       T-007 (sequencial)"
  echo "  seq       T-008 (sequencial)"
  echo "  seq       T-009 (sequencial)"
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
      T-001) evento --tipo inicio --escopo "seq:T-001"; iniciar_resumos; executar_seq_T_001 || true; encerrar "seq:T-001" ;;
      T-002) evento --tipo inicio --escopo "seq:T-002"; iniciar_resumos; executar_seq_T_002 || true; encerrar "seq:T-002" ;;
      T-003) evento --tipo inicio --escopo "seq:T-003"; iniciar_resumos; executar_seq_T_003 || true; encerrar "seq:T-003" ;;
      T-004) evento --tipo inicio --escopo "seq:T-004"; iniciar_resumos; executar_seq_T_004 || true; encerrar "seq:T-004" ;;
      T-005) evento --tipo inicio --escopo "seq:T-005"; iniciar_resumos; executar_seq_T_005 || true; encerrar "seq:T-005" ;;
      T-006) evento --tipo inicio --escopo "seq:T-006"; iniciar_resumos; executar_seq_T_006 || true; encerrar "seq:T-006" ;;
      T-007) evento --tipo inicio --escopo "seq:T-007"; iniciar_resumos; executar_seq_T_007 || true; encerrar "seq:T-007" ;;
      T-008) evento --tipo inicio --escopo "seq:T-008"; iniciar_resumos; executar_seq_T_008 || true; encerrar "seq:T-008" ;;
      T-009) evento --tipo inicio --escopo "seq:T-009"; iniciar_resumos; executar_seq_T_009 || true; encerrar "seq:T-009" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
