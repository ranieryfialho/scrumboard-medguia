#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase1-auth-rbac` em 2026-09-24 18:22
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase1-auth-rbac
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase1-auth-rbac-mufuzl8v'
FEATURE='fase1-auth-rbac'
BASE_BRANCH='spec/fase1-auth-rbac'
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
  git ls-files --error-unmatch -- '.spec/features/fase1-auth-rbac/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase1-auth-rbac-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase1-auth-rbac"
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
    amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-026 (ordem do tasks.md) ──
executar_seq_T_026() {
  info 'sequencial T-026 — Instala e configura o Better Auth sobre o schema existente'
  if rodar_tarefa seq 'T-026' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-026 — "Instala e configura o Better Auth sobre o schema existente"
  critérios/refs: US-014
  arquivos permitidos (e seus testes): package.json, src/lib/auth/server.ts, test/auth/config.test.ts
  mensagem de commit: "T-026 fase1-auth-rbac: Instala e configura o Better Auth sobre o schema existente"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-026 fase1-auth-rbac: Instala e configura o Better Auth sobre o schema existente (auto-commit do plano)'
    fi
    marcar_concluidas T-026
    verde "✔ T-026 concluída"
    return 0
  fi
  vermelho "✘ T-026 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-026"
  FALHAS="$FALHAS T-026"
  return 1
}

# ── sequencial T-027 (ordem do tasks.md) ──
executar_seq_T_027() {
  info 'sequencial T-027 — Login com e-mail/senha'
  if rodar_tarefa seq 'T-027' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-027 — "Login com e-mail/senha"
  critérios/refs: AC-033 (Login com credenciais corretas cria sessão), AC-034 (Login com credenciais incorretas é recusado), AC-035 (Login de usuário inativo é bloqueado)
  arquivos permitidos (e seus testes): src/lib/auth/login.ts, test/auth/login.test.ts
  mensagem de commit: "T-027 fase1-auth-rbac: Login com e-mail/senha"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-027 fase1-auth-rbac: Login com e-mail/senha (auto-commit do plano)'
    fi
    marcar_concluidas T-027
    verde "✔ T-027 concluída"
    return 0
  fi
  vermelho "✘ T-027 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-027"
  FALHAS="$FALHAS T-027"
  return 1
}

# ── sequencial T-028 (ordem do tasks.md) ──
executar_seq_T_028() {
  info 'sequencial T-028 — Convite de usuário por administrador da empresa'
  if rodar_tarefa seq 'T-028' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-028 — "Convite de usuário por administrador da empresa"
  critérios/refs: AC-036 (Convite válido cria vínculo pendente e token de uso único), AC-037 (Papel sem permissão de convidar é recusado), AC-038 (Super admin convida explicitamente para qualquer empresa)
  arquivos permitidos (e seus testes): src/lib/auth/convites.ts, test/auth/convites.test.ts
  mensagem de commit: "T-028 fase1-auth-rbac: Convite de usuário por administrador da empresa"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-028 fase1-auth-rbac: Convite de usuário por administrador da empresa (auto-commit do plano)'
    fi
    marcar_concluidas T-028
    verde "✔ T-028 concluída"
    return 0
  fi
  vermelho "✘ T-028 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-028"
  FALHAS="$FALHAS T-028"
  return 1
}

# ── sequencial T-029 (ordem do tasks.md) ──
executar_seq_T_029() {
  info 'sequencial T-029 — Definição de senha a partir do convite'
  if rodar_tarefa seq 'T-029' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-029 — "Definição de senha a partir do convite"
  critérios/refs: AC-039 (Token de convite válido define a senha e habilita o login), AC-040 (Token expirado ou já usado é recusado)
  arquivos permitidos (e seus testes): src/lib/auth/definir-senha.ts, test/auth/definir-senha.test.ts
  mensagem de commit: "T-029 fase1-auth-rbac: Definição de senha a partir do convite"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-029 fase1-auth-rbac: Definição de senha a partir do convite (auto-commit do plano)'
    fi
    marcar_concluidas T-029
    verde "✔ T-029 concluída"
    return 0
  fi
  vermelho "✘ T-029 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-029"
  FALHAS="$FALHAS T-029"
  return 1
}

# ── sequencial T-030 (ordem do tasks.md) ──
executar_seq_T_030() {
  info 'sequencial T-030 — Reset de senha'
  if rodar_tarefa seq 'T-030' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-030 — "Reset de senha"
  critérios/refs: AC-041 (Reset com token válido troca a senha e revoga sessões ativas), AC-042 (Solicitação de reset não revela se o e-mail existe)
  arquivos permitidos (e seus testes): src/lib/auth/reset-senha.ts, test/auth/reset-senha.test.ts
  mensagem de commit: "T-030 fase1-auth-rbac: Reset de senha"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-030 fase1-auth-rbac: Reset de senha (auto-commit do plano)'
    fi
    marcar_concluidas T-030
    verde "✔ T-030 concluída"
    return 0
  fi
  vermelho "✘ T-030 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-030"
  FALHAS="$FALHAS T-030"
  return 1
}

