#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase2-kanban` em 2026-09-25 18:23
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase2-kanban
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase2-kanban-muhahtmu'
FEATURE='fase2-kanban'
BASE_BRANCH='spec/fase2-kanban'
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
  git ls-files --error-unmatch -- '.spec/features/fase2-kanban/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2-kanban-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2-kanban"
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
    amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-043 (ordem do tasks.md) ──
executar_seq_T_043() {
  info 'sequencial T-043 — Migration: `mover_oportunidade` grava valor/motivo/próxima ação'
  if rodar_tarefa seq 'T-043' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-043 — "Migration: `mover_oportunidade` grava valor/motivo/próxima ação"
  critérios/refs: AC-082 (Transição permitida grava etapa, dados de guard e evento atomicamente)
  arquivos permitidos (e seus testes): drizzle/0006_fn_mover_oportunidade_guards.sql, test/db/funcoes.test.ts
  mensagem de commit: "T-043 fase2-kanban: Migration: `mover_oportunidade` grava valor/motivo/próxima ação"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-043 fase2-kanban: Migration: `mover_oportunidade` grava valor/motivo/próxima ação (auto-commit do plano)'
    fi
    marcar_concluidas T-043
    verde "✔ T-043 concluída"
    return 0
  fi
  vermelho "✘ T-043 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-043"
  FALHAS="$FALHAS T-043"
  return 1
}

# ── sequencial T-044 (ordem do tasks.md) ──
executar_seq_T_044() {
  info 'sequencial T-044 — Repositório: `criarOportunidade`'
  if rodar_tarefa seq 'T-044' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-044 — "Repositório: `criarOportunidade`"
  critérios/refs: AC-079 (Card novo nasce em "Entrada de leads", version 1), AC-080 (Card novo pertence ao tenant da sessão, nunca ao do corpo), AC-081 (Lead inexistente ou de outro tenant é rejeitado)
  arquivos permitidos (e seus testes): src/repositories/oportunidades.ts, test/repositories/oportunidades.test.ts
  mensagem de commit: "T-044 fase2-kanban: Repositório: `criarOportunidade`"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-044 fase2-kanban: Repositório: `criarOportunidade` (auto-commit do plano)'
    fi
    marcar_concluidas T-044
    verde "✔ T-044 concluída"
    return 0
  fi
  vermelho "✘ T-044 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-044"
  FALHAS="$FALHAS T-044"
  return 1
}

# ── sequencial T-045 (ordem do tasks.md) ──
executar_seq_T_045() {
  info 'sequencial T-045 — Repositório: `moverOportunidade` (chama a função SQL estendida)'
  if rodar_tarefa seq 'T-045' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-045 — "Repositório: `moverOportunidade` (chama a função SQL estendida)"
  critérios/refs: AC-082 (Transição permitida grava etapa, dados de guard e evento atomicamente), AC-086 (Conflito de versão é rejeitado sem sobrescrever)
  arquivos permitidos (e seus testes): src/repositories/oportunidades.ts, test/repositories/oportunidades.test.ts
  mensagem de commit: "T-045 fase2-kanban: Repositório: `moverOportunidade` (chama a função SQL estendida)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-045 fase2-kanban: Repositório: `moverOportunidade` (chama a função SQL estendida) (auto-commit do plano)'
    fi
    marcar_concluidas T-045
    verde "✔ T-045 concluída"
    return 0
  fi
  vermelho "✘ T-045 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-045"
  FALHAS="$FALHAS T-045"
  return 1
}

# ── sequencial T-046 (ordem do tasks.md) ──
executar_seq_T_046() {
  info 'sequencial T-046 — Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar)'
  if rodar_tarefa seq 'T-046' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-046 — "Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar)"
  critérios/refs: AC-074 (Board só mostra cards do tenant da sessão), AC-075 (Cada card do board traz os dados básicos pra exibição), AC-076 (Filtro por etapa restringe o resultado a essa etapa), AC-077 (Filtro por responsável restringe o resultado a esse responsável), AC-078 (Sem sessão válida, o board é recusado antes de tocar no banco), AC-079 (Card novo nasce em "Entrada de leads", version 1), AC-080 (Card novo pertence ao tenant da sessão, nunca ao do corpo), AC-081 (Lead inexistente ou de outro tenant é rejeitado), AC-094 (Board expõe as etapas de destino alcançáveis a partir de cada etapa)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/route.ts, test/api/oportunidades.test.ts
  mensagem de commit: "T-046 fase2-kanban: Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-046 fase2-kanban: Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar) (auto-commit do plano)'
    fi
    marcar_concluidas T-046
    verde "✔ T-046 concluída"
    return 0
  fi
  vermelho "✘ T-046 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-046"
  FALHAS="$FALHAS T-046"
  return 1
}

