# Plano de execução — fase2-kanban

> gerado por `onp-spec plano` em 2026-09-25 18:23 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2-kanban --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 9 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2-kanban`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-043 | Migration: `mover_oportunidade` grava valor/motivo/próxima ação | `claude-sonnet-5` | medium |
| T-044 | Repositório: `criarOportunidade` | `claude-sonnet-5` | medium |
| T-045 | Repositório: `moverOportunidade` (chama a função SQL estendida) | `claude-sonnet-5` | high |
| T-046 | Rota `GET /api/oportunidades` (board) e `POST /api/oportunidades` (criar) | `claude-sonnet-5` | high |
| T-047 | Rota `POST /api/oportunidades/:id/transicao` | `claude-sonnet-5` | xhigh |
| T-048 | Rota `GET /api/oportunidades/:id` (detalhe) | `claude-sonnet-5` | low |
| T-049 | Componentes do board: colunas, card, drag-and-drop | `claude-sonnet-5` | xhigh |
| T-050 | Modal de dado faltante | `claude-sonnet-5` | medium |
| T-051 | Página de detalhe do card | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2-kanban` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2-kanban` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2-kanban/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2-kanban-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2-kanban --tabela   # a tabela de andamento
onp-spec resumo fase2-kanban            # o resumo em texto
```

