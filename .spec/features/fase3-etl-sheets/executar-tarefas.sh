#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase3-etl-sheets` em 2026-10-19 18:08
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase3-etl-sheets
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase3-etl-sheets-mvfkiq4x'
FEATURE='fase3-etl-sheets'
BASE_BRANCH='spec/fase3-etl-sheets'
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
  git ls-files --error-unmatch -- '.spec/features/fase3-etl-sheets/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase3-etl-sheets-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase3-etl-sheets"
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
    amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-114 (ordem do tasks.md) ──
executar_seq_T_114() {
  info 'sequencial T-114 — Leitor das abas (somente leitura) e mapeamento de colunas por aba'
  if rodar_tarefa seq 'T-114' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-114 — "Leitor das abas (somente leitura) e mapeamento de colunas por aba"
  critérios/refs: AC-273 (Cada aba é lida com as colunas dela), AC-274 (Lead de teste e linha em branco são ignorados e contados), AC-291 (As planilhas nunca são alteradas)
  arquivos permitidos (e seus testes): src/etl/sheets/leitor.ts, test/etl/sheets-leitor.test.ts
  mensagem de commit: "T-114 fase3-etl-sheets: Leitor das abas (somente leitura) e mapeamento de colunas por aba"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-114 fase3-etl-sheets: Leitor das abas (somente leitura) e mapeamento de colunas por aba (auto-commit do plano)'
    fi
    marcar_concluidas T-114
    verde "✔ T-114 concluída"
    return 0
  fi
  vermelho "✘ T-114 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-114"
  FALHAS="$FALHAS T-114"
  return 1
}

# ── sequencial T-115 (ordem do tasks.md) ──
executar_seq_T_115() {
  info 'sequencial T-115 — Normalização de telefone e datas'
  if rodar_tarefa seq 'T-115' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-115 — "Normalização de telefone e datas"
  critérios/refs: AC-277 (Telefones viram o formato internacional), AC-278 (Datas ficam no instante correto)
  arquivos permitidos (e seus testes): src/etl/sheets/normalizar.ts, test/etl/sheets-normalizar.test.ts
  mensagem de commit: "T-115 fase3-etl-sheets: Normalização de telefone e datas"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-115 fase3-etl-sheets: Normalização de telefone e datas (auto-commit do plano)'
    fi
    marcar_concluidas T-115
    verde "✔ T-115 concluída"
    return 0
  fi
  vermelho "✘ T-115 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-115"
  FALHAS="$FALHAS T-115"
  return 1
}

# ── sequencial T-116 (ordem do tasks.md) ──
executar_seq_T_116() {
  info 'sequencial T-116 — Deduplicação entre abas e resolução de conflito'
  if rodar_tarefa seq 'T-116' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-116 — "Deduplicação entre abas e resolução de conflito"
  critérios/refs: AC-275 (O mesmo lead em várias abas vira um só), AC-276 (Status diferentes para o mesmo lead: vence a alteração mais recente)
  arquivos permitidos (e seus testes): src/etl/sheets/dedupe.ts, test/etl/sheets-dedupe.test.ts
  mensagem de commit: "T-116 fase3-etl-sheets: Deduplicação entre abas e resolução de conflito"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-116 fase3-etl-sheets: Deduplicação entre abas e resolução de conflito (auto-commit do plano)'
    fi
    marcar_concluidas T-116
    verde "✔ T-116 concluída"
    return 0
  fi
  vermelho "✘ T-116 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-116"
  FALHAS="$FALHAS T-116"
  return 1
}

# ── sequencial T-117 (ordem do tasks.md) ──
executar_seq_T_117() {
  info 'sequencial T-117 — Mapa de status para etapa e motivo de perda'
  if rodar_tarefa seq 'T-117' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-117 — "Mapa de status para etapa e motivo de perda"
  critérios/refs: AC-279 (Novos leads e reuniões agendadas vão para as etapas equivalentes), AC-280 (Fechado vira Contrato (Ganho) com a data de fechamento), AC-281 (Perdidos recebem o motivo certo), AC-282 (Status que exige próxima ação, sem data, vai para revisão), AC-283 (Status desconhecido nunca vira "Novo lead" em silêncio)
  arquivos permitidos (e seus testes): src/etl/sheets/status.ts, test/etl/sheets-status.test.ts
  mensagem de commit: "T-117 fase3-etl-sheets: Mapa de status para etapa e motivo de perda"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-117 fase3-etl-sheets: Mapa de status para etapa e motivo de perda (auto-commit do plano)'
    fi
    marcar_concluidas T-117
    verde "✔ T-117 concluída"
    return 0
  fi
  vermelho "✘ T-117 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-117"
  FALHAS="$FALHAS T-117"
  return 1
}

