# Plano de execução — fase2b-cadencia

> gerado por `onp-spec plano` em 2026-10-14 17:20 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2b-cadencia --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 6 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2b-cadencia`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-088 | Domínio puro: matriz, turnos e feriados | `claude-sonnet-5` | medium |
| T-089 | Migration 0011: funções SQL da cadência | `claude-sonnet-5` | xhigh |
| T-090 | Repositório de cadência | `claude-sonnet-5` | high |
| T-091 | Rota POST /api/oportunidades/:id/cadencia/iniciar | `claude-sonnet-5` | medium |
| T-092 | Rotas GET /api/atividades e POST /api/atividades/:id/concluir | `claude-sonnet-5` | high |
| T-093 | Job diário: rota interna de virada de dia | `claude-sonnet-5` | high |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2b-cadencia` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2b-cadencia` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2b-cadencia/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2b-cadencia-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2b-cadencia --tabela   # a tabela de andamento
onp-spec resumo fase2b-cadencia            # o resumo em texto
```

