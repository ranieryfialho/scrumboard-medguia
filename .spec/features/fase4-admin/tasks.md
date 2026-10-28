# Tasks: Fase4 admin

> feature: fase4-admin

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
-->

## T-209 — API da equipe: listar, trocar papel, desativar e reenviar convite (servidor) [concluida]
- Refs: AC-578, AC-579, AC-582, AC-583, AC-584
- Arquivos: src/repositories/equipe.ts, src/lib/equipe/acesso.ts, src/app/api/equipe/route.ts, src/app/api/equipe/[usuarioId]/route.ts, src/app/api/equipe/[usuarioId]/reenviar-convite/route.ts, test/api/equipe.test.ts
- Esforço: alto
- Notas: `GET /api/equipe`, `PATCH /api/equipe/[usuarioId]` (papel e ativo, só MASTER/super admin; ninguém mexe em si; sempre sobra um MASTER ativo) e `POST .../reenviar-convite` (token novo, o antigo deixa de valer; e-mail de T-210). Situação derivada (ASM-200), último acesso da última sessão (ASM-204). Só da empresa da sessão; ATENDENTE 403.

## T-210 — API do convite e e-mail de convite (servidor) [concluida]
- Refs: AC-587, AC-588
- Arquivos: src/lib/auth/convites.ts, src/lib/email/templates.ts, src/lib/email/enviar.ts, src/app/api/equipe/convites/route.ts, test/api/equipe-convites.test.ts
- Esforço: alto
- Notas: `POST /api/equipe/convites` usa `convidarUsuario` (ganha `nome` opcional, gravado só no usuário novo) e o template `templateConvite` (`/convite/<token>`); `emailEnviado` falso se o envio falhar (ASM-209/ASM-210). Pessoa já ativa na empresa = 409; desativada = reativa o vínculo e reenvia. Os testes de convite da fase1 seguem sem edição.

## T-211 — API dos motivos de perda (servidor) [concluida]
- Refs: AC-593, AC-596
- Arquivos: src/repositories/motivos-perda-admin.ts, src/app/api/configuracoes/motivos-perda/route.ts, src/app/api/configuracoes/motivos-perda/[id]/route.ts, test/api/motivos-perda-admin.test.ts
- Esforço: medio
- Notas: lista todos (inclusive inativos) com o uso da empresa da sessão (ASM-201); criar e (des)ativar só super admin; sistêmico não muda. A rota `GET /api/motivos-perda` do modal do funil não muda.

## T-212 — API de empresas e bloqueio de sessão de empresa inativa (servidor) [concluida]
- Refs: AC-599, AC-604, AC-605, AC-608, AC-609, AC-610
- Arquivos: src/repositories/empresas-admin.ts, src/lib/auth/tenant.ts, src/app/api/admin/empresas/route.ts, src/app/api/admin/empresas/[id]/route.ts, test/api/empresas-admin.test.ts
- Esforço: alto
- Notas: `GET/POST /api/admin/empresas`, `GET/PATCH /api/admin/empresas/[id]`, só super admin. Criar empresa + convidar o master na mesma transação lógica (se o convite falhar, a empresa não fica). `resolverContextoTenant` passa a exigir `empresas.ativo` no vínculo (ASM-207); os testes de tenant/sessão seguem sem edição. Depende de T-210.

## T-213 — Tela da equipe (/equipe) [concluida]
- Refs: US-137, AC-577, AC-580, AC-581, AC-585
- Arquivos: src/app/(app)/equipe/page.tsx, src/components/admin/equipe.tsx, src/components/admin/comum.ts, src/components/admin/estados.tsx, test/components/admin/equipe.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/26*`; inclui trocar papel, desativar/reativar com confirmação e reenviar convite (AC-582/AC-583/AC-584 na tela). Depende de T-209.

## T-214 — Tela de convite (/equipe/convidar) [concluida]
- Refs: US-138, AC-586, AC-589, AC-590, AC-591
- Arquivos: src/app/(app)/equipe/convidar/page.tsx, src/components/admin/convidar-usuario.tsx, test/components/admin/convidar-usuario.test.tsx
- Esforço: alto
- Notas: fonte `27*`. A matriz de acessos do papel sai das regras de `src/lib/auth/rotas.ts`. Depende de T-210.

## T-215 — Tela dos motivos de perda (/configuracoes/motivos-perda) [concluida]
- Refs: US-139, AC-592, AC-594, AC-595, AC-597
- Arquivos: src/app/(app)/configuracoes/motivos-perda/page.tsx, src/components/admin/motivos-perda.tsx, test/components/admin/motivos-perda.test.tsx
- Esforço: alto
- Notas: fonte `28*`; inclui criar e ativar/desativar para o super admin (AC-596 na tela). Depende de T-211.

## T-216 — Tela da lista de empresas (/admin/empresas) [concluida]
- Refs: US-140, AC-598, AC-600, AC-601, AC-602
- Arquivos: src/app/(app)/admin/empresas/page.tsx, src/components/admin/empresas.tsx, test/components/admin/empresas.test.tsx
- Esforço: alto
- Notas: fonte `29*`. "Acessar" usa `POST /api/empresa-ativa`. Depende de T-212.

## T-217 — Telas de nova empresa e de edição de empresa [concluida]
- Refs: US-141, US-142, AC-603, AC-606, AC-607, AC-611, AC-612
- Arquivos: src/app/(app)/admin/empresas/nova/page.tsx, src/app/(app)/admin/empresas/[id]/page.tsx, src/components/admin/nova-empresa.tsx, src/components/admin/editar-empresa.tsx, test/components/admin/nova-empresa.test.tsx, test/components/admin/editar-empresa.test.tsx
- Esforço: xalto
- Notas: fontes `30*` e `31*`; a edição inclui salvar nome, suspender e reativar com confirmação (AC-609 na tela). Depende de T-212 e T-216.

## T-218 — Navegação sem 404 e estados da administração [concluida]
- Refs: US-143, AC-613, AC-614
- Arquivos: test/auth/rotas-admin.test.ts
- Esforço: medio
- Notas: teste no molde de `test/auth/rotas-analises.test.ts` (menu por papel, seis páginas, casca marcando o item certo, `/admin/empresas` só super admin). O estado de carregando/vazio/erro de cada tela é provado nos testes de tela. Depende das demais.
