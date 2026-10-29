# Tasks: Fase 5 — Motivos de perda por empresa

> feature: fase5-motivos-por-empresa

## T-240 — Migration e repositório de motivos por empresa [concluida]
- Refs: AC-660, AC-661, AC-662, AC-663, AC-666
- Arquivos: drizzle/0019_motivos_perda_por_empresa.sql, src/db/schema/pipeline.ts, src/repositories/motivos-perda-admin.ts, src/repositories/motivos-perda.ts
- Notas: `empresa_id` anulável; índice único global vira dois parciais (globais por nome; por empresa e nome minúsculo); `motivos-perda.ts` guarda a regra "global ou da empresa" usada pelas listas e pelos guards

## T-241 — API de administração e lista de escolha [concluida]
- Refs: AC-660, AC-661, AC-662, AC-663, AC-664
- Arquivos: src/app/api/configuracoes/motivos-perda/route.ts, src/app/api/configuracoes/motivos-perda/[id]/route.ts, src/app/api/motivos-perda/route.ts
- Notas: POST e PATCH passam a ser gerente+ (super admin segue alterando os globais não sistêmicos)

## T-242 — Guard do motivo na perda e no arquivamento em lote [concluida]
- Refs: AC-665
- Arquivos: src/repositories/transicao-card.ts, src/app/api/oportunidades/lote/arquivar/route.ts
- Notas: motivo de outra empresa dá `MOTIVO_INVALIDO`; a transição avulsa não passa a exigir motivo ativo

## T-243 — Tela de motivos de perda [concluida]
- Refs: AC-662, AC-663
- Arquivos: src/components/admin/motivos-perda.tsx, src/components/admin/comum.ts
- Notas: rótulos Sistêmico, Da rede, Da empresa; "Novo motivo" para gerente+

## T-244 — Testes dos critérios de aceite [concluida]
- Refs: AC-660, AC-661, AC-662, AC-663, AC-664, AC-665, AC-666
- Arquivos: test/api/motivos-por-empresa.test.ts, test/db/motivos-por-empresa.test.ts, test/components/admin/motivos-perda.test.tsx
- Notas: ajustar os testes antigos de motivos (admin, rota de escolha e tela) ao novo comportamento
