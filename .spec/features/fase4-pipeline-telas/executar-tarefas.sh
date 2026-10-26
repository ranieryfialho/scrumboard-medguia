#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano fase4-pipeline-telas` em 2026-10-26 14:44
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
# resumo do que está rolando, a qualquer momento: onp-spec resumo fase4-pipeline-telas
set -u
set -o pipefail

RUN_ID='scrumboard-medguia-fase4-pipeline-telas-mvpdblrf'
FEATURE='fase4-pipeline-telas'
BASE_BRANCH='spec/fase4-pipeline-telas'
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
  git ls-files --error-unmatch -- '.spec/features/fase4-pipeline-telas/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
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
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-pipeline-telas-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/scrumboard-medguia-fase4-pipeline-telas"
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
    amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --faixa $1"
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

# ── sequencial T-154 (ordem do tasks.md) ──
executar_seq_T_154() {
  info 'sequencial T-154 — Consultas do servidor: lista paginada, arquivados e indicadores'
  if rodar_tarefa seq 'T-154' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-154 — "Consultas do servidor: lista paginada, arquivados e indicadores"
  critérios/refs: AC-389 (Os indicadores do topo vêm dos dados reais), AC-395 (O servidor pagina a lista), AC-396 (O servidor filtra e ordena a lista), AC-397 (A lista nunca mostra card de outra empresa), AC-398 (A lista não traz cards arquivados), AC-402 (Os arquivados filtram e paginam no servidor), AC-403 (Os indicadores dos arquivados vêm dos dados reais)
  arquivos permitidos (e seus testes): src/repositories/pipeline-lista.ts, src/repositories/pipeline-indicadores.ts, test/repositories/pipeline-lista.test.ts
  mensagem de commit: "T-154 fase4-pipeline-telas: Consultas do servidor: lista paginada, arquivados e indicadores"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-154 fase4-pipeline-telas: Consultas do servidor: lista paginada, arquivados e indicadores (auto-commit do plano)'
    fi
    marcar_concluidas T-154
    verde "✔ T-154 concluída"
    return 0
  fi
  vermelho "✘ T-154 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-154"
  FALHAS="$FALHAS T-154"
  return 1
}

# ── sequencial T-155 (ordem do tasks.md) ──
executar_seq_T_155() {
  info 'sequencial T-155 — Rotas de leitura: lista, arquivados e indicadores'
  if rodar_tarefa seq 'T-155' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-155 — "Rotas de leitura: lista, arquivados e indicadores"
  critérios/refs: AC-389 (Os indicadores do topo vêm dos dados reais), AC-395 (O servidor pagina a lista), AC-396 (O servidor filtra e ordena a lista), AC-397 (A lista nunca mostra card de outra empresa), AC-398 (A lista não traz cards arquivados), AC-402 (Os arquivados filtram e paginam no servidor), AC-403 (Os indicadores dos arquivados vêm dos dados reais)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/lista/route.ts, src/app/api/oportunidades/arquivados/route.ts, src/app/api/pipeline/indicadores/route.ts, test/api/pipeline-leitura.test.ts
  mensagem de commit: "T-155 fase4-pipeline-telas: Rotas de leitura: lista, arquivados e indicadores"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-155 fase4-pipeline-telas: Rotas de leitura: lista, arquivados e indicadores (auto-commit do plano)'
    fi
    marcar_concluidas T-155
    verde "✔ T-155 concluída"
    return 0
  fi
  vermelho "✘ T-155 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-155"
  FALHAS="$FALHAS T-155"
  return 1
}

# ── sequencial T-156 (ordem do tasks.md) ──
executar_seq_T_156() {
  info 'sequencial T-156 — Reabrir card e registrar anotação'
  if rodar_tarefa seq 'T-156' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-156 — "Reabrir card e registrar anotação"
  critérios/refs: AC-404 ("Reabrir" volta o card ao funil respeitando as regras), AC-409 (Registrar uma anotação interna entra na linha do tempo)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/[id]/reabrir/route.ts, src/app/api/oportunidades/[id]/anotacoes/route.ts, src/repositories/anotacoes.ts, test/api/pipeline-escrita.test.ts
  mensagem de commit: "T-156 fase4-pipeline-telas: Reabrir card e registrar anotação"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-156 fase4-pipeline-telas: Reabrir card e registrar anotação (auto-commit do plano)'
    fi
    marcar_concluidas T-156
    verde "✔ T-156 concluída"
    return 0
  fi
  vermelho "✘ T-156 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-156"
  FALHAS="$FALHAS T-156"
  return 1
}

