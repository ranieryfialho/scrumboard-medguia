# Tasks: Fase 2c — WhatsApp de entrada

> feature: fase2c-whatsapp-entrada

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

## T-066 — Migration 0008: idempotência, conexão e NOTIFY de mensagem [concluida]
- Refs: AC-124, AC-127, AC-128, AC-129, AC-130, AC-131, AC-132, AC-133
- Arquivos: drizzle/0008_whatsapp_entrada.sql, test/whatsapp/conexao-sql.test.ts
- Esforço: alto
- Notas: índice único parcial `(empresa_id, evolution_message_id)` (ASM-037). Função `registrar_conexao_whatsapp` trava o card em cadência (etapas 2–4, `cadencia_encerrada_em` nulo, Q-012), chama `mover_oportunidade` para a etapa 5 com `ator_tipo = sistema`, grava o evento `conexao_whatsapp` com `evolution_message_id`, cancela atividades pendentes e preenche `cadencia_encerrada_em`, tudo numa transação (ASM-036); como relê e trava dentro da função, não há 409 (AC-132). `pg_notify` de `mensagem.recebida` só com ids (ASM-038, Q-011). GRANT EXECUTE para `crm_app`. Prova com testcontainers, incluindo rollback.

## T-067 — Extrair mensagem do payload da Evolution [concluida]
- Refs: AC-122, AC-123
- Arquivos: src/domain/whatsapp/extrair-mensagem.ts, test/whatsapp/extrair-mensagem.test.ts
- Esforço: medio
- Notas: módulo puro, sem I/O. Normaliza número (sem `@…`, sem `:device`, só dígitos, prefere `remoteJidAlt`), extrai texto/legenda, rótulos `[áudio]`/`[figurinha]`/`[mídia]`, e descarta `fromMe`, grupo `@g.us`, sem número e evento que não é de mensagem. Aceita `data` único ou array. Porta a lógica do webhook legado.

## T-068 — Repositório do WhatsApp de entrada [concluida]
- Refs: AC-124, AC-125, AC-126, AC-129
- Arquivos: src/repositories/whatsapp.ts, test/repositories/whatsapp.test.ts
- Esforço: alto
- Notas: tudo por `comTenant` (ASM-034). Lê o segredo da empresa em `empresa_configuracoes` com comparação em tempo constante (ASM-033); casa o lead pelos dígitos do `telefone_e164` com a variação do nono dígito e desempate da ASM-039, sempre filtrando por `empresa_id`; grava a mensagem de forma idempotente e chama `registrar_conexao_whatsapp`. Devolve se a mensagem foi nova, para a rota decidir emitir evento. Depende de T-066 e T-067.

## T-069 — Rota POST /api/whatsapp/webhook [concluida]
- Refs: US-039, AC-119, AC-120, AC-121, AC-131
- Arquivos: src/app/api/whatsapp/webhook/route.ts, test/api/whatsapp-webhook.test.ts
- Esforço: alto
- Notas: reescreve a rota legada em Supabase. Valida `empresa_id` (UUID) e o segredo antes de qualquer escrita; 401 uniforme para segredo ausente/errado/empresa inexistente (AC-119, AC-121); 400 para JSON inválido; processa cada item do array em transação própria (AC-131: falha no banco devolve 500). Remove o uso de `@supabase/supabase-js` desta rota. Depende de T-068.

## T-070 — SSE: evento `mensagem.recebida` [concluida]
- Refs: US-042, AC-133, AC-134
- Arquivos: src/lib/sse/barramento.ts, test/sse/mensagem-recebida.test.ts
- Esforço: medio
- Notas: o barramento passa a repassar também `mensagem.recebida` (campo `tipo` do payload no canal `oportunidade`, ASM-038) mantendo o filtro por `empresaId` e o único LISTEN por instância; `/api/stream` já formata qualquer `tipo`. AC-134: ignorada/duplicada não emite, o que depende do NOTIFY só sair na inserção nova (T-066). Depende de T-066.
