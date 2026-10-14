#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase2b-cadencia` em 2026-10-14 17:20
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase2b-cadencia
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase2b-cadencia-mv8dkxhp'
FEATURE='fase2b-cadencia'
BASE_BRANCH='spec/fase2b-cadencia'
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
  git ls-files --error-unmatch -- '.spec/features/fase2b-cadencia/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2b-cadencia-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2b-cadencia"
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
    amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-088 (ordem do tasks.md) ──
executar_seq_T_088() {
  info 'sequencial T-088 — Domínio puro: matriz, turnos e feriados'
  if rodar_tarefa seq 'T-088' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-088 — "Domínio puro: matriz, turnos e feriados"
  critérios/refs: AC-187 (Matriz canônica de 18 toques), AC-188 (Turno vigente por horário de São Paulo), AC-189 (Fim de semana e feriado nacional pausam)
  arquivos permitidos (e seus testes): src/domain/cadencia/matriz.ts, src/domain/cadencia/turno.ts, src/domain/cadencia/feriados.ts, test/domain/cadencia.test.ts
  mensagem de commit: "T-088 fase2b-cadencia: Domínio puro: matriz, turnos e feriados"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-088 fase2b-cadencia: Domínio puro: matriz, turnos e feriados (auto-commit do plano)'
    fi
    marcar_concluidas T-088
    verde "✔ T-088 concluída"
    return 0
  fi
  vermelho "✘ T-088 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-088"
  FALHAS="$FALHAS T-088"
  return 1
}

# ── sequencial T-089 (ordem do tasks.md) ──
executar_seq_T_089() {
  info 'sequencial T-089 — Migration 0011: funções SQL da cadência'
  if rodar_tarefa seq 'T-089' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-089 — "Migration 0011: funções SQL da cadência"
  critérios/refs: AC-190 (Iniciar gera só o primeiro bloco), AC-193 (Concluir com `sem_resposta` registra o fato), AC-194 (Terceiro `sem_resposta` do bloco libera o seguinte), AC-195 (`conectou` interrompe a cadência na hora), AC-196 (Toque fora de ordem ou fora do turno é recusado), AC-197 (Toque já concluído, cancelado ou de cadência encerrada não conclui de novo), AC-199 (Virada de dia avança só quem concluiu o dia inteiro), AC-200 (Fim de semana e feriado não viram o dia), AC-201 (Esgotar os 18 toques manda para Perdido), AC-203 (Cada empresa só vê e vira os próprios cards)
  arquivos permitidos (e seus testes): drizzle/0011_cadencia_funcoes.sql, test/db/cadencia-funcoes.test.ts
  mensagem de commit: "T-089 fase2b-cadencia: Migration 0011: funções SQL da cadência"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-089 fase2b-cadencia: Migration 0011: funções SQL da cadência (auto-commit do plano)'
    fi
    marcar_concluidas T-089
    verde "✔ T-089 concluída"
    return 0
  fi
  vermelho "✘ T-089 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-089"
  FALHAS="$FALHAS T-089"
  return 1
}

# ── sequencial T-090 (ordem do tasks.md) ──
executar_seq_T_090() {
  info 'sequencial T-090 — Repositório de cadência'
  if rodar_tarefa seq 'T-090' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-090 — "Repositório de cadência"
  critérios/refs: AC-190 (Iniciar gera só o primeiro bloco), AC-192 (Fila "Minhas tarefas" lista só o turno liberado), AC-193 (Concluir com `sem_resposta` registra o fato), AC-195 (`conectou` interrompe a cadência na hora), AC-203 (Cada empresa só vê e vira os próprios cards)
  arquivos permitidos (e seus testes): src/repositories/cadencia.ts, test/repositories/cadencia.test.ts
  mensagem de commit: "T-090 fase2b-cadencia: Repositório de cadência"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-090 fase2b-cadencia: Repositório de cadência (auto-commit do plano)'
    fi
    marcar_concluidas T-090
    verde "✔ T-090 concluída"
    return 0
  fi
  vermelho "✘ T-090 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-090"
  FALHAS="$FALHAS T-090"
  return 1
}

# ── sequencial T-091 (ordem do tasks.md) ──
executar_seq_T_091() {
  info 'sequencial T-091 — Rota POST /api/oportunidades/:id/cadencia/iniciar'
  if rodar_tarefa seq 'T-091' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-091 — "Rota POST /api/oportunidades/:id/cadencia/iniciar"
  critérios/refs: AC-190 (Iniciar gera só o primeiro bloco), AC-191 (Iniciar respeita versão, tenant e sessão)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/[id]/cadencia/iniciar/route.ts, test/api/cadencia-iniciar.test.ts
  mensagem de commit: "T-091 fase2b-cadencia: Rota POST /api/oportunidades/:id/cadencia/iniciar"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-091 fase2b-cadencia: Rota POST /api/oportunidades/:id/cadencia/iniciar (auto-commit do plano)'
    fi
    marcar_concluidas T-091
    verde "✔ T-091 concluída"
    return 0
  fi
  vermelho "✘ T-091 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-091"
  FALHAS="$FALHAS T-091"
  return 1
}

