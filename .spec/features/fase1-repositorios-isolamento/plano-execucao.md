# Plano de execução — fase1-repositorios-isolamento

> gerado por `onp-spec plano` em 2026-09-25 12:58 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase1-repositorios-isolamento --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 4 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase1-repositorios-isolamento`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-039 | Helper de teste: dois tenants seedados (empresa A/B) | `claude-sonnet-5` | low |
| T-040 | `comTenant`: helper que abre transação com `SET LOCAL app.empresa_id` | `claude-sonnet-5` | medium |
| T-041 | Repositório de leads (criar, buscar por id, listar) | `claude-sonnet-5` | medium |
| T-042 | Repositório de oportunidades (buscar, atualizar, listar com filtro/paginação) | `claude-sonnet-5` | high |

## Gestão de branches e commits

1. branch de trabalho `spec/fase1-repositorios-isolamento` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase1-repositorios-isolamento` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase1-repositorios-isolamento/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase1-repositorios-isolamento-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase1-repositorios-isolamento --tabela   # a tabela de andamento
onp-spec resumo fase1-repositorios-isolamento            # o resumo em texto
```

