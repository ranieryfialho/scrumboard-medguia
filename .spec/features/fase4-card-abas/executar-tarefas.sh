#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase4-card-abas` em 2026-10-27 17:27
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase4-card-abas
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase4-card-abas-mvqykc8v'
FEATURE='fase4-card-abas'
BASE_BRANCH='spec/fase4-card-abas'
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
  git ls-files --error-unmatch -- '.spec/features/fase4-card-abas/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-card-abas-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-card-abas"
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
    amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-168 (ordem do tasks.md) ──
executar_seq_T_168() {
  info 'sequencial T-168 — Nome original do anexo: migration 0013 e upload'
  if rodar_tarefa seq 'T-168' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-168 — "Nome original do anexo: migration 0013 e upload"
  critérios/refs: AC-428 (O nome original do arquivo é guardado e mostrado)
  arquivos permitidos (e seus testes): drizzle/0013_anexos_nome.sql, src/db/schema/pipeline.ts, src/lib/anexos/nome.ts, src/repositories/anexos.ts, src/app/api/anexos/route.ts, test/api/anexos-nome.test.ts
  mensagem de commit: "T-168 fase4-card-abas: Nome original do anexo: migration 0013 e upload"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-168 fase4-card-abas: Nome original do anexo: migration 0013 e upload (auto-commit do plano)'
    fi
    marcar_concluidas T-168
    verde "✔ T-168 concluída"
    return 0
  fi
  vermelho "✘ T-168 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-168"
  FALHAS="$FALHAS T-168"
  return 1
}

# ── sequencial T-169 (ordem do tasks.md) ──
executar_seq_T_169() {
  info 'sequencial T-169 — Listagem dos anexos do card (servidor)'
  if rodar_tarefa seq 'T-169' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-169 — "Listagem dos anexos do card (servidor)"
  critérios/refs: AC-423 (O servidor lista os anexos do card, só os da empresa da sessão), AC-424 (Cada anexo mostra o que o protótipo mostra, e só o que existe)
  arquivos permitidos (e seus testes): src/repositories/anexos-lista.ts, src/app/api/oportunidades/[id]/anexos/route.ts, test/api/oportunidade-anexos-lista.test.ts
  mensagem de commit: "T-169 fase4-card-abas: Listagem dos anexos do card (servidor)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-169 fase4-card-abas: Listagem dos anexos do card (servidor) (auto-commit do plano)'
    fi
    marcar_concluidas T-169
    verde "✔ T-169 concluída"
    return 0
  fi
  vermelho "✘ T-169 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-169"
  FALHAS="$FALHAS T-169"
  return 1
}

# ── sequencial T-170 (ordem do tasks.md) ──
executar_seq_T_170() {
  info 'sequencial T-170 — Listagem da cadência do card (servidor)'
  if rodar_tarefa seq 'T-170' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-170 — "Listagem da cadência do card (servidor)"
  critérios/refs: AC-430 (O servidor lista os toques da cadência do card), AC-431 (O resumo do topo mostra progresso, toque da vez, respostas e situação da régua)
  arquivos permitidos (e seus testes): src/repositories/cadencia-card.ts, src/app/api/oportunidades/[id]/cadencia/route.ts, test/api/oportunidade-cadencia-lista.test.ts
  mensagem de commit: "T-170 fase4-card-abas: Listagem da cadência do card (servidor)"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-170 fase4-card-abas: Listagem da cadência do card (servidor) (auto-commit do plano)'
    fi
    marcar_concluidas T-170
    verde "✔ T-170 concluída"
    return 0
  fi
  vermelho "✘ T-170 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-170"
  FALHAS="$FALHAS T-170"
  return 1
}