# ── sequencial T-047 (ordem do tasks.md) ──
executar_seq_T_047() {
  info 'sequencial T-047 — Rota `POST /api/oportunidades/:id/transicao`'
  if rodar_tarefa seq 'T-047' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-047 — "Rota `POST /api/oportunidades/:id/transicao`"
  critérios/refs: AC-082 (Transição permitida grava etapa, dados de guard e evento atomicamente), AC-083 (Transição fora do grafo não move o card), AC-084 (Transição com papel sem permissão não move o card), AC-085 (Transição com dado obrigatório faltante não move o card), AC-086 (Conflito de versão é rejeitado sem sobrescrever), AC-087 (Card de outro tenant não é encontrado (fail closed))
  arquivos permitidos (e seus testes): src/app/api/oportunidades/[id]/transicao/route.ts, test/api/oportunidades-transicao.test.ts
  mensagem de commit: "T-047 fase2-kanban: Rota `POST /api/oportunidades/:id/transicao`"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-047 fase2-kanban: Rota `POST /api/oportunidades/:id/transicao` (auto-commit do plano)'
    fi
    marcar_concluidas T-047
    verde "✔ T-047 concluída"
    return 0
  fi
  vermelho "✘ T-047 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-047"
  FALHAS="$FALHAS T-047"
  return 1
}

# ── sequencial T-048 (ordem do tasks.md) ──
executar_seq_T_048() {
  info 'sequencial T-048 — Rota `GET /api/oportunidades/:id` (detalhe)'
  if rodar_tarefa seq 'T-048' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-048 — "Rota `GET /api/oportunidades/:id` (detalhe)"
  critérios/refs: AC-092 (Detalhe traz os dados do card), AC-093 (Detalhe de card de outro tenant não é acessível)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/[id]/route.ts, test/api/oportunidades-detalhe.test.ts
  mensagem de commit: "T-048 fase2-kanban: Rota `GET /api/oportunidades/:id` (detalhe)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-048 fase2-kanban: Rota `GET /api/oportunidades/:id` (detalhe) (auto-commit do plano)'
    fi
    marcar_concluidas T-048
    verde "✔ T-048 concluída"
    return 0
  fi
  vermelho "✘ T-048 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-048"
  FALHAS="$FALHAS T-048"
  return 1
}

# ── sequencial T-049 (ordem do tasks.md) ──
executar_seq_T_049() {
  info 'sequencial T-049 — Componentes do board: colunas, card, drag-and-drop'
  if rodar_tarefa seq 'T-049' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-049 — "Componentes do board: colunas, card, drag-and-drop"
  critérios/refs: AC-074 (Board só mostra cards do tenant da sessão), AC-075 (Cada card do board traz os dados básicos pra exibição), AC-076 (Filtro por etapa restringe o resultado a essa etapa), AC-077 (Filtro por responsável restringe o resultado a esse responsável), AC-094 (Board expõe as etapas de destino alcançáveis a partir de cada etapa), AC-083 (Transição fora do grafo não move o card), AC-084 (Transição com papel sem permissão não move o card), AC-091 (Rejeição por grafo ou papel mostra mensagem, sem abrir modal de dado)
  arquivos permitidos (e seus testes): src/components/pipeline/board-kanban.tsx, src/components/pipeline/coluna-etapa.tsx, src/components/pipeline/card-oportunidade.tsx, src/app/pipeline/page.tsx
  mensagem de commit: "T-049 fase2-kanban: Componentes do board: colunas, card, drag-and-drop"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-049 fase2-kanban: Componentes do board: colunas, card, drag-and-drop (auto-commit do plano)'
    fi
    marcar_concluidas T-049
    verde "✔ T-049 concluída"
    return 0
  fi
  vermelho "✘ T-049 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-049"
  FALHAS="$FALHAS T-049"
  return 1
}

