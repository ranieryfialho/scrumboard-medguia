# Tasks: Fase 2c — WhatsApp conexão

> feature: fase2c-whatsapp-conexao

## T-081 — Migration 0010: nome de instância único entre empresas [concluida]
- Refs: AC-173
- Arquivos: drizzle/0010_whatsapp_conexao.sql, drizzle/meta/_journal.json, src/db/schema/identidade.ts, test/db/whatsapp-conexao-migration.test.ts
- Esforço: baixo
- Notas: índice único parcial sobre `valor` onde `chave = 'evolution_instance_name'` (ASM-051). A RLS esconde as outras empresas, então a unicidade só é garantida pelo banco; o teste prova que duas empresas não gravam o mesmo nome e que a mesma empresa regrava o seu.

## T-082 — Servidor HTTP falso da Evolution cobre criar, webhook, conectar e estado [concluida]
- Refs: AC-176, AC-180, AC-184, AC-185, AC-186
- Arquivos: test/support/evolution-falsa.ts
- Esforço: baixo
- Notas: acrescenta `/instance/create`, `/webhook/set/:instancia`, `/instance/connect/:instancia` e `/instance/connectionState/:instancia` ao servidor existente (ASM-054), gravando cada chamada em ordem (inclusive o corpo do webhook) e permitindo comportamentos de falha por endpoint. Não pode quebrar `whatsapp-send.test.ts`.

## T-083 — Validação da configuração e cliente Evolution que reporta falha do webhook [concluida]
- Refs: AC-174, AC-177, AC-185, AC-186
- Arquivos: src/domain/whatsapp/config.ts, src/lib/evolution-api.ts, test/domain/whatsapp-config.test.ts
- Esforço: medio
- Notas: função pura que valida o corpo (objeto, valores texto, nome 1–64 `[A-Za-z0-9_-]`, ASM-052) e filtra as seis chaves permitidas (ASM-050). Em `evolution-api.ts`, `setWebhook` passa a devolver `true/false` conforme a Evolution aceitou (hoje engole a resposta) sem mudar `sendTextMessage`; `getInstanceStatus` e `createInstance` continuam compatíveis com `send`.

## T-084 — Repositório da configuração e do segredo do webhook [concluida]
- Refs: AC-168, AC-169, AC-170, AC-172, AC-173, AC-182
- Arquivos: src/repositories/whatsapp-config.ts, test/repositories/whatsapp-config.test.ts
- Esforço: alto
- Notas: tudo por `comTenant`. `lerConfiguracao` devolve só as chaves permitidas; `salvarConfiguracao` faz upsert numa transação e traduz 23505 em erro de domínio `INSTANCIA_EM_USO` (ASM-056); `obterOuCriarSegredoWebhook` gera ≥32 bytes aleatórios se faltar, reutiliza se existir e é seguro sob duas chamadas simultâneas. Depende de T-081 e T-083.

## T-085 — Rota GET e POST /api/whatsapp/config [pendente]
- Refs: US-048, US-049, AC-167, AC-168, AC-169, AC-170, AC-171, AC-172, AC-173, AC-174, AC-183
- Arquivos: src/app/api/whatsapp/config/route.ts, test/api/whatsapp-config.test.ts
- Esforço: alto
- Notas: reescreve a rota legada. Sessão (401) → papel no POST (403, ASM-048) → corpo (400) → repositório (409). Resposta `{ empresaId, config }` e `{ success: true }` (nomes do legado). Depende de T-083 e T-084.

## T-086 — Rota GET /api/whatsapp/status [pendente]
- Refs: US-050, AC-167, AC-175, AC-176, AC-177, AC-183
- Arquivos: src/app/api/whatsapp/status/route.ts, test/api/whatsapp-status.test.ts
- Esforço: medio
- Notas: reescreve a rota legada com `buscarNomeInstancia` (já existe) e `comTenant`; qualquer papel consulta. Erro da Evolution vira `state: "close"` (ASM-055). Depende de T-082.

## T-087 — Rota GET /api/whatsapp/qrcode (conectar e status) e fim do legado em Supabase [pendente]
- Refs: US-051, AC-167, AC-175, AC-176, AC-178, AC-179, AC-180, AC-181, AC-182, AC-183, AC-184, AC-185, AC-186
- Arquivos: src/app/api/whatsapp/qrcode/route.ts, src/lib/evolution-server.ts, test/api/whatsapp-qrcode.test.ts
- Esforço: alto
- Notas: `?action=status` igual ao status (qualquer papel); o fluxo completo exige MASTER/GERENTE/super admin (403), instância (409), cria instância (502 se falhar sem 409), grava o segredo só depois que a criação deu certo (AC-186), registra o webhook com `empresa_id` e `secret` (ASM-053) e devolve o QR com `webhookRegistrado`. Apaga `src/lib/evolution-server.ts` (último uso de Supabase nas rotas de WhatsApp). Depende de T-082, T-083 e T-084.
