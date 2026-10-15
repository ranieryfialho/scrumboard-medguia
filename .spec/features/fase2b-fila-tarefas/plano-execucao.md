# Plano de execução — fase2b-fila-tarefas

> gerado por `onp-spec plano` em 2026-10-15 18:23 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2b-fila-tarefas --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 3 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal (4 já concluída(s): T-094, T-095, T-096, T-097)
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2b-fila-tarefas`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-098 | Botões de conclusão do toque | `claude-sonnet-5` | high |
| T-099 | Botão "Iniciar cadência" no card e no detalhe | `claude-sonnet-5` | medium |
| T-100 | Selo "Atrasado" no card do board | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2b-fila-tarefas` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2b-fila-tarefas` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2b-fila-tarefas/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2b-fila-tarefas-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2b-fila-tarefas --tabela   # a tabela de andamento
onp-spec resumo fase2b-fila-tarefas            # o resumo em texto
```

