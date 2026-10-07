#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase2c-whatsapp-conexao` em 2026-10-07 16:32
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase2c-whatsapp-conexao
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase2c-whatsapp-conexao-muybsdw7'
FEATURE='fase2c-whatsapp-conexao'
BASE_BRANCH='spec/fase2c-whatsapp-conexao'
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
  git ls-files --error-unmatch -- '.spec/features/fase2c-whatsapp-conexao/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conexao-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conexao"
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
    amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-081 (ordem do tasks.md) ──
executar_seq_T_081() {
  info 'sequencial T-081 — Migration 0010: nome de instância único entre empresas'
  if rodar_tarefa seq 'T-081' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-081 — "Migration 0010: nome de instância único entre empresas"
  critérios/refs: AC-173 (Nome de instância já usado por outra empresa é recusado)
  arquivos permitidos (e seus testes): drizzle/0010_whatsapp_conexao.sql, drizzle/meta/_journal.json, src/db/schema/identidade.ts, test/db/whatsapp-conexao-migration.test.ts
  mensagem de commit: "T-081 fase2c-whatsapp-conexao: Migration 0010: nome de instância único entre empresas"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-081 fase2c-whatsapp-conexao: Migration 0010: nome de instância único entre empresas (auto-commit do plano)'
    fi
    marcar_concluidas T-081
    verde "✔ T-081 concluída"
    return 0
  fi
  vermelho "✘ T-081 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-081"
  FALHAS="$FALHAS T-081"
  return 1
}

# ── sequencial T-082 (ordem do tasks.md) ──
executar_seq_T_082() {
  info 'sequencial T-082 — Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado'
  if rodar_tarefa seq 'T-082' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-082 — "Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado"
  critérios/refs: AC-176 (Com instância, o status vem da Evolution), AC-180 (O QR code vem depois de criar a instância e registrar o webhook), AC-184 (Instância já conectada não pede QR code), AC-185 (Falha ao registrar o webhook não esconde o QR, mas avisa), AC-186 (Falha ao criar a instância é devolvida como erro)
  arquivos permitidos (e seus testes): test/support/evolution-falsa.ts
  mensagem de commit: "T-082 fase2c-whatsapp-conexao: Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-082 fase2c-whatsapp-conexao: Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado (auto-commit do plano)'
    fi
    marcar_concluidas T-082
    verde "✔ T-082 concluída"
    return 0
  fi
  vermelho "✘ T-082 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-082"
  FALHAS="$FALHAS T-082"
  return 1
}

# ── sequencial T-083 (ordem do tasks.md) ──
executar_seq_T_083() {
  info 'sequencial T-083 — Validação da configuração e cliente Evolution que reporta falha do webhook'
  if rodar_tarefa seq 'T-083' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-083 — "Validação da configuração e cliente Evolution que reporta falha do webhook"
  critérios/refs: AC-174 (Corpo ou nome de instância inválido é recusado), AC-177 (Evolution fora do ar aparece como desconectado), AC-185 (Falha ao registrar o webhook não esconde o QR, mas avisa), AC-186 (Falha ao criar a instância é devolvida como erro)
  arquivos permitidos (e seus testes): src/domain/whatsapp/config.ts, src/lib/evolution-api.ts, test/domain/whatsapp-config.test.ts
  mensagem de commit: "T-083 fase2c-whatsapp-conexao: Validação da configuração e cliente Evolution que reporta falha do webhook"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-083 fase2c-whatsapp-conexao: Validação da configuração e cliente Evolution que reporta falha do webhook (auto-commit do plano)'
    fi
    marcar_concluidas T-083
    verde "✔ T-083 concluída"
    return 0
  fi
  vermelho "✘ T-083 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-083"
  FALHAS="$FALHAS T-083"
  return 1
}

# ── sequencial T-084 (ordem do tasks.md) ──
executar_seq_T_084() {
  info 'sequencial T-084 — Repositório da configuração e do segredo do webhook'
  if rodar_tarefa seq 'T-084' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-084 — "Repositório da configuração e do segredo do webhook"
  critérios/refs: AC-168 (A configuração devolvida traz só as chaves permitidas), AC-169 (A configuração de outra empresa não aparece), AC-170 (MASTER e GERENTE salvam a configuração), AC-172 (Só as chaves permitidas são gravadas), AC-173 (Nome de instância já usado por outra empresa é recusado), AC-182 (Empresa sem segredo recebe um gerado pelo servidor)
  arquivos permitidos (e seus testes): src/repositories/whatsapp-config.ts, test/repositories/whatsapp-config.test.ts
  mensagem de commit: "T-084 fase2c-whatsapp-conexao: Repositório da configuração e do segredo do webhook"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-084 fase2c-whatsapp-conexao: Repositório da configuração e do segredo do webhook (auto-commit do plano)'
    fi
    marcar_concluidas T-084
    verde "✔ T-084 concluída"
    return 0
  fi
  vermelho "✘ T-084 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-084"
  FALHAS="$FALHAS T-084"
  return 1
}