# ── sequencial T-157 (ordem do tasks.md) ──
executar_seq_T_157() {
  info 'sequencial T-157 — Linha do tempo do card'
  if rodar_tarefa seq 'T-157' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-157 — "Linha do tempo do card"
  critérios/refs: AC-407 (O detalhe mostra só os dados que o sistema tem), AC-408 (A linha do tempo mostra o histórico real do card)
  arquivos permitidos (e seus testes): src/app/api/oportunidades/[id]/linha-do-tempo/route.ts, src/repositories/linha-do-tempo.ts, test/api/pipeline-linha-do-tempo.test.ts
  mensagem de commit: "T-157 fase4-pipeline-telas: Linha do tempo do card"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-157 fase4-pipeline-telas: Linha do tempo do card (auto-commit do plano)'
    fi
    marcar_concluidas T-157
    verde "✔ T-157 concluída"
    return 0
  fi
  vermelho "✘ T-157 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-157"
  FALHAS="$FALHAS T-157"
  return 1
}

# ── sequencial T-158 (ordem do tasks.md) ──
executar_seq_T_158() {
  info 'sequencial T-158 — Peças de tela compartilhadas e estados'
  if rodar_tarefa seq 'T-158' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-158 — "Peças de tela compartilhadas e estados"
  critérios/refs: AC-393 (Itens do funil sem backend aparecem como "em breve"), AC-405 (Os blocos de análise sem backend aparecem como "em breve"), AC-413 (Cada tela tem estado de carregamento, vazio e erro)
  arquivos permitidos (e seus testes): src/components/pipeline/pecas/cartao-indicador.tsx, src/components/pipeline/pecas/paginacao.tsx, src/components/pipeline/pecas/selo-etapa.tsx, src/components/pipeline/pecas/selo-em-breve.tsx, src/components/pipeline/pecas/estados.tsx, test/components/pipeline/pecas.test.tsx
  mensagem de commit: "T-158 fase4-pipeline-telas: Peças de tela compartilhadas e estados"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-158 fase4-pipeline-telas: Peças de tela compartilhadas e estados (auto-commit do plano)'
    fi
    marcar_concluidas T-158
    verde "✔ T-158 concluída"
    return 0
  fi
  vermelho "✘ T-158 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-158"
  FALHAS="$FALHAS T-158"
  return 1
}

# ── sequencial T-159 (ordem do tasks.md) ──
executar_seq_T_159() {
  info 'sequencial T-159 — Tempo real nas telas do pipeline'
  if rodar_tarefa seq 'T-159' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-159 — "Tempo real nas telas do pipeline"
  critérios/refs: AC-416 (Funil, lista e arquivados se atualizam quando outro usuário mexe num card)
  arquivos permitidos (e seus testes): src/hooks/use-stream-oportunidades.ts, src/components/pipeline/pecas/aviso-tempo-real.tsx, test/components/pipeline/tempo-real.test.tsx
  mensagem de commit: "T-159 fase4-pipeline-telas: Tempo real nas telas do pipeline"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-159 fase4-pipeline-telas: Tempo real nas telas do pipeline (auto-commit do plano)'
    fi
    marcar_concluidas T-159
    verde "✔ T-159 concluída"
    return 0
  fi
  vermelho "✘ T-159 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-159"
  FALHAS="$FALHAS T-159"
  return 1
}

# ── sequencial T-160 (ordem do tasks.md) ──
executar_seq_T_160() {
  info 'sequencial T-160 — Tela do funil (Kanban) com indicadores, filtros e novo lead'
  if rodar_tarefa seq 'T-160' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-160 — "Tela do funil (Kanban) com indicadores, filtros e novo lead"
  critérios/refs: AC-387 (O funil aparece dentro da casca, só para quem tem acesso), AC-388 (Cada coluna e cada card mostram o que o protótipo mostra), AC-390 (Os filtros do funil restringem o quadro), AC-391 (O modal "Novo Lead" cria o card na entrada), AC-392 ("Salvar e iniciar cadência" cria o card e já inicia a cadência), AC-393 (Itens do funil sem backend aparecem como "em breve")
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/page.tsx, src/components/pipeline/board-kanban.tsx, src/components/pipeline/coluna-etapa.tsx, src/components/pipeline/card-oportunidade.tsx, src/components/pipeline/filtros-funil.tsx, src/components/pipeline/modal-novo-lead.tsx, src/components/pipeline/indicadores-funil.tsx, test/components/pipeline/funil.test.tsx, test/components/pipeline/modal-novo-lead.test.tsx
  mensagem de commit: "T-160 fase4-pipeline-telas: Tela do funil (Kanban) com indicadores, filtros e novo lead"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-160 fase4-pipeline-telas: Tela do funil (Kanban) com indicadores, filtros e novo lead (auto-commit do plano)'
    fi
    marcar_concluidas T-160
    verde "✔ T-160 concluída"
    return 0
  fi
  vermelho "✘ T-160 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-160"
  FALHAS="$FALHAS T-160"
  return 1
}

