# Plano de execução — fase0-fundacao-ci-staging

> gerado por `onp-spec plano` em 2026-09-23 13:23 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase0-fundacao-ci-staging --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 9 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase0-fundacao-ci-staging`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-001 | Migrar runner de testes para Vitest | `claude-sonnet-5` | low |
| T-002 | CI com gates (lint → typecheck → test → build) | `claude-sonnet-5` | medium |
| T-003 | Workflow de release: build e publish no GHCR por tag SHA | `claude-sonnet-5` | medium |
| T-004 | Deploy por pull de imagem + rollback por tag | `claude-sonnet-5` | medium |
| T-005 | Databases crm_prod/crm_staging e roles crm_app/crm_migrator | `claude-sonnet-5` | high |
| T-006 | Topologia de staging atrás do proxy, sem porta nova exposta | `claude-sonnet-5` | low |
| T-007 | Backup diário (pg_dump + checksum + rclone) com alerta | `claude-sonnet-5` | high |
| T-008 | Restore ensaiado, documentado e com script de verificação | `claude-sonnet-5` | medium |
| T-009 | Endpoint `/api/health` | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase0-fundacao-ci-staging` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase0-fundacao-ci-staging` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase0-fundacao-ci-staging/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase0-fundacao-ci-staging-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase0-fundacao-ci-staging --tabela   # a tabela de andamento
onp-spec resumo fase0-fundacao-ci-staging            # o resumo em texto
```

