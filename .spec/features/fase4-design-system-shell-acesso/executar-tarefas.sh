#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase4-design-system-shell-acesso` em 2026-10-23 16:21
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase4-design-system-shell-acesso
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase4-design-system-shell-acesso-mvl6fxcp'
FEATURE='fase4-design-system-shell-acesso'
BASE_BRANCH='spec/fase4-design-system-shell-acesso'
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
  git ls-files --error-unmatch -- '.spec/features/fase4-design-system-shell-acesso/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-design-system-shell-acesso-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-design-system-shell-acesso"
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
    amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-140 (ordem do tasks.md) ──
executar_seq_T_140() {
  info 'sequencial T-140 — Tokens de tema, fontes e ícones do protótipo'
  if rodar_tarefa seq 'T-140' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-140 — "Tokens de tema, fontes e ícones do protótipo"
  critérios/refs: AC-345 (Os tokens do protótipo viram classes utilizáveis), AC-346 (As fontes e os ícones do protótipo são carregados)
  arquivos permitidos (e seus testes): src/app/globals.css, src/app/layout.tsx, test/ui/design-system.test.ts
  mensagem de commit: "T-140 fase4-design-system-shell-acesso: Tokens de tema, fontes e ícones do protótipo"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-140 fase4-design-system-shell-acesso: Tokens de tema, fontes e ícones do protótipo (auto-commit do plano)'
    fi
    marcar_concluidas T-140
    verde "✔ T-140 concluída"
    return 0
  fi
  vermelho "✘ T-140 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-140"
  FALHAS="$FALHAS T-140"
  return 1
}

# ── sequencial T-141 (ordem do tasks.md) ──
executar_seq_T_141() {
  info 'sequencial T-141 — Política de senha única e nome gravado no convite'
  if rodar_tarefa seq 'T-141' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-141 — "Política de senha única e nome gravado no convite"
  critérios/refs: AC-385 (O servidor recusa senha fora da política), AC-386 (As duas telas mostram exatamente as regras que o servidor aplica)
  arquivos permitidos (e seus testes): src/lib/auth/politica-senha.ts, src/lib/auth/definir-senha.ts, src/lib/auth/reset-senha.ts, test/auth/politica-senha.test.ts
  mensagem de commit: "T-141 fase4-design-system-shell-acesso: Política de senha única e nome gravado no convite"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-141 fase4-design-system-shell-acesso: Política de senha única e nome gravado no convite (auto-commit do plano)'
    fi
    marcar_concluidas T-141
    verde "✔ T-141 concluída"
    return 0
  fi
  vermelho "✘ T-141 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-141"
  FALHAS="$FALHAS T-141"
  return 1
}

# ── sequencial T-142 (ordem do tasks.md) ──
executar_seq_T_142() {
  info 'sequencial T-142 — Envio de e-mail (Resend) para redefinição de senha'
  if rodar_tarefa seq 'T-142' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-142 — "Envio de e-mail (Resend) para redefinição de senha"
  critérios/refs: AC-365 (O e-mail só é enviado quando a conta existe)
  arquivos permitidos (e seus testes): src/lib/email/enviar.ts, src/lib/email/templates.ts, test/email/enviar.test.ts
  mensagem de commit: "T-142 fase4-design-system-shell-acesso: Envio de e-mail (Resend) para redefinição de senha"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-142 fase4-design-system-shell-acesso: Envio de e-mail (Resend) para redefinição de senha (auto-commit do plano)'
    fi
    marcar_concluidas T-142
    verde "✔ T-142 concluída"
    return 0
  fi
  vermelho "✘ T-142 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-142"
  FALHAS="$FALHAS T-142"
  return 1
}