# ── sequencial T-171 (ordem do tasks.md) ──
executar_seq_T_171() {
  info 'sequencial T-171 — Molde do card: cabeçalho e abas compartilhados'
  if rodar_tarefa seq 'T-171' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-171 — "Molde do card: cabeçalho e abas compartilhados"
  critérios/refs: AC-419 (As quatro abas levam a páginas que existem, e a ativa fica marcada), AC-420 (O cabeçalho do card é o mesmo nas quatro telas), AC-421 (Card de outra empresa ou inexistente mostra "não encontrado" nas três telas novas), AC-422 (Cada tela tem estado de carregamento, vazio e erro)
  arquivos permitidos (e seus testes): src/components/pipeline/card/molde-do-card.tsx, src/components/pipeline/card/abas-do-card.tsx, src/components/pipeline/card/cabecalho-do-card.tsx, src/app/(app)/pipeline/[id]/page.tsx, test/components/pipeline/molde-do-card.test.tsx
  mensagem de commit: "T-171 fase4-card-abas: Molde do card: cabeçalho e abas compartilhados"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-171 fase4-card-abas: Molde do card: cabeçalho e abas compartilhados (auto-commit do plano)'
    fi
    marcar_concluidas T-171
    verde "✔ T-171 concluída"
    return 0
  fi
  vermelho "✘ T-171 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-171"
  FALHAS="$FALHAS T-171"
  return 1
}

# ── sequencial T-172 (ordem do tasks.md) ──
executar_seq_T_172() {
  info 'sequencial T-172 — Tela de anexos e evidências'
  if rodar_tarefa seq 'T-172' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-172 — "Tela de anexos e evidências"
  critérios/refs: AC-422 (Cada tela tem estado de carregamento, vazio e erro), AC-424 (Cada anexo mostra o que o protótipo mostra, e só o que existe), AC-425 (Busca e filtros por tipo restringem a lista), AC-426 ("Link Seguro" abre o anexo por link de curta duração), AC-427 (O envio de arquivo aceita arrastar ou escolher e mostra o resultado), AC-428 (O nome original do arquivo é guardado e mostrado), AC-429 (Ações do protótipo sem backend aparecem como "em breve")
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/[id]/anexos/page.tsx, src/components/pipeline/anexos/lista-anexos.tsx, src/components/pipeline/anexos/filtros-anexos.tsx, src/components/pipeline/anexos/envio-anexos.tsx, test/components/pipeline/anexos-tela.test.tsx
  mensagem de commit: "T-172 fase4-card-abas: Tela de anexos e evidências"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-172 fase4-card-abas: Tela de anexos e evidências (auto-commit do plano)'
    fi
    marcar_concluidas T-172
    verde "✔ T-172 concluída"
    return 0
  fi
  vermelho "✘ T-172 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-172"
  FALHAS="$FALHAS T-172"
  return 1
}

# ── sequencial T-173 (ordem do tasks.md) ──
executar_seq_T_173() {
  info 'sequencial T-173 — Tela da cadência de 18 toques'
  if rodar_tarefa seq 'T-173' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-173 — "Tela da cadência de 18 toques"
  critérios/refs: AC-422 (Cada tela tem estado de carregamento, vazio e erro), AC-431 (O resumo do topo mostra progresso, toque da vez, respostas e situação da régua), AC-432 (A matriz mostra os 18 toques por dia e turno com o estado de cada um), AC-433 (Sem cadência iniciada, a tela mostra o caminho para iniciar), AC-434 (Concluir o toque da vez pela tela, com as regras da cadência), AC-435 (O histórico lista os toques já feitos, com atalho para a conversa), AC-436 (Ações e blocos da cadência sem backend)
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/[id]/cadencia/page.tsx, src/components/pipeline/cadencia/resumo-cadencia.tsx, src/components/pipeline/cadencia/toque-da-vez.tsx, src/components/pipeline/cadencia/matriz-toques.tsx, src/components/pipeline/cadencia/historico-toques.tsx, test/components/pipeline/cadencia-tela.test.tsx
  mensagem de commit: "T-173 fase4-card-abas: Tela da cadência de 18 toques"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-173 fase4-card-abas: Tela da cadência de 18 toques (auto-commit do plano)'
    fi
    marcar_concluidas T-173
    verde "✔ T-173 concluída"
    return 0
  fi
  vermelho "✘ T-173 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-173"
  FALHAS="$FALHAS T-173"
  return 1
}

