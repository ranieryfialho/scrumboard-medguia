# Plano de execução — fase2c-whatsapp-conexao

> gerado por `onp-spec plano` em 2026-10-07 16:32 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2c-whatsapp-conexao --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 7 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2c-whatsapp-conexao`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-081 | Migration 0010: nome de instância único entre empresas | `claude-sonnet-5` | low |
| T-082 | Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado | `claude-sonnet-5` | low |
| T-083 | Validação da configuração e cliente Evolution que reporta falha do webhook | `claude-sonnet-5` | medium |
| T-084 | Repositório da configuração e do segredo do webhook | `claude-sonnet-5` | high |
| T-085 | Rota GET e POST /api/whatsapp/config | `claude-sonnet-5` | high |
| T-086 | Rota GET /api/whatsapp/status | `claude-sonnet-5` | medium |
| T-087 | Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase | `claude-sonnet-5` | high |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2c-whatsapp-conexao` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2c-whatsapp-conexao` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2c-whatsapp-conexao/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2c-whatsapp-conexao-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2c-whatsapp-conexao --tabela   # a tabela de andamento
onp-spec resumo fase2c-whatsapp-conexao            # o resumo em texto
```