# ── sequencial T-143 (ordem do tasks.md) ──
executar_seq_T_143() {
  info 'sequencial T-143 — Permissões por rota, middleware do Better Auth e raiz'
  if rodar_tarefa seq 'T-143' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-143 — "Permissões por rota, middleware do Better Auth e raiz"
  critérios/refs: AC-379 (Sem sessão, páginas vão para o login e APIs respondem 401), AC-380 (O que precisa ser público continua público), AC-381 (Papel sem permissão vai para a tela de sem acesso), AC-382 (A raiz leva ao lugar certo), AC-384 (O middleware já não consulta o Supabase)
  arquivos permitidos (e seus testes): src/middleware.ts, src/lib/auth/rotas.ts, src/app/page.tsx, test/auth/middleware.test.ts
  mensagem de commit: "T-143 fase4-design-system-shell-acesso: Permissões por rota, middleware do Better Auth e raiz"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-143 fase4-design-system-shell-acesso: Permissões por rota, middleware do Better Auth e raiz (auto-commit do plano)'
    fi
    marcar_concluidas T-143
    verde "✔ T-143 concluída"
    return 0
  fi
  vermelho "✘ T-143 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-143"
  FALHAS="$FALHAS T-143"
  return 1
}

# ── sequencial T-144 (ordem do tasks.md) ──
executar_seq_T_144() {
  info 'sequencial T-144 — Rotas HTTP de autenticação, `/api/me` e empresa ativa'
  if rodar_tarefa seq 'T-144' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-144 — "Rotas HTTP de autenticação, `/api/me` e empresa ativa"
  critérios/refs: AC-353 (Só o super admin vê e usa o seletor de empresa), AC-357 (Sair encerra a sessão), AC-378 (As rotas do Better Auth atendem pelo navegador), AC-383 (`/api/me` entrega o necessário para a casca)
  arquivos permitidos (e seus testes): src/app/api/auth/[...all]/route.ts, src/app/api/me/route.ts, src/app/api/empresa-ativa/route.ts, test/api/auth-http.test.ts
  mensagem de commit: "T-144 fase4-design-system-shell-acesso: Rotas HTTP de autenticação, `/api/me` e empresa ativa"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-144 fase4-design-system-shell-acesso: Rotas HTTP de autenticação, `/api/me` e empresa ativa (auto-commit do plano)'
    fi
    marcar_concluidas T-144
    verde "✔ T-144 concluída"
    return 0
  fi
  vermelho "✘ T-144 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-144"
  FALHAS="$FALHAS T-144"
  return 1
}

# ── sequencial T-145 (ordem do tasks.md) ──
executar_seq_T_145() {
  info 'sequencial T-145 — APIs das telas públicas: esqueci, redefinir e convite'
  if rodar_tarefa seq 'T-145' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-145 — "APIs das telas públicas: esqueci, redefinir e convite"
  critérios/refs: AC-364 (A confirmação é a mesma para qualquer e-mail), AC-365 (O e-mail só é enviado quando a conta existe), AC-369 (Salvar troca a senha e já entra no sistema), AC-370 (Link expirado ou já usado mostra a tela de erro, sem pedir senha), AC-371 (A tela mostra para quem é o convite), AC-373 (Ativar cria a senha, grava o nome e entra), AC-374 (Convite inválido mostra o erro sem vazar dados da empresa)
  arquivos permitidos (e seus testes): src/app/api/acesso/esqueci-senha/route.ts, src/app/api/acesso/redefinir-senha/[token]/route.ts, src/app/api/acesso/convite/[token]/route.ts, test/api/acesso.test.ts
  mensagem de commit: "T-145 fase4-design-system-shell-acesso: APIs das telas públicas: esqueci, redefinir e convite"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-145 fase4-design-system-shell-acesso: APIs das telas públicas: esqueci, redefinir e convite (auto-commit do plano)'
    fi
    marcar_concluidas T-145
    verde "✔ T-145 concluída"
    return 0
  fi
  vermelho "✘ T-145 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-145"
  FALHAS="$FALHAS T-145"
  return 1
}