# ── sequencial T-161 (ordem do tasks.md) ──
executar_seq_T_161() {
  info 'sequencial T-161 — Tela da lista'
  if rodar_tarefa seq 'T-161' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-161 — "Tela da lista"
  critérios/refs: AC-394 (A lista aparece dentro da casca, em `/pipeline/lista`), AC-395 (O servidor pagina a lista), AC-396 (O servidor filtra e ordena a lista), AC-399 (Cada linha leva ao card e a seleção marca linhas)
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/lista/page.tsx, src/components/pipeline/tabela-lista.tsx, src/components/pipeline/filtros-lista.tsx, test/components/pipeline/lista.test.tsx
  mensagem de commit: "T-161 fase4-pipeline-telas: Tela da lista"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-161 fase4-pipeline-telas: Tela da lista (auto-commit do plano)'
    fi
    marcar_concluidas T-161
    verde "✔ T-161 concluída"
    return 0
  fi
  vermelho "✘ T-161 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-161"
  FALHAS="$FALHAS T-161"
  return 1
}

# ── sequencial T-162 (ordem do tasks.md) ──
executar_seq_T_162() {
  info 'sequencial T-162 — Tela dos arquivados'
  if rodar_tarefa seq 'T-162' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-162 — "Tela dos arquivados"
  critérios/refs: AC-400 (Os arquivados aparecem em `/pipeline/arquivados` com as três abas), AC-401 (Cada linha traz status, responsável, motivo e data de fechamento), AC-403 (Os indicadores dos arquivados vêm dos dados reais), AC-404 ("Reabrir" volta o card ao funil respeitando as regras), AC-405 (Os blocos de análise sem backend aparecem como "em breve")
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/arquivados/page.tsx, src/components/pipeline/tabela-arquivados.tsx, src/components/pipeline/distribuicao-motivos.tsx, src/components/pipeline/botao-reabrir.tsx, test/components/pipeline/arquivados.test.tsx
  mensagem de commit: "T-162 fase4-pipeline-telas: Tela dos arquivados"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-162 fase4-pipeline-telas: Tela dos arquivados (auto-commit do plano)'
    fi
    marcar_concluidas T-162
    verde "✔ T-162 concluída"
    return 0
  fi
  vermelho "✘ T-162 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-162"
  FALHAS="$FALHAS T-162"
  return 1
}

# ── sequencial T-163 (ordem do tasks.md) ──
executar_seq_T_163() {
  info 'sequencial T-163 — Tela de detalhe do card'
  if rodar_tarefa seq 'T-163' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-163 — "Tela de detalhe do card"
  critérios/refs: AC-406 (O detalhe mostra cabeçalho, etapa e jornada), AC-407 (O detalhe mostra só os dados que o sistema tem), AC-408 (A linha do tempo mostra o histórico real do card), AC-409 (Registrar uma anotação interna entra na linha do tempo), AC-410 (As ações de mover, ganho e perdido respeitam as regras do pipeline), AC-411 (O detalhe leva às abas das telas irmãs), AC-412 (Card de outra empresa ou inexistente mostra "não encontrado")
  arquivos permitidos (e seus testes): src/app/(app)/pipeline/[id]/page.tsx, src/components/pipeline/detalhe/cabecalho-card.tsx, src/components/pipeline/detalhe/jornada.tsx, src/components/pipeline/detalhe/informacoes.tsx, src/components/pipeline/detalhe/linha-do-tempo.tsx, src/components/pipeline/detalhe/registro-rapido.tsx, test/components/pipeline/detalhe.test.tsx
  mensagem de commit: "T-163 fase4-pipeline-telas: Tela de detalhe do card"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-163 fase4-pipeline-telas: Tela de detalhe do card (auto-commit do plano)'
    fi
    marcar_concluidas T-163
    verde "✔ T-163 concluída"
    return 0
  fi
  vermelho "✘ T-163 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-163"
  FALHAS="$FALHAS T-163"
  return 1
}

