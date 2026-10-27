# Plano de execução — fase4-pipeline-telas

> gerado por `onp-spec plano` em 2026-10-26 18:56 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase4-pipeline-telas --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 4 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal (8 já concluída(s): T-154, T-155, T-156, T-157, T-158, T-159, T-161, T-162)
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase4-pipeline-telas`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-165 | Criar lead e card em um passo (valor e responsável) | `claude-sonnet-5` | high |
| T-160 | Tela do funil (Kanban) com indicadores, filtros e novo lead | `claude-sonnet-5` | xhigh |
| T-163 | Tela de detalhe do card | `claude-sonnet-5` | xhigh |
| T-164 | Permissões das novas rotas, menu e retirada da tela antiga | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase4-pipeline-telas` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase4-pipeline-telas` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase4-pipeline-telas/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase4-pipeline-telas-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase4-pipeline-telas --tabela   # a tabela de andamento
onp-spec resumo fase4-pipeline-telas            # o resumo em texto
```

