# Plano de execução — fase4-design-system-shell-acesso

> gerado por `onp-spec plano` em 2026-10-23 16:21 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase4-design-system-shell-acesso --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 14 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase4-design-system-shell-acesso`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-140 | Tokens de tema, fontes e ícones do protótipo | `claude-sonnet-5` | medium |
| T-141 | Política de senha única e nome gravado no convite | `claude-sonnet-5` | medium |
| T-142 | Envio de e-mail (Resend) para redefinição de senha | `claude-sonnet-5` | medium |
| T-143 | Permissões por rota, middleware do Better Auth e raiz | `claude-sonnet-5` | high |
| T-144 | Rotas HTTP de autenticação, `/api/me` e empresa ativa | `claude-sonnet-5` | high |
| T-145 | APIs das telas públicas: esqueci, redefinir e convite | `claude-sonnet-5` | high |
| T-146 | Casca: menu lateral, topo e layout das telas logadas | `claude-sonnet-5` | xhigh |
| T-147 | Moldura das telas de acesso (fundo, cartão e rodapé) | `claude-sonnet-5` | medium |
| T-148 | Tela de login | `claude-sonnet-5` | high |
| T-149 | Tela de esqueci minha senha | `claude-sonnet-5` | medium |
| T-150 | Tela de redefinir senha | `claude-sonnet-5` | high |
| T-151 | Tela de convite | `claude-sonnet-5` | high |
| T-152 | Tela de sem acesso e sessão expirada | `claude-sonnet-5` | medium |
| T-153 | Garantia transversal: nenhuma tela de acesso traz artefato do protótipo | `claude-sonnet-5` | low |

## Gestão de branches e commits

1. branch de trabalho `spec/fase4-design-system-shell-acesso` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase4-design-system-shell-acesso` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/fase4-design-system-shell-acesso/executar-tarefas.sh
```

Cada tarefa roda `claude -p` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/scrumboard-medguia-fase4-design-system-shell-acesso-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase4-design-system-shell-acesso --tabela   # a tabela de andamento
onp-spec resumo fase4-design-system-shell-acesso            # o resumo em texto
```

