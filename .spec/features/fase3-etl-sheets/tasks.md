# Tasks: Fase3 etl sheets

> feature: fase3-etl-sheets

<!--
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - `Refs:` = histórias/critérios que a tarefa atende; `Arquivos:` separados por vírgula.
  - Uma tarefa só vira [concluida] com prova PASS de `onp-spec verify`.
  Status: pendente | em-andamento | concluida
-->

## T-114 — Leitor das abas (somente leitura) e mapeamento de colunas por aba [concluida]
- Refs: US-075, AC-273, AC-274, AC-291
- Arquivos: src/etl/sheets/leitor.ts, test/etl/sheets-leitor.test.ts
- Notas: reproduz as regras de `src/app/api/sheets/route.ts`; escopo somente leitura (`spreadsheets.readonly`).

## T-115 — Normalização de telefone e datas [concluida]
- Refs: US-076, AC-277, AC-278
- Arquivos: src/etl/sheets/normalizar.ts, test/etl/sheets-normalizar.test.ts
- Notas: E.164 com +55 padrão (ASM-089); data com fuso ISO e `dd/mm/aaaa` (ASM-088).

## T-116 — Deduplicação entre abas e resolução de conflito [pendente]

- Refs: US-075, AC-275, AC-276
- Arquivos: src/etl/sheets/dedupe.ts, test/etl/sheets-dedupe.test.ts
- Notas: chave = id da Meta; desempate por `data_alteracao`, depois status mais avançado.

## T-117 — Mapa de status para etapa e motivo de perda [pendente]

- Refs: US-077, AC-279, AC-280, AC-281, AC-282, AC-283
- Arquivos: src/etl/sheets/status.ts, test/etl/sheets-status.test.ts
- Notas: segue RFC-001 §6.8; Recontato e Aguardando Ativação sem data vão para revisão (Q-031).

## T-118 — Importar leads, cards, origem e eventos `migrado_de` [pendente]

- Refs: US-078, AC-284, AC-285, AC-293
- Arquivos: src/etl/sheets/leads.ts, test/etl/sheets-leads.test.ts
- Notas: depende de T-114 a T-117; grava em `migracao_registros` com origem `sheets`.

## T-119 — Exportar a Agenda em CSV e ligar mensagens aos leads pelo telefone [pendente]

- Refs: US-079, US-080, AC-286, AC-287, AC-288
- Arquivos: src/etl/sheets/agenda-mensagens.ts, test/etl/sheets-agenda-mensagens.test.ts
- Notas: nada é criado a partir da Agenda; vínculo só quando o telefone tem um único lead.

## T-120 — Orquestrador do ETL do Sheets com simulação e relatório [pendente]

- Refs: US-081, AC-289, AC-290, AC-292
- Arquivos: src/etl/sheets/executar.ts, scripts/etl-sheets.ts, test/etl/sheets-executar.test.ts
- Notas: depende de T-114 a T-119; reaproveita o contexto de execução de T-108.
