# Plano de execução — fase2c-sse

> gerado por `onp-spec plano` em 2026-10-05 13:39 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2c-sse --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 6 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2c-sse`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-060 | Migration 0007: NOTIFY dentro de mover_oportunidade | `claude-sonnet-5` | medium |
| T-061 | Barramento de eventos: um LISTEN por instância | `claude-sonnet-5` | high |
| T-062 | Rota GET /api/stream | `claude-sonnet-5` | high |
| T-063 | Evento chega fim a fim e transição recusada não emite | `claude-sonnet-5` | medium |
| T-064 | Hook do cliente: EventSource com fallback de polling | `claude-sonnet-5` | medium |
| T-065 | Board aplica o evento sem recarregar | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2c-sse` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2c-sse` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2c-sse/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2c-sse-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2c-sse --tabela   # a tabela de andamento
onp-spec resumo fase2c-sse            # o resumo em texto
```

