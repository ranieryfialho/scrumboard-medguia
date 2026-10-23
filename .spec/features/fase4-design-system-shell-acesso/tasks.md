# Tasks: Fase 4 — Design system, casca e acesso (MedCRM)

> feature: fase4-design-system-shell-acesso

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - Toda tarefa referencia em `Refs:` pelo menos uma história de usuário
    (US-xxx) ou critério de aceite (AC-xxx).
  - Toda tarefa lista os arquivos que cria/altera em `Arquivos:` — capriche:
    é o que decide o que `onp-spec plano` roda em PARALELO (arquivos
    disjuntos) e o que roda em sequência.
  - Campos opcionais por tarefa, usados pelo plano de execução:
    `- Modelo: claude-sonnet-5` e `- Esforço: alto` (baixo|medio|alto|xalto|max).
  - Uma tarefa só pode virar [concluida] quando os critérios de aceite dela
    tiverem prova PASS registrada por `onp-spec verify`.
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)

  Referência visual de cada tela: docs/ui/stitch_medcrm_interface_design/<pasta>/code.html
  (a marcação e as classes do protótipo são a fonte; ver "Regra de fidelidade" na spec).
-->

## T-140 — Tokens de tema, fontes e ícones do protótipo [pendente]

- Refs: AC-345, AC-346
- Arquivos: src/app/globals.css, src/app/layout.tsx, test/ui/design-system.test.ts
- Esforço: medio
- Notas: portar o `tailwind.config` do `code.html` (cores, `spacing`, `fontSize`, `fontFamily`) para `@theme` do Tailwind v4; Plus Jakarta Sans e Inter por `next/font/google`; Material Symbols Outlined por `<link>` do Google Fonts (com `FILL`). Conflitos com os tokens do shadcn: ASM-125.

## T-141 — Política de senha única e nome gravado no convite [pendente]

- Refs: AC-385, AC-386
- Arquivos: src/lib/auth/politica-senha.ts, src/lib/auth/definir-senha.ts, src/lib/auth/reset-senha.ts, test/auth/politica-senha.test.ts
- Esforço: medio
- Notas: (suposição ASM-127) módulo puro `validarSenha(senha)` usado no servidor e importado pelas telas (AC-386). `definirSenhaComToken` passa a receber `nome` opcional e gravar em `usuarios.nome`. Política decidida em Q-041 (8+, maiúscula, número ou símbolo).

## T-142 — Envio de e-mail (Resend) para redefinição de senha [pendente]

- Refs: AC-365
- Arquivos: src/lib/email/enviar.ts, src/lib/email/templates.ts, test/email/enviar.test.ts
- Esforço: medio
- Notas: transporte injetável (o teste usa um falso, sem rede). Depende da resposta de Q-043 (chave, domínio, remetente) só para o envio real; o código nasce sem ela e falha com erro claro se `RESEND_API_KEY` faltar.

## T-143 — Permissões por rota, middleware do Better Auth e raiz [pendente]

- Refs: AC-379, AC-380, AC-381, AC-382, AC-384
- Arquivos: src/middleware.ts, src/lib/auth/rotas.ts, src/app/page.tsx, test/auth/middleware.test.ts
- Esforço: alto
- Notas: `rotas.ts` concentra a lista de rotas públicas e o papel mínimo por rota (matriz de ASM-123), usada também pelo menu da casca. O middleware não consulta o Supabase (AC-384). `/` vira redirecionamento. Q-045 define o destino das telas legadas.

## T-144 — Rotas HTTP de autenticação, `/api/me` e empresa ativa [pendente]

- Refs: AC-353, AC-357, AC-378, AC-383
- Arquivos: src/app/api/auth/[...all]/route.ts, src/app/api/me/route.ts, src/app/api/empresa-ativa/route.ts, test/api/auth-http.test.ts
- Esforço: alto
- Notas: `[...all]` entrega o handler do Better Auth (`toNextJsHandler`). `/api/me` devolve usuário, papel, empresa e, para super admin, as empresas. `empresa-ativa` usa `troca-empresa.ts` (AC-045). Testes sobem o Postgres efêmero.

## T-145 — APIs das telas públicas: esqueci, redefinir e convite [pendente]

- Refs: AC-364, AC-365, AC-369, AC-370, AC-371, AC-373, AC-374
- Arquivos: src/app/api/acesso/esqueci-senha/route.ts, src/app/api/acesso/redefinir-senha/[token]/route.ts, src/app/api/acesso/convite/[token]/route.ts, test/api/acesso.test.ts
- Esforço: alto
- Notas: GET valida o token sem consumi-lo (AC-370/374); POST consome, aplica a política (T-141) e cria a sessão (ASM-126). Esqueci-senha responde igual para e-mail existente ou não (AC-364) e usa o limite de AC-047. Depende de T-141 e T-142.

## T-146 — Casca: menu lateral, topo e layout das telas logadas [pendente]

