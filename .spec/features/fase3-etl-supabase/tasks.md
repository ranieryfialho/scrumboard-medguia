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

## T-113 — Orquestrador e comando do ETL com simulação e relatório [concluida]
- Refs: US-074, AC-267, AC-268, AC-269, AC-270
- Arquivos: src/etl/supabase/executar.ts, scripts/etl-supabase.ts, test/etl/executar.test.ts
- Notas: roda as etapas na ordem (empresas → usuários → leads → campanhas → mensagens/config) numa transação; depende de T-108 a T-112.

## T-138 — Origem dos usuários configurável (view em vez de auth.users) [concluida]
- Refs: US-069, AC-340, AC-341
- Arquivos: src/etl/supabase/origem.ts, scripts/etl-supabase.ts, test/etl/origem-usuarios.test.ts
- Notas: `SUPABASE_LEGADO_TABELA_USUARIOS` (padrão `auth.users`), validada por regex de identificador (`schema.nome`) porque vem de variável de ambiente e entra no texto SQL. A consulta continua com os mesmos aliases (`nome`, `perfil`, `ativo`, `empresa_id`, `is_super_admin`). Ver ASM-121.

## T-139 — Leitores da origem contra o schema real do legado [concluida]
- Refs: US-074, AC-342, AC-343, AC-344
- Arquivos: src/etl/supabase/leitura-origem.ts, scripts/etl-supabase.ts, test/etl/leitura-origem.test.ts, test/etl/fixtures/legado-supabase.sql
- Notas: move para `leitura-origem.ts` os leitores de empresas, leads, campanhas, envios, mensagens e configurações (hoje dentro do script) e corrige os dois que divergem do banco real: envios (empresa via `JOIN campanhas`, tentativas 0) e mensagens (`created_at`, `lida_em = created_at`). O teste roda num Postgres efêmero com o schema real do Supabase do CRM (colunas conferidas em 22/10 pelo `information_schema`), em vez de uma tabela inventada. Ver ASM-122, Q-039, Q-040.
