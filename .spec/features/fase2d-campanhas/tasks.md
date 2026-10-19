1

# Tasks: Fase2d campanhas

> feature: fase2d-campanhas

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

## T-104 — Repositório de campanhas e envios [concluida]
- Refs: AC-234, AC-235, AC-236, AC-239, AC-240, AC-241, AC-242, AC-243, AC-244, AC-245
- Arquivos: src/repositories/campanhas.ts, test/db/campanhas.test.ts
- Esforço: alto
- Notas: Drizzle + RLS (`campanhas`/`envios_campanha` em src/db/schema/legado.ts). Transações para criar (campanha + lote), iniciar (UPDATE condicional por status, seguro contra clique duplo) e reenviar falhas. Normalização de e-mail (trim, lower, validação, dedup) em função pura testável. Origem "etapa" faz join oportunidades→leads (ASM-078). Teste em Postgres efêmero.

## T-105 — Rotas /api/campanhas (CRUD, iniciar, reenviar) [concluida]
- Refs: AC-234, AC-235, AC-237, AC-238, AC-239, AC-240, AC-241, AC-243, AC-244, AC-245
- Arquivos: src/app/api/campanhas/route.ts, src/app/api/campanhas/[id]/route.ts, src/app/api/campanhas/[id]/iniciar/route.ts, src/app/api/campanhas/[id]/reenviar-falhas/route.ts, test/api/campanhas.test.ts
- Esforço: alto
- Notas: depende de T-104. Mesmo padrão de sessão/tenant de src/app/api/atividades/route.ts; MASTER/GERENTE/super admin (ASM-076); validação de corpo antes do banco.

## T-106 — Webhook do Resend no modelo novo [pendente]
- Refs: AC-246, AC-247, AC-248
- Arquivos: src/app/api/webhooks/resend/route.ts, src/lib/resend/assinatura.ts, test/api/webhook-resend.test.ts
- Esforço: medio
- Notas: independe das demais (arquivos disjuntos). Remove o uso de `@supabase/supabase-js` e da service role; verifica assinatura Svix (ASM-079); atualização por UPDATE condicional (ENVIADO→ABERTO, ENVIADO/ABERTO→CLICADO). Acesso ao banco sem sessão de usuário: seguir o padrão do webhook da Evolution em src/app/api/whatsapp/webhook.

## T-107 — Telas de Mala Direta nas rotas novas [pendente]
- Refs: AC-249, AC-250, AC-251
- Arquivos: src/components/campanhas/campanhas-tab.tsx, src/components/campanhas/campanha-detalhes.tsx, src/components/campanhas/nova-campanha-modal.tsx, src/hooks/use-campanhas.ts, test/components/campanhas/campanhas-telas.test.tsx
- Esforço: alto
- Notas: depende de T-105 pelo formato das respostas (testes com `fetch` falso). Remove `createClient` do Supabase desses três componentes; o aviso "motor em Python" some do alerta; polling de 5 s só em PROCESSANDO. Item de menu oculto para ATENDENTE (src/components/layout/sidebar.tsx, se necessário, sem tocar na lógica do restante).
