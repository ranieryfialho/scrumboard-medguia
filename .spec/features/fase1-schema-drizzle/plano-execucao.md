# Plano de execução — fase1-schema-drizzle

> gerado por `onp-spec plano` em 2026-09-23 17:58 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase1-schema-drizzle --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 16 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase1-schema-drizzle`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-010 | Instalar e configurar Drizzle ORM + drizzle-kit | `claude-sonnet-5` | medium |
| T-011 | Modelar tabelas de identidade/tenant e Better Auth | `claude-sonnet-5` | medium |
| T-012 | Modelar tabelas do pipeline | `claude-sonnet-5` | medium |
| T-013 | Modelar tabelas de operação e as reescritas do modelo legado | `claude-sonnet-5` | medium |
| T-014 | Gerar e versionar a migration inicial do schema | `claude-sonnet-5` | medium |
| T-015 | Migration de RLS (ativar + policy por tenant em toda tabela de negócio) | `claude-sonnet-5` | medium |
| T-016 | Migration das invariantes do pipeline (constraints + privilégios) | `claude-sonnet-5` | medium |
| T-017 | Função SQL `mover_oportunidade` (transição + evento + lock otimista) | `claude-sonnet-5` | medium |
| T-018 | Função SQL `concluir_atividade` (resultado do toque + efeitos em cadeia) | `claude-sonnet-5` | medium |
| T-019 | Seeds idempotentes (etapas, grafo de transições, motivos de perda) | `claude-sonnet-5` | medium |
| T-020 | Harness de teste com Postgres efêmero (CI) | `claude-sonnet-5` | medium |
| T-021 | Testes de schema e tenant obrigatório | `claude-sonnet-5` | medium |
| T-022 | Testes de RLS (isolamento por tenant) | `claude-sonnet-5` | medium |
| T-023 | Testes das invariantes (constraints) e dos privilégios de DDL | `claude-sonnet-5` | medium |
| T-024 | Testes das funções SQL transacionais | `claude-sonnet-5` | medium |
| T-025 | Testes dos seeds | `claude-sonnet-5` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase1-schema-drizzle` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase1-schema-drizzle` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase1-schema-drizzle/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase1-schema-drizzle-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase1-schema-drizzle --tabela   # a tabela de andamento
onp-spec resumo fase1-schema-drizzle            # o resumo em texto
```