# ── sequencial T-031 (ordem do tasks.md) ──
executar_seq_T_031() {
  info 'sequencial T-031 — Resolução de sessão e tenant no servidor'
  if rodar_tarefa seq 'T-031' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-031 — "Resolução de sessão e tenant no servidor"
  critérios/refs: AC-043 (`empresa_id` da sessão prevalece sobre o do corpo da requisição), AC-044 (Requisição sem sessão válida é bloqueada)
  arquivos permitidos (e seus testes): src/lib/auth/tenant.ts, test/auth/tenant.test.ts
  mensagem de commit: "T-031 fase1-auth-rbac: Resolução de sessão e tenant no servidor"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-031 fase1-auth-rbac: Resolução de sessão e tenant no servidor (auto-commit do plano)'
    fi
    marcar_concluidas T-031
    verde "✔ T-031 concluída"
    return 0
  fi
  vermelho "✘ T-031 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-031"
  FALHAS="$FALHAS T-031"
  return 1
}

# ── sequencial T-032 (ordem do tasks.md) ──
executar_seq_T_032() {
  info 'sequencial T-032 — Troca de empresa pelo super admin'
  if rodar_tarefa seq 'T-032' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-032 — "Troca de empresa pelo super admin"
  critérios/refs: AC-045 (Super admin troca de empresa com evento de auditoria), AC-046 (Usuário comum não pode alternar de empresa)
  arquivos permitidos (e seus testes): src/lib/auth/troca-empresa.ts, test/auth/troca-empresa.test.ts
  mensagem de commit: "T-032 fase1-auth-rbac: Troca de empresa pelo super admin"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-032 fase1-auth-rbac: Troca de empresa pelo super admin (auto-commit do plano)'
    fi
    marcar_concluidas T-032
    verde "✔ T-032 concluída"
    return 0
  fi
  vermelho "✘ T-032 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-032"
  FALHAS="$FALHAS T-032"
  return 1
}

# ── sequencial T-033 (ordem do tasks.md) ──
executar_seq_T_033() {
  info 'sequencial T-033 — Rate limit de login, convite e reset'
  if rodar_tarefa seq 'T-033' 'Você executa UMA tarefa da feature "fase1-auth-rbac" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase1-auth-rbac/spec.md, .spec/features/fase1-auth-rbac/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-033 — "Rate limit de login, convite e reset"
  critérios/refs: AC-047 (Excesso de tentativas de login bloqueia temporariamente)
  arquivos permitidos (e seus testes): src/lib/auth/rate-limit.ts, test/auth/rate-limit.test.ts
  mensagem de commit: "T-033 fase1-auth-rbac: Rate limit de login, convite e reset"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-033 fase1-auth-rbac: Rate limit de login, convite e reset (auto-commit do plano)'
    fi
    marcar_concluidas T-033
    verde "✔ T-033 concluída"
    return 0
  fi
  vermelho "✘ T-033 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --seq T-033"
  FALHAS="$FALHAS T-033"
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
      amarelo "  para o veredito: bash .spec/features/fase1-auth-rbac/executar-tarefas.sh --gate"
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
  executar_seq_T_026 || true
  executar_seq_T_027 || true
  executar_seq_T_028 || true
  executar_seq_T_029 || true
  executar_seq_T_030 || true
  executar_seq_T_031 || true
  executar_seq_T_032 || true
  executar_seq_T_033 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-026 (sequencial)"
  echo "  seq       T-027 (sequencial)"
  echo "  seq       T-028 (sequencial)"
  echo "  seq       T-029 (sequencial)"
  echo "  seq       T-030 (sequencial)"
  echo "  seq       T-031 (sequencial)"
  echo "  seq       T-032 (sequencial)"
  echo "  seq       T-033 (sequencial)"
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
      T-026) evento --tipo inicio --escopo "seq:T-026"; iniciar_resumos; executar_seq_T_026 || true; encerrar "seq:T-026" ;;
      T-027) evento --tipo inicio --escopo "seq:T-027"; iniciar_resumos; executar_seq_T_027 || true; encerrar "seq:T-027" ;;
      T-028) evento --tipo inicio --escopo "seq:T-028"; iniciar_resumos; executar_seq_T_028 || true; encerrar "seq:T-028" ;;
      T-029) evento --tipo inicio --escopo "seq:T-029"; iniciar_resumos; executar_seq_T_029 || true; encerrar "seq:T-029" ;;
      T-030) evento --tipo inicio --escopo "seq:T-030"; iniciar_resumos; executar_seq_T_030 || true; encerrar "seq:T-030" ;;
      T-031) evento --tipo inicio --escopo "seq:T-031"; iniciar_resumos; executar_seq_T_031 || true; encerrar "seq:T-031" ;;
      T-032) evento --tipo inicio --escopo "seq:T-032"; iniciar_resumos; executar_seq_T_032 || true; encerrar "seq:T-032" ;;
      T-033) evento --tipo inicio --escopo "seq:T-033"; iniciar_resumos; executar_seq_T_033 || true; encerrar "seq:T-033" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
