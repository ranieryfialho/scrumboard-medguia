# Tasks: Fase 5 — WhatsApp em lote, parte 2 (disparo)

> feature: fase5-whatsapp-lote-disparo

## T-250 — Migration e repositório de lotes [concluida]
- Refs: AC-677, AC-678, AC-683, AC-684
- Arquivos: drizzle/0021_whatsapp_lotes.sql, src/db/schema/legado.ts, src/repositories/whatsapp-lote.ts
- Notas: `whatsapp_lotes` e `whatsapp_lote_itens` com RLS por empresa; criar (prévia recalculada no servidor), listar, detalhar e cancelar

## T-251 — Worker de envio e rota do cron [concluida]
- Refs: AC-679, AC-680, AC-681, AC-682
- Arquivos: src/lib/whatsapp/lote-worker.ts, src/app/api/cron/whatsapp-lote/route.ts
- Notas: envio injetável para teste; um item por vez por lote, `proximo_envio_em` = envio + sorteio de 15 a 45 s; reconfere o consentimento

## T-252 — API de lotes (criar, listar, detalhar, cancelar) e regras de acesso [concluida]
- Refs: AC-677, AC-678, AC-683, AC-684
- Arquivos: src/app/api/whatsapp/lote/route.ts, src/app/api/whatsapp/lote/[id]/route.ts, src/app/api/whatsapp/lote/[id]/cancelar/route.ts, src/app/api/whatsapp/lote/previa/route.ts, src/repositories/whatsapp-lote-previa.ts, src/lib/auth/rotas.ts
- Notas: gerente+; a prévia passa a aceitar `oportunidadeIds`

## T-253 — Diálogo de disparo na lista e tela de acompanhamento [concluida]
- Refs: AC-685, AC-686
- Arquivos: src/components/pipeline/lote/barra-lote.tsx, src/components/pipeline/lote/dialogo-whatsapp-lote.tsx, src/app/(app)/pipeline/lista/page.tsx, src/components/whatsapp/lotes.tsx, src/app/(app)/whatsapp/lote/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: o item de menu tem papel mínimo GERENTE (novo campo no item)

## T-254 — Testes dos critérios de aceite [concluida]
- Refs: AC-677, AC-678, AC-679, AC-680, AC-681, AC-682, AC-683, AC-684, AC-685, AC-686
- Arquivos: test/api/whatsapp-lote.test.ts, test/api/whatsapp-lote-worker.test.ts, test/components/pipeline/dialogo-whatsapp-lote.test.tsx, test/components/whatsapp/lotes.test.tsx, test/auth/rotas-lote.test.ts
- Notas: o worker é testado com envio e relógio falsos (sem Evolution real)
