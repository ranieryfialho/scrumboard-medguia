# Tasks: Fase 5 — Ações rápidas

> feature: fase5-acoes-rapidas

## T-229 — Cancelar reunião: transição no funil, repositório e API [concluida]
- Refs: AC-640, AC-641, AC-642, AC-644
- Arquivos: drizzle/0017_transicao_cancelar_reuniao.sql, src/repositories/reunioes-acoes.ts, src/app/api/reunioes/[id]/cancelar/route.ts
- Notas: transição 8→6 por migration de dados; apagar a reunião só depois de mover o card; atualizar o teste do grafo (seeds, AC-030)

## T-230 — Botão Cancelar na agenda [concluida]
- Refs: AC-643
- Arquivos: src/components/agenda/cartao-reuniao.tsx, src/components/agenda/agenda-tela.tsx, src/components/agenda/acoes-reuniao.ts
- Notas: confirmação antes de cancelar

## T-231 — Ligar: "Ligar Agora" e "Ligar para Clínica" [concluida]
- Refs: AC-645, AC-646
- Arquivos: src/app/api/oportunidades/[id]/route.ts, src/components/pipeline/card/molde-do-card.tsx, src/app/(app)/pipeline/[id]/conversa/page.tsx, src/lib/telefone.ts
- Notas: a rota do card passa a devolver `telefoneE164`

## T-232 — Promover número avulso: repositório e API [concluida]
- Refs: AC-647, AC-648, AC-649
- Arquivos: src/repositories/whatsapp-promover.ts, src/app/api/whatsapp/promover/route.ts
- Notas: usa `criarLeadComOportunidade`; religa as mensagens com `lead_id` nulo do número

## T-233 — Promover número avulso: botão nas telas do WhatsApp [concluida]
- Refs: AC-650
- Arquivos: src/components/whatsapp/promover-lead.tsx, src/components/whatsapp/contexto-card.tsx, src/components/whatsapp/nova-mensagem.tsx
- Notas: remove o "Promover a Lead (em breve)" genérico

## T-234 — Testes dos critérios de aceite [concluida]
- Refs: AC-640, AC-641, AC-642, AC-643, AC-644, AC-645, AC-646, AC-647, AC-648, AC-649, AC-650
- Arquivos: test/api/reunioes-cancelar.test.ts, test/api/whatsapp-promover.test.ts, test/components/agenda/agenda-tela.test.tsx, test/components/pipeline/ligar-agora.test.tsx, test/components/whatsapp/promover-lead.test.tsx, test/components/whatsapp/nova-mensagem.test.tsx, test/components/pipeline/conversa-tela.test.tsx, test/lib/telefone.test.ts
- Notas: o teste do grafo (test/db/seeds.test.ts) é ajustado, não substituído