# ── sequencial T-085 (ordem do tasks.md) ──
executar_seq_T_085() {
  info 'sequencial T-085 — Rota GET e POST /api/whatsapp/config'
  if rodar_tarefa seq 'T-085' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-085 — "Rota GET e POST /api/whatsapp/config"
  critérios/refs: AC-167 (Sem login, as três rotas são recusadas), AC-168 (A configuração devolvida traz só as chaves permitidas), AC-169 (A configuração de outra empresa não aparece), AC-170 (MASTER e GERENTE salvam a configuração), AC-171 (Atendente não altera a configuração), AC-172 (Só as chaves permitidas são gravadas), AC-173 (Nome de instância já usado por outra empresa é recusado), AC-174 (Corpo ou nome de instância inválido é recusado), AC-183 (O segredo nunca sai nas respostas)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/config/route.ts, test/api/whatsapp-config.test.ts
  mensagem de commit: "T-085 fase2c-whatsapp-conexao: Rota GET e POST /api/whatsapp/config"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-085 fase2c-whatsapp-conexao: Rota GET e POST /api/whatsapp/config (auto-commit do plano)'
    fi
    marcar_concluidas T-085
    verde "✔ T-085 concluída"
    return 0
  fi
  vermelho "✘ T-085 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-085"
  FALHAS="$FALHAS T-085"
  return 1
}

# ── sequencial T-086 (ordem do tasks.md) ──
executar_seq_T_086() {
  info 'sequencial T-086 — Rota GET /api/whatsapp/status'
  if rodar_tarefa seq 'T-086' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-086 — "Rota GET /api/whatsapp/status"
  critérios/refs: AC-167 (Sem login, as três rotas são recusadas), AC-175 (Sem instância cadastrada, o status avisa), AC-176 (Com instância, o status vem da Evolution), AC-177 (Evolution fora do ar aparece como desconectado), AC-183 (O segredo nunca sai nas respostas)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/status/route.ts, test/api/whatsapp-status.test.ts
  mensagem de commit: "T-086 fase2c-whatsapp-conexao: Rota GET /api/whatsapp/status"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-086 fase2c-whatsapp-conexao: Rota GET /api/whatsapp/status (auto-commit do plano)'
    fi
    marcar_concluidas T-086
    verde "✔ T-086 concluída"
    return 0
  fi
  vermelho "✘ T-086 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-086"
  FALHAS="$FALHAS T-086"
  return 1
}

# ── sequencial T-087 (ordem do tasks.md) ──
executar_seq_T_087() {
  info 'sequencial T-087 — Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase'
  if rodar_tarefa seq 'T-087' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conexao" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conexao/spec.md, .spec/features/fase2c-whatsapp-conexao/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-087 — "Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase"
  critérios/refs: AC-167 (Sem login, as três rotas são recusadas), AC-175 (Sem instância cadastrada, o status avisa), AC-176 (Com instância, o status vem da Evolution), AC-178 (Atendente não gera QR code), AC-179 (Sem instância cadastrada, não há o que conectar), AC-180 (O QR code vem depois de criar a instância e registrar o webhook), AC-181 (O webhook registrado leva a empresa e o segredo), AC-182 (Empresa sem segredo recebe um gerado pelo servidor), AC-183 (O segredo nunca sai nas respostas), AC-184 (Instância já conectada não pede QR code), AC-185 (Falha ao registrar o webhook não esconde o QR, mas avisa), AC-186 (Falha ao criar a instância é devolvida como erro)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/qrcode/route.ts, src/lib/evolution-server.ts, test/api/whatsapp-qrcode.test.ts
  mensagem de commit: "T-087 fase2c-whatsapp-conexao: Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-087 fase2c-whatsapp-conexao: Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase (auto-commit do plano)'
    fi
    marcar_concluidas T-087
    verde "✔ T-087 concluída"
    return 0
  fi
  vermelho "✘ T-087 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --seq T-087"
  FALHAS="$FALHAS T-087"
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
      amarelo "  para o veredito: bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh --gate"
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
  executar_seq_T_081 || true
  executar_seq_T_082 || true
  executar_seq_T_083 || true
  executar_seq_T_084 || true
  executar_seq_T_085 || true
  executar_seq_T_086 || true
  executar_seq_T_087 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-081 (sequencial)"
  echo "  seq       T-082 (sequencial)"
  echo "  seq       T-083 (sequencial)"
  echo "  seq       T-084 (sequencial)"
  echo "  seq       T-085 (sequencial)"
  echo "  seq       T-086 (sequencial)"
  echo "  seq       T-087 (sequencial)"
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
      T-081) evento --tipo inicio --escopo "seq:T-081"; iniciar_resumos; executar_seq_T_081 || true; encerrar "seq:T-081" ;;
      T-082) evento --tipo inicio --escopo "seq:T-082"; iniciar_resumos; executar_seq_T_082 || true; encerrar "seq:T-082" ;;
      T-083) evento --tipo inicio --escopo "seq:T-083"; iniciar_resumos; executar_seq_T_083 || true; encerrar "seq:T-083" ;;
      T-084) evento --tipo inicio --escopo "seq:T-084"; iniciar_resumos; executar_seq_T_084 || true; encerrar "seq:T-084" ;;
      T-085) evento --tipo inicio --escopo "seq:T-085"; iniciar_resumos; executar_seq_T_085 || true; encerrar "seq:T-085" ;;
      T-086) evento --tipo inicio --escopo "seq:T-086"; iniciar_resumos; executar_seq_T_086 || true; encerrar "seq:T-086" ;;
      T-087) evento --tipo inicio --escopo "seq:T-087"; iniciar_resumos; executar_seq_T_087 || true; encerrar "seq:T-087" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