# ── sequencial T-118 (ordem do tasks.md) ──
executar_seq_T_118() {
  info 'sequencial T-118 — Importar leads, cards, origem e eventos `migrado_de`'
  if rodar_tarefa seq 'T-118' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-118 — "Importar leads, cards, origem e eventos `migrado_de`"
  critérios/refs: AC-284 (Respostas do formulário e observações ficam no lead), AC-285 (O card sabe de qual planilha veio), AC-293 (Tudo fica na empresa dona das planilhas)
  arquivos permitidos (e seus testes): src/etl/sheets/leads.ts, test/etl/sheets-leads.test.ts
  mensagem de commit: "T-118 fase3-etl-sheets: Importar leads, cards, origem e eventos `migrado_de`"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-118 fase3-etl-sheets: Importar leads, cards, origem e eventos `migrado_de` (auto-commit do plano)'
    fi
    marcar_concluidas T-118
    verde "✔ T-118 concluída"
    return 0
  fi
  vermelho "✘ T-118 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-118"
  FALHAS="$FALHAS T-118"
  return 1
}

# ── sequencial T-119 (ordem do tasks.md) ──
executar_seq_T_119() {
  info 'sequencial T-119 — Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone'
  if rodar_tarefa seq 'T-119' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-119 — "Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone"
  critérios/refs: AC-286 (A Agenda sai em CSV e nada é criado), AC-287 (Mensagem sem lead é ligada pelo telefone), AC-288 (Telefone ambíguo ou sem lead fica sem vínculo e é reportado)
  arquivos permitidos (e seus testes): src/etl/sheets/agenda-mensagens.ts, test/etl/sheets-agenda-mensagens.test.ts
  mensagem de commit: "T-119 fase3-etl-sheets: Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-119 fase3-etl-sheets: Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone (auto-commit do plano)'
    fi
    marcar_concluidas T-119
    verde "✔ T-119 concluída"
    return 0
  fi
  vermelho "✘ T-119 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-119"
  FALHAS="$FALHAS T-119"
  return 1
}

# ── sequencial T-120 (ordem do tasks.md) ──
executar_seq_T_120() {
  info 'sequencial T-120 — Orquestrador do ETL do Sheets com simulação e relatório'
  if rodar_tarefa seq 'T-120' 'Você executa UMA tarefa da feature "fase3-etl-sheets" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase3-etl-sheets/spec.md, .spec/features/fase3-etl-sheets/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-120 — "Orquestrador do ETL do Sheets com simulação e relatório"
  critérios/refs: AC-289 (Rodar de novo não duplica nada), AC-290 (A simulação não grava nada), AC-292 (O relatório confere as contagens com as planilhas)
  arquivos permitidos (e seus testes): src/etl/sheets/executar.ts, scripts/etl-sheets.ts, test/etl/sheets-executar.test.ts
  mensagem de commit: "T-120 fase3-etl-sheets: Orquestrador do ETL do Sheets com simulação e relatório"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-120 fase3-etl-sheets: Orquestrador do ETL do Sheets com simulação e relatório (auto-commit do plano)'
    fi
    marcar_concluidas T-120
    verde "✔ T-120 concluída"
    return 0
  fi
  vermelho "✘ T-120 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --seq T-120"
  FALHAS="$FALHAS T-120"
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
      amarelo "  para o veredito: bash .spec/features/fase3-etl-sheets/executar-tarefas.sh --gate"
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
  executar_seq_T_114 || true
  executar_seq_T_115 || true
  executar_seq_T_116 || true
  executar_seq_T_117 || true
  executar_seq_T_118 || true
  executar_seq_T_119 || true
  executar_seq_T_120 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-114 (sequencial)"
  echo "  seq       T-115 (sequencial)"
  echo "  seq       T-116 (sequencial)"
  echo "  seq       T-117 (sequencial)"
  echo "  seq       T-118 (sequencial)"
  echo "  seq       T-119 (sequencial)"
  echo "  seq       T-120 (sequencial)"
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
      T-114) evento --tipo inicio --escopo "seq:T-114"; iniciar_resumos; executar_seq_T_114 || true; encerrar "seq:T-114" ;;
      T-115) evento --tipo inicio --escopo "seq:T-115"; iniciar_resumos; executar_seq_T_115 || true; encerrar "seq:T-115" ;;
      T-116) evento --tipo inicio --escopo "seq:T-116"; iniciar_resumos; executar_seq_T_116 || true; encerrar "seq:T-116" ;;
      T-117) evento --tipo inicio --escopo "seq:T-117"; iniciar_resumos; executar_seq_T_117 || true; encerrar "seq:T-117" ;;
      T-118) evento --tipo inicio --escopo "seq:T-118"; iniciar_resumos; executar_seq_T_118 || true; encerrar "seq:T-118" ;;
      T-119) evento --tipo inicio --escopo "seq:T-119"; iniciar_resumos; executar_seq_T_119 || true; encerrar "seq:T-119" ;;
      T-120) evento --tipo inicio --escopo "seq:T-120"; iniciar_resumos; executar_seq_T_120 || true; encerrar "seq:T-120" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
