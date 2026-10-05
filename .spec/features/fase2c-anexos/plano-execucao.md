# Plano de execução — fase2c-anexos

> gerado por `onp-spec plano` em 2026-10-02 19:41 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2c-anexos --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 8 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase2c-anexos`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-052 | Validação de conteúdo e armazenamento em volume | `claude-sonnet-5` | medium |
| T-053 | Assinatura HMAC de URL com expiração de 60 s | `claude-sonnet-5` | medium |
| T-054 | Repositório de anexos (isolado por tenant) | `claude-sonnet-5` | medium |
| T-055 | Rota POST /api/anexos | `claude-sonnet-5` | high |
| T-056 | Rotas GET /api/anexos/[id] e GET /api/anexos/arquivo/[id] | `claude-sonnet-5` | high |
| T-057 | Transição valida o anexo como evidência do próprio card | `claude-sonnet-5` | medium |
| T-058 | Modal: escolher ou colar o print | `claude-sonnet-5` | high |
| T-059 | Volume `anexos` no docker-compose e variáveis de ambiente | `claude-sonnet-5` | low |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2c-anexos` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase2c-anexos` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2c-anexos/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase2c-anexos-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2c-anexos --tabela   # a tabela de andamento
onp-spec resumo fase2c-anexos            # o resumo em texto
```

