#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase2c-whatsapp-conversa` em 2026-10-06 13:20
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase2c-whatsapp-conversa
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase2c-whatsapp-conversa-muwpijcs'
FEATURE='fase2c-whatsapp-conversa'
BASE_BRANCH='spec/fase2c-whatsapp-conversa'
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
  git ls-files --error-unmatch -- '.spec/features/fase2c-whatsapp-conversa/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conversa-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conversa"
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
    amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-071 (ordem do tasks.md) ──
executar_seq_T_071() {
  info 'sequencial T-071 — Migration 0009: telefones do lead e estado de leitura'
  if rodar_tarefa seq 'T-071' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-071 — "Migration 0009: telefones do lead e estado de leitura"
  critérios/refs: AC-153 (Mensagens antigas não viram "não lidas" na virada), AC-164 (Telefones de uma empresa não aparecem para outra)
  arquivos permitidos (e seus testes): drizzle/0009_whatsapp_conversa.sql, drizzle/meta/_journal.json, src/db/schema/pipeline.ts, src/db/schema/legado.ts, test/whatsapp/conversa-sql.test.ts
  mensagem de commit: "T-071 fase2c-whatsapp-conversa: Migration 0009: telefones do lead e estado de leitura"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-071 fase2c-whatsapp-conversa: Migration 0009: telefones do lead e estado de leitura (auto-commit do plano)'
    fi
    marcar_concluidas T-071
    verde "✔ T-071 concluída"
    return 0
  fi
  vermelho "✘ T-071 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-071"
  FALHAS="$FALHAS T-071"
  return 1
}

# ── sequencial T-072 (ordem do tasks.md) ──
executar_seq_T_072() {
  info 'sequencial T-072 — Normalização e variações de número (módulo puro)'
  if rodar_tarefa seq 'T-072' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-072 — "Normalização e variações de número (módulo puro)"
  critérios/refs: AC-143 (Pedido de envio mal formado é recusado), AC-149 (O número é reconhecido com DDI e com a variação do nono dígito), AC-161 (Telefone repetido é recusado, inclusive com a variação do nono dígito), AC-162 (Número inválido ou lead alheio é recusado)
  arquivos permitidos (e seus testes): src/domain/whatsapp/numero.ts, test/whatsapp/numero.test.ts
  mensagem de commit: "T-072 fase2c-whatsapp-conversa: Normalização e variações de número (módulo puro)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-072 fase2c-whatsapp-conversa: Normalização e variações de número (módulo puro) (auto-commit do plano)'
    fi
    marcar_concluidas T-072
    verde "✔ T-072 concluída"
    return 0
  fi
  vermelho "✘ T-072 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-072"
  FALHAS="$FALHAS T-072"
  return 1
}

# ── sequencial T-073 (ordem do tasks.md) ──
executar_seq_T_073() {
  info 'sequencial T-073 — Repositório dos telefones do lead'
  if rodar_tarefa seq 'T-073' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-073 — "Repositório dos telefones do lead"
  critérios/refs: AC-160 (Cadastrar um telefone extra no lead), AC-161 (Telefone repetido é recusado, inclusive com a variação do nono dígito), AC-163 (Listar e remover telefones do lead), AC-164 (Telefones de uma empresa não aparecem para outra)
  arquivos permitidos (e seus testes): src/repositories/lead-telefones.ts, test/repositories/lead-telefones.test.ts
  mensagem de commit: "T-073 fase2c-whatsapp-conversa: Repositório dos telefones do lead"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-073 fase2c-whatsapp-conversa: Repositório dos telefones do lead (auto-commit do plano)'
    fi
    marcar_concluidas T-073
    verde "✔ T-073 concluída"
    return 0
  fi
  vermelho "✘ T-073 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-073"
  FALHAS="$FALHAS T-073"
  return 1
}

