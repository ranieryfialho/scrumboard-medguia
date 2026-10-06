# Plano de execução — fase2c-whatsapp-conversa

> gerado por `onp-spec plano` em 2026-10-06 13:20 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2c-whatsapp-conversa --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 10 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2c-whatsapp-conversa`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-071 | Migration 0009: telefones do lead e estado de leitura | `claude-sonnet-5` | high |
| T-072 | Normalização e variações de número (módulo puro) | `claude-sonnet-5` | medium |
| T-073 | Repositório dos telefones do lead | `claude-sonnet-5` | high |
| T-074 | Rotas de telefones do lead | `claude-sonnet-5` | high |
| T-075 | Busca de lead por qualquer telefone (principal e extras) | `claude-sonnet-5` | high |
| T-076 | Repositório: histórico, não lidas, marcar como lida e registrar enviada | `claude-sonnet-5` | high |
| T-077 | Instância WhatsApp da empresa lida do Postgres novo | `claude-sonnet-5` | low |
| T-078 | Rota POST /api/whatsapp/send | `claude-sonnet-5` | high |
| T-079 | Rota GET /api/whatsapp/messages | `claude-sonnet-5` | medium |
| T-080 | Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2c-whatsapp-conversa` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2c-whatsapp-conversa` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2c-whatsapp-conversa/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conversa-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2c-whatsapp-conversa --tabela   # a tabela de andamento
onp-spec resumo fase2c-whatsapp-conversa            # o resumo em texto
```