# ── sequencial T-146 (ordem do tasks.md) ──
executar_seq_T_146() {
  info 'sequencial T-146 — Casca: menu lateral, topo e layout das telas logadas'
  if rodar_tarefa seq 'T-146' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-146 — "Casca: menu lateral, topo e layout das telas logadas"
  critérios/refs: AC-348 (O menu traz os grupos e itens do protótipo), AC-349 (O menu esconde o que o papel não pode ver), AC-350 (O item da tela atual aparece destacado), AC-351 (Os contadores do menu mostram números reais), AC-352 (O topo mostra quem está logado), AC-353 (Só o super admin vê e usa o seletor de empresa), AC-354 (O indicador de tempo real diz a verdade), AC-355 (O que não tem backend aparece como "em breve"), AC-356 (No celular o menu vira gaveta), AC-357 (Sair encerra a sessão)
  arquivos permitidos (e seus testes): src/components/shell/menu-lateral.tsx, src/components/shell/topo.tsx, src/components/shell/menu-config.ts, src/components/shell/use-contadores.ts, src/components/shell/use-tempo-real.ts, src/app/(app)/layout.tsx, test/components/shell/casca.test.tsx
  mensagem de commit: "T-146 fase4-design-system-shell-acesso: Casca: menu lateral, topo e layout das telas logadas"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-146 fase4-design-system-shell-acesso: Casca: menu lateral, topo e layout das telas logadas (auto-commit do plano)'
    fi
    marcar_concluidas T-146
    verde "✔ T-146 concluída"
    return 0
  fi
  vermelho "✘ T-146 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-146"
  FALHAS="$FALHAS T-146"
  return 1
}

# ── sequencial T-147 (ordem do tasks.md) ──
executar_seq_T_147() {
  info 'sequencial T-147 — Moldura das telas de acesso (fundo, cartão e rodapé)'
  if rodar_tarefa seq 'T-147' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-147 — "Moldura das telas de acesso (fundo, cartão e rodapé)"
  critérios/refs: AC-347 (As telas de acesso não trazem artefatos do protótipo), AC-362 (Quem já está logado não vê o login)
  arquivos permitidos (e seus testes): src/components/auth/moldura-acesso.tsx, src/components/auth/criterios-senha.tsx, src/app/(auth)/layout.tsx, test/components/auth/moldura.test.tsx
  mensagem de commit: "T-147 fase4-design-system-shell-acesso: Moldura das telas de acesso (fundo, cartão e rodapé)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-147 fase4-design-system-shell-acesso: Moldura das telas de acesso (fundo, cartão e rodapé) (auto-commit do plano)'
    fi
    marcar_concluidas T-147
    verde "✔ T-147 concluída"
    return 0
  fi
  vermelho "✘ T-147 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-147"
  FALHAS="$FALHAS T-147"
  return 1
}

# ── sequencial T-148 (ordem do tasks.md) ──
executar_seq_T_148() {
  info 'sequencial T-148 — Tela de login'
  if rodar_tarefa seq 'T-148' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-148 — "Tela de login"
  critérios/refs: AC-358 (Login correto leva ao sistema), AC-359 (Credenciais erradas mostram o aviso com as tentativas que restam), AC-360 (Excesso de tentativas bloqueia a tela com contagem regressiva), AC-361 (Enquanto envia, o botão não aceita novo clique)
  arquivos permitidos (e seus testes): src/app/(auth)/login/page.tsx, src/components/auth/formulario-login.tsx, test/components/auth/login.test.tsx
  mensagem de commit: "T-148 fase4-design-system-shell-acesso: Tela de login"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-148 fase4-design-system-shell-acesso: Tela de login (auto-commit do plano)'
    fi
    marcar_concluidas T-148
    verde "✔ T-148 concluída"
    return 0
  fi
  vermelho "✘ T-148 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-148"
  FALHAS="$FALHAS T-148"
  return 1
}

# ── sequencial T-149 (ordem do tasks.md) ──
executar_seq_T_149() {
  info 'sequencial T-149 — Tela de esqueci minha senha'
  if rodar_tarefa seq 'T-149' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-149 — "Tela de esqueci minha senha"
  critérios/refs: AC-363 (E-mail inválido é recusado na própria tela), AC-366 (Dá para tentar outro e-mail)
  arquivos permitidos (e seus testes): src/app/(auth)/esqueci-senha/page.tsx, src/components/auth/formulario-esqueci-senha.tsx, test/components/auth/esqueci-senha.test.tsx
  mensagem de commit: "T-149 fase4-design-system-shell-acesso: Tela de esqueci minha senha"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-149 fase4-design-system-shell-acesso: Tela de esqueci minha senha (auto-commit do plano)'
    fi
    marcar_concluidas T-149
    verde "✔ T-149 concluída"
    return 0
  fi
  vermelho "✘ T-149 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-149"
  FALHAS="$FALHAS T-149"
  return 1
}