# ── sequencial T-074 (ordem do tasks.md) ──
executar_seq_T_074() {
  info 'sequencial T-074 — Rotas de telefones do lead'
  if rodar_tarefa seq 'T-074' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-074 — "Rotas de telefones do lead"
  critérios/refs: AC-160 (Cadastrar um telefone extra no lead), AC-161 (Telefone repetido é recusado, inclusive com a variação do nono dígito), AC-162 (Número inválido ou lead alheio é recusado), AC-163 (Listar e remover telefones do lead), AC-164 (Telefones de uma empresa não aparecem para outra)
  arquivos permitidos (e seus testes): src/app/api/leads/[id]/telefones/route.ts, src/app/api/leads/[id]/telefones/[telefoneId]/route.ts, test/api/lead-telefones.test.ts
  mensagem de commit: "T-074 fase2c-whatsapp-conversa: Rotas de telefones do lead"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-074 fase2c-whatsapp-conversa: Rotas de telefones do lead (auto-commit do plano)'
    fi
    marcar_concluidas T-074
    verde "✔ T-074 concluída"
    return 0
  fi
  vermelho "✘ T-074 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-074"
  FALHAS="$FALHAS T-074"
  return 1
}

# ── sequencial T-075 (ordem do tasks.md) ──
executar_seq_T_075() {
  info 'sequencial T-075 — Busca de lead por qualquer telefone (principal e extras)'
  if rodar_tarefa seq 'T-075' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-075 — "Busca de lead por qualquer telefone (principal e extras)"
  critérios/refs: AC-142 (Número avulso que pertence a um lead da empresa é ligado a ele), AC-165 (Resposta no telefone extra liga ao lead e encerra a cadência), AC-166 (Desempate quando o mesmo número aparece em mais de um lead)
  arquivos permitidos (e seus testes): src/repositories/whatsapp.ts, test/repositories/whatsapp-telefones.test.ts
  mensagem de commit: "T-075 fase2c-whatsapp-conversa: Busca de lead por qualquer telefone (principal e extras)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-075 fase2c-whatsapp-conversa: Busca de lead por qualquer telefone (principal e extras) (auto-commit do plano)'
    fi
    marcar_concluidas T-075
    verde "✔ T-075 concluída"
    return 0
  fi
  vermelho "✘ T-075 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-075"
  FALHAS="$FALHAS T-075"
  return 1
}

# ── sequencial T-076 (ordem do tasks.md) ──
executar_seq_T_076() {
  info 'sequencial T-076 — Repositório: histórico, não lidas, marcar como lida e registrar enviada'
  if rodar_tarefa seq 'T-076' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-076 — "Repositório: histórico, não lidas, marcar como lida e registrar enviada"
  critérios/refs: AC-148 (Histórico por número traz enviadas e recebidas em ordem), AC-149 (O número é reconhecido com DDI e com a variação do nono dígito), AC-150 (Histórico por lead reúne todos os telefones do lead), AC-151 (Histórico nunca mostra mensagens de outra empresa), AC-154 (Não lidas lista só recebidas ainda não lidas, por conversa), AC-155 (Telefones diferentes do mesmo lead contam como uma conversa só), AC-157 (Abrir a conversa marca as recebidas como lidas), AC-158 (Marcar como lida é idempotente e nunca toca em outra conversa nem em outra empresa), AC-159 (Mensagem nova depois de lida volta a contar)
  arquivos permitidos (e seus testes): src/repositories/whatsapp.ts, test/repositories/whatsapp-conversa.test.ts
  mensagem de commit: "T-076 fase2c-whatsapp-conversa: Repositório: histórico, não lidas, marcar como lida e registrar enviada"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-076 fase2c-whatsapp-conversa: Repositório: histórico, não lidas, marcar como lida e registrar enviada (auto-commit do plano)'
    fi
    marcar_concluidas T-076
    verde "✔ T-076 concluída"
    return 0
  fi
  vermelho "✘ T-076 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-076"
  FALHAS="$FALHAS T-076"
  return 1
}

