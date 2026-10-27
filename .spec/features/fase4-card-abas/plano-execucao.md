# Plano de execução — fase4-card-abas

> gerado por `onp-spec plano` em 2026-10-27 17:26 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase4-card-abas`

## Resumo — o que vai acontecer

- **8 tarefa(s) pendente(s)**: 8 em 8 faixa(s) paralela(s) + 0 sequencial(is)
- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si
- prefere outra seleção ou uma após a outra? Regenere com `onp-spec plano fase4-card-abas --paralelizar T-xxx,T-yyy` ou `--sequencial`
- tudo acontece na branch de trabalho `spec/fase4-card-abas`; levar para a main é decisão sua

## Faixas e ondas

### Onda 1 — faixa-1 ∥ faixa-2 ∥ faixa-3

#### faixa-1 — branch `spec/fase4-card-abas-faixa-1` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-1`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-168 | Nome original do anexo: migration 0013 e upload | `claude-sonnet-5` | high | `drizzle/0013_anexos_nome.sql`, `src/db/schema/pipeline.ts`, `src/lib/anexos/nome.ts`, `src/repositories/anexos.ts`, `src/app/api/anexos/route.ts`, `test/api/anexos-nome.test.ts` |

#### faixa-2 — branch `spec/fase4-card-abas-faixa-2` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-2`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-169 | Listagem dos anexos do card (servidor) | `claude-sonnet-5` | medium | `src/repositories/anexos-lista.ts`, `src/app/api/oportunidades/[id]/anexos/route.ts`, `test/api/oportunidade-anexos-lista.test.ts` |

#### faixa-3 — branch `spec/fase4-card-abas-faixa-3` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-3`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-170 | Listagem da cadência do card (servidor) | `claude-sonnet-5` | medium | `src/repositories/cadencia-card.ts`, `src/app/api/oportunidades/[id]/cadencia/route.ts`, `test/api/oportunidade-cadencia-lista.test.ts` |

### Onda 2 — faixa-4 ∥ faixa-5 ∥ faixa-6

#### faixa-4 — branch `spec/fase4-card-abas-faixa-4` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-4`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-171 | Molde do card: cabeçalho e abas compartilhados | `claude-sonnet-5` | xhigh | `src/components/pipeline/card/molde-do-card.tsx`, `src/components/pipeline/card/abas-do-card.tsx`, `src/components/pipeline/card/cabecalho-do-card.tsx`, `src/app/(app)/pipeline/[id]/page.tsx`, `test/components/pipeline/molde-do-card.test.tsx` |

#### faixa-5 — branch `spec/fase4-card-abas-faixa-5` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-5`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-172 | Tela de anexos e evidências | `claude-sonnet-5` | xhigh | `src/app/(app)/pipeline/[id]/anexos/page.tsx`, `src/components/pipeline/anexos/lista-anexos.tsx`, `src/components/pipeline/anexos/filtros-anexos.tsx`, `src/components/pipeline/anexos/envio-anexos.tsx`, `test/components/pipeline/anexos-tela.test.tsx` |

#### faixa-6 — branch `spec/fase4-card-abas-faixa-6` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-6`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-173 | Tela da cadência de 18 toques | `claude-sonnet-5` | xhigh | `src/app/(app)/pipeline/[id]/cadencia/page.tsx`, `src/components/pipeline/cadencia/resumo-cadencia.tsx`, `src/components/pipeline/cadencia/toque-da-vez.tsx`, `src/components/pipeline/cadencia/matriz-toques.tsx`, `src/components/pipeline/cadencia/historico-toques.tsx`, `test/components/pipeline/cadencia-tela.test.tsx` |

### Onda 3 — faixa-7 ∥ faixa-8

#### faixa-7 — branch `spec/fase4-card-abas-faixa-7` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-7`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-174 | Tela da conversa de WhatsApp do lead | `claude-sonnet-5` | xhigh | `src/app/(app)/pipeline/[id]/conversa/page.tsx`, `src/components/pipeline/conversa/conversa-lead.tsx`, `src/components/pipeline/conversa/seletor-telefone.tsx`, `src/components/pipeline/conversa/faixa-conexao.tsx`, `src/components/pipeline/conversa/painel-lateral.tsx`, `test/components/pipeline/conversa-tela.test.tsx` |

#### faixa-8 — branch `spec/fase4-card-abas-faixa-8` — worktree `../onp-worktrees/scrumboard-medguia-fase4-card-abas-faixa-8`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-175 | Garantia: as quatro abas existem e nenhuma dá 404 | `claude-sonnet-5` | low | `test/components/pipeline/abas-sem-404.test.ts` |

## Gestão de branches e commits

1. branch de trabalho `spec/fase4-card-abas` criada do ponto atual (se ainda não existir)
2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)
3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana
4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md
5. gate final na branch de trabalho: `onp-spec verify fase4-card-abas` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase4-card-abas/executar-tarefas.sh
```

Cada faixa roda `claude -p` com **janela de contexto limpa**, no seu worktree, com
`--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`. Os prompts exatos estão
embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.
Logs: `../onp-worktrees/scrumboard-medguia-fase4-card-abas-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase4-card-abas --tabela   # a tabela de andamento
onp-spec resumo fase4-card-abas            # o resumo em texto
```