# ── sequencial T-050 (ordem do tasks.md) ──
executar_seq_T_050() {
  info 'sequencial T-050 — Modal de dado faltante'
  if rodar_tarefa seq 'T-050' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-050 — "Modal de dado faltante"
  critérios/refs: AC-088 (Rejeição por dado obrigatório abre o modal correspondente), AC-089 (Preencher e confirmar o modal reenvia a transição com o dado), AC-090 (Cancelar o modal não faz nenhuma chamada)
  arquivos permitidos (e seus testes): src/components/pipeline/modal-dado-faltante.tsx
  mensagem de commit: "T-050 fase2-kanban: Modal de dado faltante"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-050 fase2-kanban: Modal de dado faltante (auto-commit do plano)'
    fi
    marcar_concluidas T-050
    verde "✔ T-050 concluída"
    return 0
  fi
  vermelho "✘ T-050 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-050"
  FALHAS="$FALHAS T-050"
  return 1
}

# ── sequencial T-051 (ordem do tasks.md) ──
executar_seq_T_051() {
  info 'sequencial T-051 — Página de detalhe do card'
  if rodar_tarefa seq 'T-051' 'Você executa UMA tarefa da feature "fase2-kanban" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2-kanban/spec.md, .spec/features/fase2-kanban/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-051 — "Página de detalhe do card"
  critérios/refs: AC-092 (Detalhe traz os dados do card), AC-093 (Detalhe de card de outro tenant não é acessível)
  arquivos permitidos (e seus testes): src/app/pipeline/[id]/page.tsx
  mensagem de commit: "T-051 fase2-kanban: Página de detalhe do card"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-051 fase2-kanban: Página de detalhe do card (auto-commit do plano)'
    fi
    marcar_concluidas T-051
    verde "✔ T-051 concluída"
    return 0
  fi
  vermelho "✘ T-051 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2-kanban/executar-tarefas.sh --seq T-051"
  FALHAS="$FALHAS T-051"
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
      amarelo "  para o veredito: bash .spec/features/fase2-kanban/executar-tarefas.sh --gate"
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
  executar_seq_T_043 || true
  executar_seq_T_044 || true
  executar_seq_T_045 || true
  executar_seq_T_046 || true
  executar_seq_T_047 || true
  executar_seq_T_048 || true
  executar_seq_T_049 || true
  executar_seq_T_050 || true
  executar_seq_T_051 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-043 (sequencial)"
  echo "  seq       T-044 (sequencial)"
  echo "  seq       T-045 (sequencial)"
  echo "  seq       T-046 (sequencial)"
  echo "  seq       T-047 (sequencial)"
  echo "  seq       T-048 (sequencial)"
  echo "  seq       T-049 (sequencial)"
  echo "  seq       T-050 (sequencial)"
  echo "  seq       T-051 (sequencial)"
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
      T-043) evento --tipo inicio --escopo "seq:T-043"; iniciar_resumos; executar_seq_T_043 || true; encerrar "seq:T-043" ;;
      T-044) evento --tipo inicio --escopo "seq:T-044"; iniciar_resumos; executar_seq_T_044 || true; encerrar "seq:T-044" ;;
      T-045) evento --tipo inicio --escopo "seq:T-045"; iniciar_resumos; executar_seq_T_045 || true; encerrar "seq:T-045" ;;
      T-046) evento --tipo inicio --escopo "seq:T-046"; iniciar_resumos; executar_seq_T_046 || true; encerrar "seq:T-046" ;;
      T-047) evento --tipo inicio --escopo "seq:T-047"; iniciar_resumos; executar_seq_T_047 || true; encerrar "seq:T-047" ;;
      T-048) evento --tipo inicio --escopo "seq:T-048"; iniciar_resumos; executar_seq_T_048 || true; encerrar "seq:T-048" ;;
      T-049) evento --tipo inicio --escopo "seq:T-049"; iniciar_resumos; executar_seq_T_049 || true; encerrar "seq:T-049" ;;
      T-050) evento --tipo inicio --escopo "seq:T-050"; iniciar_resumos; executar_seq_T_050 || true; encerrar "seq:T-050" ;;
      T-051) evento --tipo inicio --escopo "seq:T-051"; iniciar_resumos; executar_seq_T_051 || true; encerrar "seq:T-051" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