# ── sequencial T-092 (ordem do tasks.md) ──
executar_seq_T_092() {
  info 'sequencial T-092 — Rotas GET /api/atividades e POST /api/atividades/:id/concluir'
  if rodar_tarefa seq 'T-092' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-092 — "Rotas GET /api/atividades e POST /api/atividades/:id/concluir"
  critérios/refs: AC-192 (Fila "Minhas tarefas" lista só o turno liberado), AC-193 (Concluir com `sem_resposta` registra o fato), AC-194 (Terceiro `sem_resposta` do bloco libera o seguinte), AC-195 (`conectou` interrompe a cadência na hora), AC-196 (Toque fora de ordem ou fora do turno é recusado), AC-197 (Toque já concluído, cancelado ou de cadência encerrada não conclui de novo), AC-198 (Concluir exige sessão, tenant e versão)
  arquivos permitidos (e seus testes): src/app/api/atividades/route.ts, src/app/api/atividades/[id]/concluir/route.ts, test/api/atividades.test.ts, test/api/atividades-concluir.test.ts
  mensagem de commit: "T-092 fase2b-cadencia: Rotas GET /api/atividades e POST /api/atividades/:id/concluir"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-092 fase2b-cadencia: Rotas GET /api/atividades e POST /api/atividades/:id/concluir (auto-commit do plano)'
    fi
    marcar_concluidas T-092
    verde "✔ T-092 concluída"
    return 0
  fi
  vermelho "✘ T-092 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-092"
  FALHAS="$FALHAS T-092"
  return 1
}

# ── sequencial T-093 (ordem do tasks.md) ──
executar_seq_T_093() {
  info 'sequencial T-093 — Job diário: rota interna de virada de dia'
  if rodar_tarefa seq 'T-093' 'Você executa UMA tarefa da feature "fase2b-cadencia" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2b-cadencia/spec.md, .spec/features/fase2b-cadencia/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-093 — "Job diário: rota interna de virada de dia"
  critérios/refs: AC-199 (Virada de dia avança só quem concluiu o dia inteiro), AC-200 (Fim de semana e feriado não viram o dia), AC-201 (Esgotar os 18 toques manda para Perdido), AC-202 (Job é idempotente, protegido por segredo e auditável), AC-203 (Cada empresa só vê e vira os próprios cards)
  arquivos permitidos (e seus testes): src/app/api/cron/cadencia/route.ts, src/lib/env.ts, test/api/cron-cadencia.test.ts
  mensagem de commit: "T-093 fase2b-cadencia: Job diário: rota interna de virada de dia"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-093 fase2b-cadencia: Job diário: rota interna de virada de dia (auto-commit do plano)'
    fi
    marcar_concluidas T-093
    verde "✔ T-093 concluída"
    return 0
  fi
  vermelho "✘ T-093 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --seq T-093"
  FALHAS="$FALHAS T-093"
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
      amarelo "  para o veredito: bash .spec/features/fase2b-cadencia/executar-tarefas.sh --gate"
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
  executar_seq_T_088 || true
  executar_seq_T_089 || true
  executar_seq_T_090 || true
  executar_seq_T_091 || true
  executar_seq_T_092 || true
  executar_seq_T_093 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-088 (sequencial)"
  echo "  seq       T-089 (sequencial)"
  echo "  seq       T-090 (sequencial)"
  echo "  seq       T-091 (sequencial)"
  echo "  seq       T-092 (sequencial)"
  echo "  seq       T-093 (sequencial)"
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
      T-088) evento --tipo inicio --escopo "seq:T-088"; iniciar_resumos; executar_seq_T_088 || true; encerrar "seq:T-088" ;;
      T-089) evento --tipo inicio --escopo "seq:T-089"; iniciar_resumos; executar_seq_T_089 || true; encerrar "seq:T-089" ;;
      T-090) evento --tipo inicio --escopo "seq:T-090"; iniciar_resumos; executar_seq_T_090 || true; encerrar "seq:T-090" ;;
      T-091) evento --tipo inicio --escopo "seq:T-091"; iniciar_resumos; executar_seq_T_091 || true; encerrar "seq:T-091" ;;
      T-092) evento --tipo inicio --escopo "seq:T-092"; iniciar_resumos; executar_seq_T_092 || true; encerrar "seq:T-092" ;;
      T-093) evento --tipo inicio --escopo "seq:T-093"; iniciar_resumos; executar_seq_T_093 || true; encerrar "seq:T-093" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
