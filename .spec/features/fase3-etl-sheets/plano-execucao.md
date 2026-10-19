# Plano de execução — fase3-etl-sheets

> gerado por `onp-spec plano` em 2026-10-19 18:08 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase3-etl-sheets --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 7 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase3-etl-sheets`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-114 | Leitor das abas (somente leitura) e mapeamento de colunas por aba | `claude-sonnet-5` | medium |
| T-115 | Normalização de telefone e datas | `claude-sonnet-5` | medium |
| T-116 | Deduplicação entre abas e resolução de conflito | `claude-sonnet-5` | medium |
| T-117 | Mapa de status para etapa e motivo de perda | `claude-sonnet-5` | medium |
| T-118 | Importar leads, cards, origem e eventos `migrado_de` | `claude-sonnet-5` | medium |
| T-119 | Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone | `claude-sonnet-5` | medium |
| T-120 | Orquestrador do ETL do Sheets com simulação e relatório | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase3-etl-sheets` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase3-etl-sheets` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase3-etl-sheets/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase3-etl-sheets-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase3-etl-sheets --tabela   # a tabela de andamento
onp-spec resumo fase3-etl-sheets            # o resumo em texto
```