- Refs: AC-348, AC-349, AC-350, AC-351, AC-352, AC-353, AC-354, AC-355, AC-356, AC-357
- Arquivos: src/components/shell/menu-lateral.tsx, src/components/shell/topo.tsx, src/components/shell/menu-config.ts, src/components/shell/use-contadores.ts, src/components/shell/use-tempo-real.ts, src/app/(app)/layout.tsx, test/components/shell/casca.test.tsx
- Esforço: xalto
- Notas: fonte visual: `13._tarefas_fila_do_turno_atual/code.html` (`<aside>` e `<header>`). Contadores usam `/api/atividades` e `/api/whatsapp/unread`; tempo real usa o SSE existente (`/api/stream`). As páginas `/pipeline`, `/tarefas` e `/indicadores` passam a ficar sob `(app)` (grupo de rotas, a URL não muda) em tarefa da feature 2. Depende de T-140, T-143 e T-144.

## T-147 — Moldura das telas de acesso (fundo, cartão e rodapé) [pendente]

- Refs: AC-347, AC-362
- Arquivos: src/components/auth/moldura-acesso.tsx, src/components/auth/criterios-senha.tsx, src/app/(auth)/layout.tsx, test/components/auth/moldura.test.tsx
- Esforço: medio
- Notas: o fundo com os três círculos desfocados, o cartão `max-w-[460px] rounded-2xl` e o rodapé vêm do `1._login_acesso_plataforma/code.html`, **sem** o seletor de estado. Rodapé com texto verdadeiro, decidido em Q-042. Quem já tem sessão e abre uma tela de acesso vai para `/pipeline` (AC-362, no layout do grupo). Também entrega `criterios-senha.tsx` (lista de critérios que acendem, usa `validarSenha` de T-141), compartilhado pelas telas de redefinir (T-150) e convite (T-151), que rodam depois.

## T-148 — Tela de login [pendente]

- Refs: AC-358, AC-359, AC-360, AC-361
- Arquivos: src/app/(auth)/login/page.tsx, src/components/auth/formulario-login.tsx, test/components/auth/login.test.tsx
- Esforço: alto
- Notas: fonte visual `1._login_acesso_plataforma/code.html`. Estados reais: padrão, enviando (spinner), erro com tentativas restantes, bloqueado com contagem regressiva. `next` só aceita caminho do mesmo site. O arquivo legado `src/app/login/page.tsx` é substituído. O campo "Lembrar de mim por 30 dias" do protótipo **não entra** (Q-044).

## T-149 — Tela de esqueci minha senha [pendente]

- Refs: AC-363, AC-366
- Arquivos: src/app/(auth)/esqueci-senha/page.tsx, src/components/auth/formulario-esqueci-senha.tsx, test/components/auth/esqueci-senha.test.tsx
- Esforço: medio
- Notas: fonte visual `2._esqueci_senha_recuperar_senha/code.html`. O prazo exibido é 24 horas (não os 30 minutos do protótipo).

## T-150 — Tela de redefinir senha [pendente]

- Refs: AC-367, AC-368
- Arquivos: src/app/(auth)/redefinir-senha/[token]/page.tsx, src/components/auth/formulario-redefinir-senha.tsx, test/components/auth/redefinir-senha.test.tsx
- Esforço: alto
- Notas: fonte visual `3._redefinir_senha_token_nova_senha/code.html`. Usa `criterios-senha.tsx` de T-147. O estado de link inválido é o do protótipo (AC-370, servido por T-145).

## T-151 — Tela de convite [pendente]

- Refs: AC-372
- Arquivos: src/app/(auth)/convite/[token]/page.tsx, src/components/auth/formulario-convite.tsx, test/components/auth/convite.test.tsx
- Esforço: alto
- Notas: fonte visual `4._convite_token_aceitar_convite/code.html`. Sem o bloco "Contatos do Administrador" (ASM-128). Links de Termos de Uso e Suporte com selo "em breve". Reusa `criterios-senha.tsx` de T-147.

## T-152 — Tela de sem acesso e sessão expirada [pendente]

- Refs: AC-375, AC-376, AC-377
- Arquivos: src/app/(auth)/sem-acesso/page.tsx, src/components/auth/painel-sem-acesso.tsx, src/lib/auth/nomes-de-rotas.ts, test/components/auth/sem-acesso.test.tsx
- Esforço: medio
- Notas: fonte visual `5._sem_acesso_permiss_o_e_sess_o/code.html`. Reusa os nomes legíveis de rota do menu (`menu-config.ts` de T-146) via `nomes-de-rotas.ts`, que T-146 não toca; ao integrar, T-152 importa o menu, não o altera.

## T-153 — Garantia transversal: nenhuma tela de acesso traz artefato do protótipo [pendente]

- Refs: AC-347
- Arquivos: test/components/auth/sem-artefatos.test.tsx
- Esforço: baixo
- Notas: renderiza as cinco telas e varre o texto atrás de "Estado:", `US-0xx`, "HIPAA", "ISO 27001", "SSL 256-bit". Roda por último.
