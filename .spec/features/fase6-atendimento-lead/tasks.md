# Tasks: Fase 6 — Velocidade do 1º contato (corrido e em horário comercial)

> feature: fase6-atendimento-lead

## T-334 — Módulo puro de horário comercial [em-andamento]
- Refs: AC-805, AC-806, AC-811
- Arquivos: src/domain/atendimento/horario-comercial.ts
- Notas: `HORARIO_PADRAO`, `validarHorario(valor)`, `minutosUteis(inicio, fim, horario)` em `America/Sao_Paulo` (reaproveitar `src/domain/cadencia/turno.ts` para a data local), `resumirEsperas(minutos[])` com média, mediana e as quatro faixas

## T-335 — Repositório e API do horário de atendimento [em-andamento]
- Refs: AC-809, AC-810, AC-811
- Arquivos: src/repositories/horario-atendimento.ts, src/app/api/configuracoes/horario-atendimento/route.ts, src/lib/auth/rotas.ts
- Notas: GET para qualquer sessão; PUT para gerente+; upsert em `empresa_configuracoes` (chave `horario_atendimento`); 400 `HORARIO_INVALIDO`

## T-336 — Tela "Horário de atendimento" e item de menu [em-andamento]
- Refs: AC-809, AC-811
- Arquivos: src/components/admin/horario-atendimento.tsx, src/app/(app)/configuracoes/horario-atendimento/page.tsx, src/components/shell/menu-config.ts, test/components/shell/casca.test.tsx
- Notas: seguir `src/components/admin/metas.tsx`; atualizar a contagem de itens do menu no teste da casca

## T-337 — Indicador de velocidade no repositório de marketing [em-andamento]
- Refs: AC-804, AC-805, AC-806, AC-807, AC-808, AC-812
- Arquivos: src/repositories/analises-marketing.ts
- Notas: a consulta traz (entrada, 1ª mensagem enviada em ou depois da entrada) por lead do período; o módulo de T-334 calcula os dois modos; `velocidadeMediaMinutos` é substituído por `velocidade: { corrido, comercial }` (média, mediana, n, faixas)

## T-338 — Cartão de velocidade no relatório de marketing [em-andamento]
- Refs: AC-804, AC-806, AC-807
- Arquivos: src/components/analises/relatorio-marketing.tsx
- Notas: dois blocos (corrido e comercial), "N leads", faixas, cor neutra; usa o período escolhido da feature fase6-periodo-personalizado

## T-339 — Testes dos critérios de aceite [em-andamento]
- Refs: AC-804, AC-805, AC-806, AC-807, AC-808, AC-809, AC-810, AC-811, AC-812
- Arquivos: test/domain/atendimento/horario-comercial.test.ts, test/api/horario-atendimento.test.ts, test/repositories/analises-marketing-velocidade.test.ts, test/components/admin/horario-atendimento.test.tsx, test/components/analises/velocidade-contato.test.tsx
- Notas: o de repositório segue o harness de Postgres efêmero de `test/repositories/`