# ── sequencial T-164 (ordem do tasks.md) ──
executar_seq_T_164() {
  info 'sequencial T-164 — Permissões das novas rotas, menu e retirada da tela antiga'
  if rodar_tarefa seq 'T-164' 'Você executa UMA tarefa da feature "fase4-pipeline-telas" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/fase4-pipeline-telas/spec.md, .spec/features/fase4-pipeline-telas/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-164 — "Permissões das novas rotas, menu e retirada da tela antiga"
  critérios/refs: AC-414 (Quem não tem permissão vai para a tela de sem acesso), AC-415 (A tela legada de pipeline sai de cena), AC-387 (O funil aparece dentro da casca, só para quem tem acesso)
  arquivos permitidos (e seus testes): src/lib/auth/rotas.ts, src/components/shell/menu-config.ts, test/auth/rotas-pipeline.test.ts
  mensagem de commit: "T-164 fase4-pipeline-telas: Permissões das novas rotas, menu e retirada da tela antiga"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/raw.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'claude-sonnet-5' medium >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-164 fase4-pipeline-telas: Permissões das novas rotas, menu e retirada da tela antiga (auto-commit do plano)'
    fi
    marcar_concluidas T-164
    verde "✔ T-164 concluída"
    return 0
  fi
  vermelho "✘ T-164 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --seq T-164"
  FALHAS="$FALHAS T-164"
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
      amarelo "  para o veredito: bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh --gate"
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
  executar_seq_T_154 || true
  executar_seq_T_155 || true
  executar_seq_T_156 || true
  executar_seq_T_157 || true
  executar_seq_T_158 || true
  executar_seq_T_159 || true
  executar_seq_T_160 || true
  executar_seq_T_161 || true
  executar_seq_T_162 || true
  executar_seq_T_163 || true
  executar_seq_T_164 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-154 (sequencial)"
  echo "  seq       T-155 (sequencial)"
  echo "  seq       T-156 (sequencial)"
  echo "  seq       T-157 (sequencial)"
  echo "  seq       T-158 (sequencial)"
  echo "  seq       T-159 (sequencial)"
  echo "  seq       T-160 (sequencial)"
  echo "  seq       T-161 (sequencial)"
  echo "  seq       T-162 (sequencial)"
  echo "  seq       T-163 (sequencial)"
  echo "  seq       T-164 (sequencial)"
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
      T-154) evento --tipo inicio --escopo "seq:T-154"; iniciar_resumos; executar_seq_T_154 || true; encerrar "seq:T-154" ;;
      T-155) evento --tipo inicio --escopo "seq:T-155"; iniciar_resumos; executar_seq_T_155 || true; encerrar "seq:T-155" ;;
      T-156) evento --tipo inicio --escopo "seq:T-156"; iniciar_resumos; executar_seq_T_156 || true; encerrar "seq:T-156" ;;
      T-157) evento --tipo inicio --escopo "seq:T-157"; iniciar_resumos; executar_seq_T_157 || true; encerrar "seq:T-157" ;;
      T-158) evento --tipo inicio --escopo "seq:T-158"; iniciar_resumos; executar_seq_T_158 || true; encerrar "seq:T-158" ;;
      T-159) evento --tipo inicio --escopo "seq:T-159"; iniciar_resumos; executar_seq_T_159 || true; encerrar "seq:T-159" ;;
      T-160) evento --tipo inicio --escopo "seq:T-160"; iniciar_resumos; executar_seq_T_160 || true; encerrar "seq:T-160" ;;
      T-161) evento --tipo inicio --escopo "seq:T-161"; iniciar_resumos; executar_seq_T_161 || true; encerrar "seq:T-161" ;;
      T-162) evento --tipo inicio --escopo "seq:T-162"; iniciar_resumos; executar_seq_T_162 || true; encerrar "seq:T-162" ;;
      T-163) evento --tipo inicio --escopo "seq:T-163"; iniciar_resumos; executar_seq_T_163 || true; encerrar "seq:T-163" ;;
      T-164) evento --tipo inicio --escopo "seq:T-164"; iniciar_resumos; executar_seq_T_164 || true; encerrar "seq:T-164" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