# ── sequencial T-174 (ordem do tasks.md) ──
executar_seq_T_174() {
  info 'sequencial T-174 — Tela da conversa de WhatsApp do lead'
  if rodar_tarefa seq 'T-174' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-174 — "Tela da conversa de WhatsApp do lead"
  critérios/refs: AC-422 (Cada tela tem estado de carregamento, vazio e erro), AC-437 (A conversa do lead aparece com o histórico completo), AC-438 (O seletor de telefone troca a conversa), AC-439 (Enviar uma mensagem pelo campo da conversa), AC-440 (Abrir a conversa marca as mensagens recebidas como lidas), AC-441 (A conexão do WhatsApp aparece no topo da conversa), AC-442 (Mensagem nova do lead aparece sem recarregar), AC-443 (O painel lateral mostra a cadência e as anotações internas do card), AC-444 (Ações da conversa sem backend)
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/[id]/conversa/page.tsx, src/components/pipeline/conversa/conversa-lead.tsx, src/components/pipeline/conversa/seletor-telefone.tsx, src/components/pipeline/conversa/faixa-conexao.tsx, src/components/pipeline/conversa/painel-lateral.tsx, test/components/pipeline/conversa-tela.test.tsx
  mensagem de commit: "T-174 fase4-card-abas: Tela da conversa de WhatsApp do lead"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-174 fase4-card-abas: Tela da conversa de WhatsApp do lead (auto-commit do plano)'
    fi
    marcar_concluidas T-174
    verde "✔ T-174 concluída"
    return 0
  fi
  vermelho "✘ T-174 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-174"
  FALHAS="$FALHAS T-174"
  return 1
}

# ── sequencial T-175 (ordem do tasks.md) ──
executar_seq_T_175() {
  info 'sequencial T-175 — Garantia: as quatro abas existem e nenhuma dá 404'
  if rodar_tarefa seq 'T-175' 'Você executa UMA tarefa da feature "fase4-card-abas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-card-abas/spec.md, .spec/features/fase4-card-abas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-175 — "Garantia: as quatro abas existem e nenhuma dá 404"
  critérios/refs: AC-419 (As quatro abas levam a páginas que existem, e a ativa fica marcada)
  arquivos permitidos (e seus testes): test/components/pipeline/abas-sem-404.test.ts
  mensagem de commit: "T-175 fase4-card-abas: Garantia: as quatro abas existem e nenhuma dá 404"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' low >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-175 fase4-card-abas: Garantia: as quatro abas existem e nenhuma dá 404 (auto-commit do plano)'
    fi
    marcar_concluidas T-175
    verde "✔ T-175 concluída"
    return 0
  fi
  vermelho "✘ T-175 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-card-abas/executar-tarefas.sh --seq T-175"
  FALHAS="$FALHAS T-175"
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
      amarelo "  para o veredito: bash .spec/features/fase4-card-abas/executar-tarefas.sh --gate"
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
  executar_seq_T_168 || true
  executar_seq_T_169 || true
  executar_seq_T_170 || true
  executar_seq_T_171 || true
  executar_seq_T_172 || true
  executar_seq_T_173 || true
  executar_seq_T_174 || true
  executar_seq_T_175 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-168 (sequencial)"
  echo "  seq       T-169 (sequencial)"
  echo "  seq       T-170 (sequencial)"
  echo "  seq       T-171 (sequencial)"
  echo "  seq       T-172 (sequencial)"
  echo "  seq       T-173 (sequencial)"
  echo "  seq       T-174 (sequencial)"
  echo "  seq       T-175 (sequencial)"
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
      T-168) evento --tipo inicio --escopo "seq:T-168"; iniciar_resumos; executar_seq_T_168 || true; encerrar "seq:T-168" ;;
      T-169) evento --tipo inicio --escopo "seq:T-169"; iniciar_resumos; executar_seq_T_169 || true; encerrar "seq:T-169" ;;
      T-170) evento --tipo inicio --escopo "seq:T-170"; iniciar_resumos; executar_seq_T_170 || true; encerrar "seq:T-170" ;;
      T-171) evento --tipo inicio --escopo "seq:T-171"; iniciar_resumos; executar_seq_T_171 || true; encerrar "seq:T-171" ;;
      T-172) evento --tipo inicio --escopo "seq:T-172"; iniciar_resumos; executar_seq_T_172 || true; encerrar "seq:T-172" ;;
      T-173) evento --tipo inicio --escopo "seq:T-173"; iniciar_resumos; executar_seq_T_173 || true; encerrar "seq:T-173" ;;
      T-174) evento --tipo inicio --escopo "seq:T-174"; iniciar_resumos; executar_seq_T_174 || true; encerrar "seq:T-174" ;;
      T-175) evento --tipo inicio --escopo "seq:T-175"; iniciar_resumos; executar_seq_T_175 || true; encerrar "seq:T-175" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