# ── sequencial T-077 (ordem do tasks.md) ──
executar_seq_T_077() {
  info 'sequencial T-077 — Instância WhatsApp da empresa lida do Postgres novo'
  if rodar_tarefa seq 'T-077' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-077 — "Instância WhatsApp da empresa lida do Postgres novo"
  critérios/refs: AC-144 (Sem instância configurada, nada é enviado)
  arquivos permitidos (e seus testes): src/repositories/whatsapp-instancia.ts, test/repositories/whatsapp-instancia.test.ts
  mensagem de commit: "T-077 fase2c-whatsapp-conversa: Instância WhatsApp da empresa lida do Postgres novo"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-077 fase2c-whatsapp-conversa: Instância WhatsApp da empresa lida do Postgres novo (auto-commit do plano)'
    fi
    marcar_concluidas T-077
    verde "✔ T-077 concluída"
    return 0
  fi
  vermelho "✘ T-077 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-077"
  FALHAS="$FALHAS T-077"
  return 1
}

# ── sequencial T-078 (ordem do tasks.md) ──
executar_seq_T_078() {
  info 'sequencial T-078 — Rota POST /api/whatsapp/send'
  if rodar_tarefa seq 'T-078' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-078 — "Rota POST /api/whatsapp/send"
  critérios/refs: AC-135 (Sem login, o envio é recusado), AC-136 (Mensagem ao lead é enviada e registrada), AC-137 (Lead de outra empresa ou inexistente não recebe mensagem), AC-138 (Lead sem telefone não recebe mensagem), AC-139 (Dá para escolher qual telefone do lead recebe), AC-140 (Envio sem escolher telefone usa o principal), AC-141 (Número avulso é aceito e gravado sem lead), AC-143 (Pedido de envio mal formado é recusado), AC-144 (Sem instância configurada, nada é enviado), AC-145 (Falha na Evolution não deixa mensagem fantasma), AC-146 (Enviar mensagem não mexe no card nem na cadência)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/send/route.ts, test/support/evolution-falsa.ts, test/api/whatsapp-send.test.ts
  mensagem de commit: "T-078 fase2c-whatsapp-conversa: Rota POST /api/whatsapp/send"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-078 fase2c-whatsapp-conversa: Rota POST /api/whatsapp/send (auto-commit do plano)'
    fi
    marcar_concluidas T-078
    verde "✔ T-078 concluída"
    return 0
  fi
  vermelho "✘ T-078 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-078"
  FALHAS="$FALHAS T-078"
  return 1
}

# ── sequencial T-079 (ordem do tasks.md) ──
executar_seq_T_079() {
  info 'sequencial T-079 — Rota GET /api/whatsapp/messages'
  if rodar_tarefa seq 'T-079' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-079 — "Rota GET /api/whatsapp/messages"
  critérios/refs: AC-147 (Sem login, o histórico é recusado), AC-148 (Histórico por número traz enviadas e recebidas em ordem), AC-149 (O número é reconhecido com DDI e com a variação do nono dígito), AC-150 (Histórico por lead reúne todos os telefones do lead), AC-151 (Histórico nunca mostra mensagens de outra empresa), AC-152 (Consulta sem número nem lead é recusada)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/messages/route.ts, test/api/whatsapp-messages.test.ts
  mensagem de commit: "T-079 fase2c-whatsapp-conversa: Rota GET /api/whatsapp/messages"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-079 fase2c-whatsapp-conversa: Rota GET /api/whatsapp/messages (auto-commit do plano)'
    fi
    marcar_concluidas T-079
    verde "✔ T-079 concluída"
    return 0
  fi
  vermelho "✘ T-079 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-079"
  FALHAS="$FALHAS T-079"
  return 1
}

