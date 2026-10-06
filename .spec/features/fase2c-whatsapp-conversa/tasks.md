# Tasks: Fase2c whatsapp conversa

> feature: fase2c-whatsapp-conversa

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

## T-071 — Migration 0009: telefones do lead e estado de leitura [concluida]
- Refs: AC-153, AC-164
- Arquivos: drizzle/0009_whatsapp_conversa.sql, drizzle/meta/_journal.json, src/db/schema/pipeline.ts, src/db/schema/legado.ts, test/whatsapp/conversa-sql.test.ts
- Esforço: alto
- Notas: tabela `lead_telefones` (id, empresa_id, lead_id, numero só dígitos, rotulo, criado_em; único por lead+numero; garantir que lead e empresa batem) com RLS por `app.empresa_id` e GRANT para `crm_app` (ASM-043). Coluna `lida_em` em `whatsapp_mensagens` com backfill `lida_em = criado_em` das recebidas existentes e índice parcial das não lidas (ASM-044). Espelhar no schema Drizzle. Prova com testcontainers: backfill e isolamento por RLS.

## T-072 — Normalização e variações de número (módulo puro) [concluida]
- Refs: AC-143, AC-149, AC-161, AC-162
- Arquivos: src/domain/whatsapp/numero.ts, test/whatsapp/numero.test.ts
- Esforço: medio
- Notas: sem I/O (ASM-046). Funções: normalizar (só dígitos, DDI 55 com 10/11 dígitos, válido entre 10 e 15), variações do nono dígito (hoje privada em src/repositories/whatsapp.ts, que passa a importar daqui) e comparação de equivalência. Cobre as grafias de AC-149 e a duplicidade de AC-161.

## T-073 — Repositório dos telefones do lead [concluida]
- Refs: AC-160, AC-161, AC-163, AC-164
- Arquivos: src/repositories/lead-telefones.ts, test/repositories/lead-telefones.test.ts
- Esforço: alto
- Notas: tudo por `comTenant`. Cadastrar (recusa duplicado contra o principal e os extras, com variação do nono dígito, dentro do mesmo lead), listar (principal marcado `principal: true` + extras) e remover só extra do próprio lead e tenant. Lead alheio ou inexistente → mesmo resultado nulo. Depende de T-071 e T-072.

## T-074 — Rotas de telefones do lead [concluida]
- Refs: US-047, AC-160, AC-161, AC-162, AC-163, AC-164
- Arquivos: src/app/api/leads/[id]/telefones/route.ts, src/app/api/leads/[id]/telefones/[telefoneId]/route.ts, test/api/lead-telefones.test.ts
- Esforço: alto
- Notas: GET/POST em `/api/leads/{id}/telefones` e DELETE em `/api/leads/{id}/telefones/{telefoneId}`, mesmo padrão de sessão das rotas de anexos (401 antes de qualquer tabela). Códigos: 400 `REQUISICAO_INVALIDA`, 404 `LEAD_NAO_ENCONTRADO`, 409 `TELEFONE_DUPLICADO`, 201/204. Depende de T-073.

## T-075 — Busca de lead por qualquer telefone (principal e extras) [concluida]
- Refs: AC-142, AC-165, AC-166
- Arquivos: src/repositories/whatsapp.ts, test/repositories/whatsapp-telefones.test.ts
- Esforço: alto
- Notas: `localizarLeadPorNumero` passa a considerar `leads.telefone_e164` **e** `lead_telefones`, com a tolerância ao nono dígito, mantendo o desempate da ASM-039 (ASM-047) e o filtro por `empresa_id`. Os testes de whatsapp-entrada (AC-125/126) continuam passando. Prova AC-165 de ponta a ponta pelo repositório (conexão e cadência). Depende de T-071 e T-072.

## T-076 — Repositório: histórico, não lidas, marcar como lida e registrar enviada [concluida]
- Refs: AC-148, AC-149, AC-150, AC-151, AC-154, AC-155, AC-157, AC-158, AC-159
- Arquivos: src/repositories/whatsapp.ts, test/repositories/whatsapp-conversa.test.ts
- Esforço: alto
- Notas: histórico por número (duas grafias) ou por lead (todos os telefones + `lead_id`), 200 mais recentes devolvidas em ordem cronológica, campos legados (ASM-042); não lidas agrupadas por lead ou número normalizado (ASM-045), só recebidas com `lida_em` nula; marcar como lida idempotente devolvendo a contagem; `registrarMensagemEnviada` grava a linha `enviada` ligando ao lead pelo número. Mensagem nova do webhook nasce com `lida_em` nula (AC-159). Depende de T-075 (mesmo arquivo).

## T-077 — Instância WhatsApp da empresa lida do Postgres novo [concluida]
- Refs: AC-144
- Arquivos: src/repositories/whatsapp-instancia.ts, test/repositories/whatsapp-instancia.test.ts
- Esforço: baixo
- Notas: lê `evolution_instance_name` de `empresa_configuracoes` via `comTenant` (ASM-040), sem Supabase; devolve `null` quando não cadastrada. `evolution-server.ts` legado fica para config/qrcode/status.

## T-078 — Rota POST /api/whatsapp/send [concluida]
- Refs: US-043, US-044, AC-135, AC-136, AC-137, AC-138, AC-139, AC-140, AC-141, AC-143, AC-144, AC-145, AC-146
- Arquivos: src/app/api/whatsapp/send/route.ts, test/support/evolution-falsa.ts, test/api/whatsapp-send.test.ts
- Esforço: alto
- Notas: reescreve a rota legada em Supabase. Ordem: sessão (401) → corpo (400) → destino (lead 404 / telefone 404 / sem telefone 422, ou número avulso) → instância (409) → Evolution fora da transação (502/422, ASM-041) → grava `enviada` ligada ao lead (AC-142 via T-075/T-076). Resposta `{ success, messageId, mensagemId }` (ASM-042). A Evolution nos testes é um servidor HTTP falso local (ASM-040); AC-146 prova que card, versão, cadência e eventos não mudam. Depende de T-076 e T-077.

## T-079 — Rota GET /api/whatsapp/messages [concluida]
- Refs: US-045, AC-147, AC-148, AC-149, AC-150, AC-151, AC-152
- Arquivos: src/app/api/whatsapp/messages/route.ts, test/api/whatsapp-messages.test.ts
- Esforço: medio
- Notas: reescreve a rota legada. Sessão (401) → `numero` ou `leadId` válidos (400) → repositório de T-076. `leadId` de outra empresa devolve lista vazia, sem 404. Remove o uso de Supabase desta rota. Depende de T-076.

## T-080 — Rotas GET /api/whatsapp/unread e POST /api/whatsapp/lidas [pendente]
- Refs: US-046, AC-153, AC-154, AC-155, AC-156, AC-157, AC-158, AC-159
- Arquivos: src/app/api/whatsapp/unread/route.ts, src/app/api/whatsapp/lidas/route.ts, test/api/whatsapp-nao-lidas.test.ts
- Esforço: medio
- Notas: `unread` passa a responder 401 sem sessão (o legado devolvia lista vazia) e deixa de usar o corte de 7 dias; `lidas` recebe `{ leadId }` ou `{ numero }` e devolve `{ marcadas }`. AC-153 também provado pela rota (virada sem não lidas). AC-159 pelo webhook real (T-069). Depende de T-076.