# ── sequencial T-150 (ordem do tasks.md) ──
executar_seq_T_150() {
  info 'sequencial T-150 — Tela de redefinir senha'
  if rodar_tarefa seq 'T-150' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-150 — "Tela de redefinir senha"
  critérios/refs: AC-367 (Os critérios de senha acendem enquanto o usuário digita), AC-368 (Senhas diferentes impedem o envio)
  arquivos permitidos (e seus testes): src/app/(auth)/redefinir-senha/[token]/page.tsx, src/components/auth/formulario-redefinir-senha.tsx, test/components/auth/redefinir-senha.test.tsx
  mensagem de commit: "T-150 fase4-design-system-shell-acesso: Tela de redefinir senha"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-150 fase4-design-system-shell-acesso: Tela de redefinir senha (auto-commit do plano)'
    fi
    marcar_concluidas T-150
    verde "✔ T-150 concluída"
    return 0
  fi
  vermelho "✘ T-150 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-150"
  FALHAS="$FALHAS T-150"
  return 1
}

# ── sequencial T-151 (ordem do tasks.md) ──
executar_seq_T_151() {
  info 'sequencial T-151 — Tela de convite'
  if rodar_tarefa seq 'T-151' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-151 — "Tela de convite"
  critérios/refs: AC-372 (Ativar exige nome, senha válida e aceite dos termos)
  arquivos permitidos (e seus testes): src/app/(auth)/convite/[token]/page.tsx, src/components/auth/formulario-convite.tsx, test/components/auth/convite.test.tsx
  mensagem de commit: "T-151 fase4-design-system-shell-acesso: Tela de convite"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-151 fase4-design-system-shell-acesso: Tela de convite (auto-commit do plano)'
    fi
    marcar_concluidas T-151
    verde "✔ T-151 concluída"
    return 0
  fi
  vermelho "✘ T-151 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-151"
  FALHAS="$FALHAS T-151"
  return 1
}

# ── sequencial T-152 (ordem do tasks.md) ──
executar_seq_T_152() {
  info 'sequencial T-152 — Tela de sem acesso e sessão expirada'
  if rodar_tarefa seq 'T-152' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-152 — "Tela de sem acesso e sessão expirada"
  critérios/refs: AC-375 (A tela mostra o perfil e o que foi pedido), AC-376 (As ações da tela levam aonde dizem), AC-377 (Sem sessão, a tela se apresenta como sessão expirada)
  arquivos permitidos (e seus testes): src/app/(auth)/sem-acesso/page.tsx, src/components/auth/painel-sem-acesso.tsx, src/lib/auth/nomes-de-rotas.ts, test/components/auth/sem-acesso.test.tsx
  mensagem de commit: "T-152 fase4-design-system-shell-acesso: Tela de sem acesso e sessão expirada"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-152 fase4-design-system-shell-acesso: Tela de sem acesso e sessão expirada (auto-commit do plano)'
    fi
    marcar_concluidas T-152
    verde "✔ T-152 concluída"
    return 0
  fi
  vermelho "✘ T-152 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-152"
  FALHAS="$FALHAS T-152"
  return 1
}