# ── sequencial T-080 (ordem do tasks.md) ──
executar_seq_T_080() {
  info 'sequencial T-080 — Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas'
  if rodar_tarefa seq 'T-080' 'Você executa UMA tarefa da feature "fase2c-whatsapp-conversa" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase2c-whatsapp-conversa/spec.md, .spec/features/fase2c-whatsapp-conversa/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-080 — "Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas"
  critérios/refs: AC-153 (Mensagens antigas não viram "não lidas" na virada), AC-154 (Não lidas lista só recebidas ainda não lidas, por conversa), AC-155 (Telefones diferentes do mesmo lead contam como uma conversa só), AC-156 (Sem login, não lidas e marcar como lida são recusados), AC-157 (Abrir a conversa marca as recebidas como lidas), AC-158 (Marcar como lida é idempotente e nunca toca em outra conversa nem em outra empresa), AC-159 (Mensagem nova depois de lida volta a contar)
  arquivos permitidos (e seus testes): src/app/api/whatsapp/unread/route.ts, src/app/api/whatsapp/lidas/route.ts, test/api/whatsapp-nao-lidas.test.ts
  mensagem de commit: "T-080 fase2c-whatsapp-conversa: Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-080 fase2c-whatsapp-conversa: Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas (auto-commit do plano)'
    fi
    marcar_concluidas T-080
    verde "✔ T-080 concluída"
    return 0
  fi
  vermelho "✘ T-080 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --seq T-080"
  FALHAS="$FALHAS T-080"
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
      amarelo "  para o veredito: bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh --gate"
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
  executar_seq_T_071 || true
  executar_seq_T_072 || true
  executar_seq_T_073 || true
  executar_seq_T_074 || true
  executar_seq_T_075 || true
  executar_seq_T_076 || true
  executar_seq_T_077 || true
  executar_seq_T_078 || true
  executar_seq_T_079 || true
  executar_seq_T_080 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-071 (sequencial)"
  echo "  seq       T-072 (sequencial)"
  echo "  seq       T-073 (sequencial)"
  echo "  seq       T-074 (sequencial)"
  echo "  seq       T-075 (sequencial)"
  echo "  seq       T-076 (sequencial)"
  echo "  seq       T-077 (sequencial)"
  echo "  seq       T-078 (sequencial)"
  echo "  seq       T-079 (sequencial)"
  echo "  seq       T-080 (sequencial)"
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
      T-071) evento --tipo inicio --escopo "seq:T-071"; iniciar_resumos; executar_seq_T_071 || true; encerrar "seq:T-071" ;;
      T-072) evento --tipo inicio --escopo "seq:T-072"; iniciar_resumos; executar_seq_T_072 || true; encerrar "seq:T-072" ;;
      T-073) evento --tipo inicio --escopo "seq:T-073"; iniciar_resumos; executar_seq_T_073 || true; encerrar "seq:T-073" ;;
      T-074) evento --tipo inicio --escopo "seq:T-074"; iniciar_resumos; executar_seq_T_074 || true; encerrar "seq:T-074" ;;
      T-075) evento --tipo inicio --escopo "seq:T-075"; iniciar_resumos; executar_seq_T_075 || true; encerrar "seq:T-075" ;;
      T-076) evento --tipo inicio --escopo "seq:T-076"; iniciar_resumos; executar_seq_T_076 || true; encerrar "seq:T-076" ;;
      T-077) evento --tipo inicio --escopo "seq:T-077"; iniciar_resumos; executar_seq_T_077 || true; encerrar "seq:T-077" ;;
      T-078) evento --tipo inicio --escopo "seq:T-078"; iniciar_resumos; executar_seq_T_078 || true; encerrar "seq:T-078" ;;
      T-079) evento --tipo inicio --escopo "seq:T-079"; iniciar_resumos; executar_seq_T_079 || true; encerrar "seq:T-079" ;;
      T-080) evento --tipo inicio --escopo "seq:T-080"; iniciar_resumos; executar_seq_T_080 || true; encerrar "seq:T-080" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
