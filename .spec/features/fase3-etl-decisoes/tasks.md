# Tasks: Fase3 etl decisoes

> feature: fase3-etl-decisoes

<!--
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - `Refs:` = histórias/critérios que a tarefa atende; `Arquivos:` separados por vírgula.
  - Uma tarefa só vira [concluida] com prova PASS de `onp-spec verify`.
  Status: pendente | em-andamento | concluida
-->

## T-124 — Planilha de decisões e validador comuns [concluida]
- Refs: US-086, US-088, AC-307, AC-308, AC-312, AC-313, AC-314
- Arquivos: src/etl/decisoes.ts, test/etl/decisoes.test.ts
- Esforço: alto
- Notas: `gerarCsvFilaRevisao(itens)` e `lerCsvDecisoes(texto)` (UTF-8 com BOM, separador `;`, aspas RFC 4180). `validarDecisao(linha, { etapas, motivosPerda, agora })` devolve `{ tipo: 'etapa', etapaId, proximaAcaoEm?, valor?, motivoPerdaId? } | { tipo: 'ignorar' } | { tipo: 'recusada', motivo }`, aplicando as exigências das etapas (`exige_proxima_acao`, `exige_valor`, `exige_motivo`, lidas da tabela `etapas`, nunca fixas no código) e a regra de data vencida (ASM-103, ASM-106). Etapa por nome (sem acento/maiúsculas) ou número. Função pura; não toca no banco além de receber as listas.

## T-125 — ETL do Sheets aplica as decisões [concluida]
- Refs: US-087, AC-307, AC-309, AC-310, AC-311, AC-317
- Arquivos: src/etl/sheets/leads.ts, src/etl/sheets/executar.ts, scripts/etl-sheets.ts, test/etl/sheets-decisoes.test.ts
- Esforço: alto
- Notas: depende de T-124. A decisão é casada pelo id da Meta (`metaId`). Lead decidido usa o mesmo caminho de criação do lead automático (origem comercial, `dados`, `migrado_de`) e grava `proxima_acao_em`/`valor`/`motivo_perda_id`. `ignorar` registra em `migracao_registros` com entidade `lead_ignorado`. Decisão recusada volta para `revisao` com o motivo. Script ganha `--decisoes` e `--fila-revisao`; relatório ganha decisões aplicadas/ignoradas/recusadas e a conta por aba continua fechando.

## T-126 — ETLs do Supabase e da LP usam a mesma planilha de decisões [concluida]
- Refs: US-089, AC-307, AC-315, AC-316, AC-317
- Arquivos: src/etl/supabase/leads.ts, src/etl/supabase/executar.ts, scripts/etl-supabase.ts, src/etl/lp/leads.ts, src/etl/lp/executar.ts, scripts/etl-lp.ts, test/etl/decisoes-supabase-lp.test.ts
- Esforço: alto
- Notas: depende de T-124. Troca o JSON de decisões pelo CSV (ASM-105) nos dois scripts, mantendo os testes existentes de AC-272 e AC-301 passando (o formato `{ etapaId }` continua aceito internamente para etapas sem exigência). Grava `proxima_acao_em`/`valor`/`motivo_perda_id` no card. Decisão recusada volta para a revisão em vez de derrubar a transação.
