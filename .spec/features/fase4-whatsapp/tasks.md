# Tasks: Fase4 whatsapp

> feature: fase4-whatsapp

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

## T-189 — API de conversas e "marcar todas como lidas" (servidor) [concluida]
- Refs: AC-500, AC-501, AC-505, AC-506
- Arquivos: src/repositories/whatsapp-conversas.ts, src/app/api/whatsapp/conversas/route.ts, src/app/api/whatsapp/lidas/route.ts, test/api/whatsapp-conversas.test.ts
- Esforço: alto
- Notas: `GET /api/whatsapp/conversas?filtro=nao_lidas|minhas|todas|avulsas&busca=&responsavelId=&limite=` agrupa `whatsapp_mensagens` por lead ou número canônico (ASM-171, `chaveCanonicaNumero`/`variantesNumero` de `whatsapp.ts`), traz nome, telefone, última mensagem/horário, não lidas, etapa, valor e responsável do card, contagens das três abas e `resumo` (conversas ativas hoje, não lidas, mensagens de hoje recebidas/enviadas, ASM-174). Visibilidade por papel (ASM-172/173). `POST /api/whatsapp/lidas` passa a aceitar `{ todas: true }` (devolve quantas) sem mudar os outros formatos.

## T-190 — Caixa de entrada (tela) [concluida]
- Refs: US-124, AC-499, AC-502, AC-503, AC-504, AC-507, AC-508, AC-509
- Arquivos: src/app/(app)/whatsapp/page.tsx, src/components/whatsapp/caixa-de-entrada.tsx, src/components/whatsapp/lista-conversas.tsx, src/components/whatsapp/painel-conversa.tsx, src/components/whatsapp/contexto-card.tsx, src/components/whatsapp/comum.ts, test/components/whatsapp/caixa-de-entrada.test.tsx
- Esforço: xalto
- Notas: fonte `docs/ui/stitch_medcrm_interface_design/16*`. Usa `EVENTO_CONTADORES_MUDARAM` de `use-contadores.ts` ao ler/marcar. Aceita `?numero=` e `?leadId=` para abrir a conversa (vindo da tela de avulsa). Depende de T-189.

## T-191 — Nova mensagem avulsa (tela) [concluida]
- Refs: US-125, AC-510, AC-511, AC-512, AC-513, AC-514, AC-515, AC-516
- Arquivos: src/app/(app)/whatsapp/nova/page.tsx, src/components/whatsapp/nova-mensagem.tsx, test/components/whatsapp/nova-mensagem.test.tsx
- Esforço: alto
- Notas: fonte `17*`. Valida o número com `normalizarNumero` (`src/domain/whatsapp/numero.ts`). Modelos de `GET /api/whatsapp/config` (ASM-178). Últimos disparos de `GET /api/whatsapp/conversas?filtro=avulsas&limite=4`. Depende de T-189.

## T-192 — Conexão e QR code (tela) [concluida]
- Refs: US-126, AC-517, AC-518, AC-519, AC-520, AC-521, AC-522
- Arquivos: src/app/(app)/whatsapp/conexao/page.tsx, src/components/whatsapp/conexao-qr.tsx, test/components/whatsapp/conexao-qr.test.tsx
- Esforço: alto
- Notas: fonte `18*`. Usa `GET /api/whatsapp/status`, `GET /api/whatsapp/qrcode` e `resumo` de T-189 (mensagens de hoje). Polling de 3 s só enquanto mostra QR; 15 s o resto. Depende de T-189.

## T-193 — Configuração: API estendida (servidor) [concluida]
- Refs: AC-524
- Arquivos: src/app/api/whatsapp/config/route.ts, src/lib/whatsapp/webhook-url.ts, test/api/whatsapp-config-tela.test.ts
- Esforço: medio
- Notas: `GET /api/whatsapp/config` mantém `{ empresaId, config }` e acrescenta `servidor { urlBase, chaveConfigurada }`, `webhookUrl` (segredo mascarado) e `eventos` (ASM-176). Os testes de `fase2c-whatsapp-conexao` têm que continuar passando sem edição.

## T-194 — Configuração da instância (tela) [concluida]
- Refs: US-127, AC-523, AC-525, AC-526, AC-527, AC-528, AC-529
- Arquivos: src/app/(app)/whatsapp/configuracao/page.tsx, src/components/whatsapp/configuracao-evolution.tsx, test/components/whatsapp/configuracao-evolution.test.tsx
- Esforço: alto
- Notas: fonte `19*`. Depende de T-193.

## T-195 — Menu, navegação sem 404 e estados [concluida]
- Refs: US-128, AC-530, AC-531
- Arquivos: src/components/shell/menu-config.ts, src/components/whatsapp/estados.tsx, test/auth/rotas-whatsapp.test.ts
- Esforço: medio
- Notas: acrescenta "Conexão & QR Code" e "Configuração Evolution" ao grupo Comunicação; `/whatsapp/nova` marca "WhatsApp Inbox" (ASM-180; conferir `encontrarItemAtivo`). Os testes do menu das features anteriores têm que seguir passando (atualizar só a lista esperada se ela for exata, sem enfraquecer). Depende das demais.
