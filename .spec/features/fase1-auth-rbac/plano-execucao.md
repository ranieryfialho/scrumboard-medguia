# Plano de execução — fase1-auth-rbac

> gerado por `onp-spec plano` em 2026-09-24 18:22 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase1-auth-rbac --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 8 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase1-auth-rbac`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-026 | Instala e configura o Better Auth sobre o schema existente | `claude-sonnet-5` | high |
| T-027 | Login com e-mail/senha | `claude-sonnet-5` | medium |
| T-028 | Convite de usuário por administrador da empresa | `claude-sonnet-5` | high |
| T-029 | Definição de senha a partir do convite | `claude-sonnet-5` | medium |
| T-030 | Reset de senha | `claude-sonnet-5` | medium |
| T-031 | Resolução de sessão e tenant no servidor | `claude-sonnet-5` | medium |
| T-032 | Troca de empresa pelo super admin | `claude-sonnet-5` | medium |
| T-033 | Rate limit de login, convite e reset | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase1-auth-rbac` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase1-auth-rbac` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase1-auth-rbac/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase1-auth-rbac-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase1-auth-rbac --tabela   # a tabela de andamento
onp-spec resumo fase1-auth-rbac            # o resumo em texto
```

