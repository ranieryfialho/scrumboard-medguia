# Plano de execução — fase3-etl-supabase

> gerado por `onp-spec plano` em 2026-10-19 16:47 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase3-etl-supabase --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 6 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase3-etl-supabase`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-108 | Base do ETL: leitor da origem, mascaramento de segredos e contexto de execução | `claude-sonnet-5` | medium |
| T-109 | Migrar empresas e usuários | `claude-sonnet-5` | medium |
| T-110 | Migrar leads como lead + card | `claude-sonnet-5` | medium |
| T-111 | Migrar campanhas e envios | `claude-sonnet-5` | medium |
| T-112 | Migrar mensagens de WhatsApp e configurações das empresas | `claude-sonnet-5` | medium |
| T-113 | Orquestrador e comando do ETL com simulação e relatório | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase3-etl-supabase` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase3-etl-supabase` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase3-etl-supabase/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase3-etl-supabase-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase3-etl-supabase --tabela   # a tabela de andamento
onp-spec resumo fase3-etl-supabase            # o resumo em texto
```