# ── sequencial T-153 (ordem do tasks.md) ──
executar_seq_T_153() {
  info 'sequencial T-153 — Garantia transversal: nenhuma tela de acesso traz artefato do protótipo'
  if rodar_tarefa seq 'T-153' 'Você executa UMA tarefa da feature "fase4-design-system-shell-acesso" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-design-system-shell-acesso/spec.md, .spec/features/fase4-design-system-shell-acesso/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-153 — "Garantia transversal: nenhuma tela de acesso traz artefato do protótipo"
  critérios/refs: AC-347 (As telas de acesso não trazem artefatos do protótipo)
  arquivos permitidos (e seus testes): test/components/auth/sem-artefatos.test.tsx
  mensagem de commit: "T-153 fase4-design-system-shell-acesso: Garantia transversal: nenhuma tela de acesso traz artefato do protótipo"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-153 fase4-design-system-shell-acesso: Garantia transversal: nenhuma tela de acesso traz artefato do protótipo (auto-commit do plano)'
    fi
    marcar_concluidas T-153
    verde "✔ T-153 concluída"
    return 0
  fi
  vermelho "✘ T-153 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --seq T-153"
  FALHAS="$FALHAS T-153"
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
      amarelo "  para o veredito: bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh --gate"
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
  executar_seq_T_140 || true
  executar_seq_T_141 || true
  executar_seq_T_142 || true
  executar_seq_T_143 || true
  executar_seq_T_144 || true
  executar_seq_T_145 || true
  executar_seq_T_146 || true
  executar_seq_T_147 || true
  executar_seq_T_148 || true
  executar_seq_T_149 || true
  executar_seq_T_150 || true
  executar_seq_T_151 || true
  executar_seq_T_152 || true
  executar_seq_T_153 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-140 (sequencial)"
  echo "  seq       T-141 (sequencial)"
  echo "  seq       T-142 (sequencial)"
  echo "  seq       T-143 (sequencial)"
  echo "  seq       T-144 (sequencial)"
  echo "  seq       T-145 (sequencial)"
  echo "  seq       T-146 (sequencial)"
  echo "  seq       T-147 (sequencial)"
  echo "  seq       T-148 (sequencial)"
  echo "  seq       T-149 (sequencial)"
  echo "  seq       T-150 (sequencial)"
  echo "  seq       T-151 (sequencial)"
  echo "  seq       T-152 (sequencial)"
  echo "  seq       T-153 (sequencial)"
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
      T-140) evento --tipo inicio --escopo "seq:T-140"; iniciar_resumos; executar_seq_T_140 || true; encerrar "seq:T-140" ;;
      T-141) evento --tipo inicio --escopo "seq:T-141"; iniciar_resumos; executar_seq_T_141 || true; encerrar "seq:T-141" ;;
      T-142) evento --tipo inicio --escopo "seq:T-142"; iniciar_resumos; executar_seq_T_142 || true; encerrar "seq:T-142" ;;
      T-143) evento --tipo inicio --escopo "seq:T-143"; iniciar_resumos; executar_seq_T_143 || true; encerrar "seq:T-143" ;;
      T-144) evento --tipo inicio --escopo "seq:T-144"; iniciar_resumos; executar_seq_T_144 || true; encerrar "seq:T-144" ;;
      T-145) evento --tipo inicio --escopo "seq:T-145"; iniciar_resumos; executar_seq_T_145 || true; encerrar "seq:T-145" ;;
      T-146) evento --tipo inicio --escopo "seq:T-146"; iniciar_resumos; executar_seq_T_146 || true; encerrar "seq:T-146" ;;
      T-147) evento --tipo inicio --escopo "seq:T-147"; iniciar_resumos; executar_seq_T_147 || true; encerrar "seq:T-147" ;;
      T-148) evento --tipo inicio --escopo "seq:T-148"; iniciar_resumos; executar_seq_T_148 || true; encerrar "seq:T-148" ;;
      T-149) evento --tipo inicio --escopo "seq:T-149"; iniciar_resumos; executar_seq_T_149 || true; encerrar "seq:T-149" ;;
      T-150) evento --tipo inicio --escopo "seq:T-150"; iniciar_resumos; executar_seq_T_150 || true; encerrar "seq:T-150" ;;
      T-151) evento --tipo inicio --escopo "seq:T-151"; iniciar_resumos; executar_seq_T_151 || true; encerrar "seq:T-151" ;;
      T-152) evento --tipo inicio --escopo "seq:T-152"; iniciar_resumos; executar_seq_T_152 || true; encerrar "seq:T-152" ;;
      T-153) evento --tipo inicio --escopo "seq:T-153"; iniciar_resumos; executar_seq_T_153 || true; encerrar "seq:T-153" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
