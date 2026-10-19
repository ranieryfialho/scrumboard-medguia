# Tasks: Fase3 etl supabase

> feature: fase3-etl-supabase

<!--
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - `Refs:` = histórias/critérios que a tarefa atende; `Arquivos:` separados por vírgula.
  - Uma tarefa só vira [concluida] com prova PASS de `onp-spec verify`.
  Status: pendente | em-andamento | concluida
-->

## T-108 — Base do ETL: leitor da origem, mascaramento de segredos e contexto de execução [concluida]
- Refs: AC-266, AC-267, AC-268, AC-270
- Arquivos: src/etl/supabase/origem.ts, src/etl/comum.ts, test/etl/comum.test.ts
- Notas: define o contrato que as tarefas seguintes usam (ler origem, registrar em `migracao_registros`, dry-run, transação única). Leitura por conexão direta somente leitura (Q-027).

## T-109 — Migrar empresas e usuários [concluida]
- Refs: US-069, AC-252, AC-253, AC-254, AC-255, AC-271
- Arquivos: src/etl/supabase/identidade.ts, test/etl/identidade.test.ts
- Notas: preserva UUID; papel conforme ASM-081; sem credencial de senha.

## T-110 — Migrar leads como lead + card [concluida]
- Refs: US-070, AC-256, AC-257, AC-258, AC-259, AC-260, AC-272
- Arquivos: src/etl/supabase/leads.ts, test/etl/leads.test.ts
- Notas: cria o motivo "Desqualificado (migração)" como sistêmico; evento `migrado_de` por card; "Em contato" vai para a fila de revisão e o arquivo de decisões cria o card (AC-259, AC-272).

## T-111 — Migrar campanhas e envios [concluida]
- Refs: US-071, AC-261, AC-262
- Arquivos: src/etl/supabase/campanhas.ts, test/etl/campanhas.test.ts
- Notas: campanha migra FINALIZADA e sem envio PENDENTE (Q-029).

## T-112 — Migrar mensagens de WhatsApp e configurações das empresas [concluida]
- Refs: US-072, US-073, AC-263, AC-264, AC-265
- Arquivos: src/etl/supabase/mensagens-config.ts, test/etl/mensagens-config.test.ts
- Notas: mensagem sem lead migra sem vínculo; configuração texto→jsonb com saída mascarada.

## T-113 — Orquestrador e comando do ETL com simulação e relatório [pendente]

- Refs: US-074, AC-267, AC-268, AC-269, AC-270
- Arquivos: src/etl/supabase/executar.ts, scripts/etl-supabase.ts, test/etl/executar.test.ts
- Notas: roda as etapas na ordem (empresas → usuários → leads → campanhas → mensagens/config) numa transação; depende de T-108 a T-112.
