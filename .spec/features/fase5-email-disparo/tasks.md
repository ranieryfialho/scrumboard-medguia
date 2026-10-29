# Tasks: Fase 5 — E-mail das campanhas, parte 2 (disparo)

> feature: fase5-email-disparo

## T-264 — Migration e envio pelo Resend com tags [pendente]

- Refs: AC-701, AC-703
- Arquivos: drizzle/0024_envios_campanha_erro.sql, src/db/schema/legado.ts, src/lib/email/campanha-envio.ts
- Notas: coluna `erro` e índice parcial dos pendentes; o transporte é uma função injetável que manda `from`, `to`, `subject`, `html` e as tags `envio_id` e `empresa_id`

## T-265 — Repositório do disparo: pegar, registrar, finalizar, recuperar [pendente]

- Refs: AC-701, AC-703, AC-704, AC-705, AC-706, AC-707, AC-722
- Arquivos: src/repositories/campanhas-envio.ts
- Notas: `FOR UPDATE SKIP LOCKED` na mesma transação que marca `ENVIANDO`; só campanhas `PROCESSANDO`; finalizar sem pendentes; `ENVIANDO` há mais de 10 min vira `ERRO` `INTERROMPIDO`; descadastrado na hora do envio vira `DESCADASTRADO`

## T-266 — Worker de e-mail e ponto de entrada [pendente]

- Refs: AC-701, AC-702, AC-704, AC-708
- Arquivos: src/lib/email/disparo-worker.ts, src/worker/email.ts, package.json, docker-compose.yml
- Notas: relógio, sono e transporte injetáveis; uma empresa por vez com falhas isoladas; script `worker:email` e serviço `crm-worker-email`

## T-267 — Pausar, retomar e proteções [pendente]

- Refs: AC-709, AC-710, AC-711, AC-713
- Arquivos: src/repositories/campanhas.ts, src/app/api/campanhas/[id]/pausar/route.ts, src/app/api/campanhas/[id]/retomar/route.ts, src/app/api/campanhas/[id]/iniciar/route.ts, src/app/api/campanhas/[id]/reenviar-falhas/route.ts, src/app/api/campanhas/[id]/route.ts
- Notas: UPDATE condicional atômico nas duas direções; iniciar confere só se há chave (sem decifrar); PAUSADA não finaliza, não exclui e não reenvia falhas

## T-268 — Telas: pausar, retomar, motivo da falha e aviso de chave [pendente]

- Refs: AC-712, AC-713
- Arquivos: src/components/campanhas/detalhe-campanha.tsx, src/components/campanhas/lista-campanhas.tsx, src/components/campanhas/comum.ts
- Notas: texto em português para cada motivo de erro; atalho para `/configuracoes/email`

## T-269 — Testes dos critérios de aceite [pendente]

- Refs: AC-701, AC-702, AC-703, AC-704, AC-705, AC-706, AC-707, AC-708, AC-709, AC-710, AC-711, AC-712, AC-713, AC-722
- Arquivos: test/api/campanhas-disparo.test.ts, test/api/campanhas-pausa.test.ts, test/worker/email.test.ts, test/components/campanhas/pausa.test.tsx
- Notas: o worker é testado com Resend, relógio e sono falsos (como o lote de WhatsApp)
