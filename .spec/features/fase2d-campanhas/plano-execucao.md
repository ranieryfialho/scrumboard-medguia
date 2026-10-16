# Plano de execução — fase2d-campanhas

> gerado por `onp-spec plano` em 2026-10-16 20:15 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase2d-campanhas`

## Resumo — o que vai acontecer

- **4 tarefa(s) pendente(s)**: 4 em 4 faixa(s) paralela(s) + 0 sequencial(is)
- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si
- prefere outra seleção ou uma após a outra? Regenere com `onp-spec plano fase2d-campanhas --paralelizar T-xxx,T-yyy` ou `--sequencial`
- tudo acontece na branch de trabalho `spec/fase2d-campanhas`; levar para a main é decisão sua

## Faixas e ondas

### Onda 1 — faixa-1 ∥ faixa-2 ∥ faixa-3

#### faixa-1 — branch `spec/fase2d-campanhas-faixa-1` — worktree `../onp-worktrees/scrumboard-medguia-fase2d-campanhas-faixa-1`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-104 | Repositório de campanhas e envios | `claude-sonnet-5` | high | `src/repositories/campanhas.ts`, `test/db/campanhas.test.ts` |

#### faixa-2 — branch `spec/fase2d-campanhas-faixa-2` — worktree `../onp-worktrees/scrumboard-medguia-fase2d-campanhas-faixa-2`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-105 | Rotas /api/campanhas (CRUD, iniciar, reenviar) | `claude-sonnet-5` | high | `src/app/api/campanhas/route.ts`, `src/app/api/campanhas/[id]/route.ts`, `src/app/api/campanhas/[id]/iniciar/route.ts`, `src/app/api/campanhas/[id]/reenviar-falhas/route.ts`, `test/api/campanhas.test.ts` |

#### faixa-3 — branch `spec/fase2d-campanhas-faixa-3` — worktree `../onp-worktrees/scrumboard-medguia-fase2d-campanhas-faixa-3`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-106 | Webhook do Resend no modelo novo | `claude-sonnet-5` | medium | `src/app/api/webhooks/resend/route.ts`, `src/lib/resend/assinatura.ts`, `test/api/webhook-resend.test.ts` |

### Onda 2 — faixa-4

#### faixa-4 — branch `spec/fase2d-campanhas-faixa-4` — worktree `../onp-worktrees/scrumboard-medguia-fase2d-campanhas-faixa-4`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-107 | Telas de Mala Direta nas rotas novas | `claude-sonnet-5` | high | `src/components/campanhas/campanhas-tab.tsx`, `src/components/campanhas/campanha-detalhes.tsx`, `src/components/campanhas/nova-campanha-modal.tsx`, `src/hooks/use-campanhas.ts`, `test/components/campanhas/campanhas-telas.test.tsx` |

## Gestão de branches e commits

1. branch de trabalho `spec/fase2d-campanhas` criada do ponto atual (se ainda não existir)
2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)
3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana
4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md
5. gate final na branch de trabalho: `onp-spec verify fase2d-campanhas` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase2d-campanhas/executar-tarefas.sh
```

Cada faixa roda `claude -p` com **janela de contexto limpa**, no seu worktree, com
`--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`. Os prompts exatos estão
embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.
Logs: `../onp-worktrees/scrumboard-medguia-fase2d-campanhas-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase2d-campanhas --tabela   # a tabela de andamento
onp-spec resumo fase2d-campanhas            # o resumo em texto
```

