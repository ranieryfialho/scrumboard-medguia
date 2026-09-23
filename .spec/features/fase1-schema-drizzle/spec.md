# Spec: Fase1 schema drizzle

> feature: fase1-schema-drizzle
> status: rascunho

## Contexto

O CRM sai do Supabase para um PostgreSQL próprio na VPS (RFC-001 Decisão D2) e o
pipeline comercial é redesenhado do zero sobre um modelo orientado a eventos
(RFC-001 Decisão A2). Esta feature modela esse schema completo em Drizzle —
identidade/tenant, pipeline, operação e as tabelas do Better Auth —, com RLS,
constraints, funções SQL transacionais e seeds, tudo versionado como migrations
reproduzíveis (TDD-001 §4.3, §4.8). É a "Fase 1 — Núcleo / Schema em Drizzle"
do plano de implementação do TDD-001 §6, pré-requisito de tudo o resto da Fase 1
(auth, repositórios e domínio do pipeline dependem do schema existir).

## Histórias

### US-007 — Schema completo modelado e versionado em migrations

Como desenvolvedor, quero todas as tabelas de identidade/tenant, do pipeline e
de operação modeladas em Drizzle e versionadas em migrations, para que o banco
seja reproduzível a partir do repositório, sem tabela nenhuma fora do controle
de versão (TDD-001 §4.3, §4.8).

#### AC-015 — Migrations aplicam o schema completo num Postgres limpo

- **Dado** um Postgres 15 efêmero, vazio, com as roles `crm_migrator`/`crm_app`
  já criadas (padrão `infra/postgres/init/01-databases-and-roles.sql`)
- **Quando** as migrations do drizzle-kit são aplicadas com a role `crm_migrator`
- **Então** todas as tabelas de `empresas`, `empresa_configuracoes`, `usuarios`,
  `empresas_usuarios`, `pipeline_etapas`, `pipeline_transicoes`,
  `motivos_perda`, `leads`, `oportunidades`, `cadencia_atividades`,
  `oportunidade_eventos`, `tarefas_agendadas`, `anexos`, `reunioes`,
  `whatsapp_mensagens`, `campanhas`, `envios_campanha`, `cron_execucoes`,
  `importacoes`, `migracao_registros` existem, com as colunas descritas no
  TDD-001 §4.3, e o comando termina com sucesso (exit 0)

#### AC-016 — As tabelas do Better Auth existem no schema

- **Dado** as migrations aplicadas (AC-015)
- **Quando** se inspeciona o schema
- **Então** as tabelas geradas pelo adaptador Drizzle do Better Auth (conta,
  sessão, token de verificação) existem, prontas para a biblioteca conectar —
  sem exigir que login, convite ou reset funcionem de fato (isso é da feature
  de auth/RBAC, fora do escopo aqui)

#### AC-017 — Migrations reaplicadas não falham nem duplicam nada

- **Dado** as migrations já aplicadas uma vez (AC-015)
- **Quando** o comando de migração roda de novo no mesmo banco
- **Então** ele termina com sucesso sem duplicar tabela, constraint ou seed
  (idempotência do pipeline de migration)

### US-008 — Toda tabela de negócio carrega o tenant

Como responsável pela segurança de dados, quero que nenhuma linha de negócio
exista sem `empresa_id`, para que não haja como um registro escapar do
isolamento por tenant desde a raiz do schema (TDD-001 §4.3, invariante
"Nenhum registro sem tenant").

#### AC-018 — Colunas de tenant são `NOT NULL`

- **Dado** o schema aplicado
- **Quando** se tenta inserir uma linha em `leads`, `oportunidades`,
  `cadencia_atividades`, `oportunidade_eventos`, `tarefas_agendadas`,
  `anexos`, `reunioes`, `whatsapp_mensagens`, `campanhas`, `envios_campanha`
  ou `empresa_configuracoes` sem `empresa_id`
- **Então** o banco rejeita a inserção com violação de `NOT NULL`

### US-009 — Isolamento multi-tenant garantido pelo banco, não só pela aplicação

Como responsável pela segurança de dados, quero Row-Level Security como última
linha de defesa do isolamento por tenant, para que mesmo uma consulta da
aplicação sem filtro de empresa não vaze dados de outro tenant (TDD-001 §4.7,
defesa em profundidade D-S3; RFC-001 risco "Vazamento entre tenants").

#### AC-019 — RLS ativo em toda tabela com `empresa_id`

- **Dado** o schema aplicado
- **Quando** se consulta o catálogo do Postgres (`pg_tables`/`pg_policies`)
- **Então** toda tabela listada em AC-018 tem RLS habilitado (`ENABLE ROW
  LEVEL SECURITY`) com uma policy filtrando por
  `empresa_id = current_setting('app.empresa_id')::uuid`

#### AC-020 — Sem `app.empresa_id` definido, a role de runtime não lê nem escreve linha nenhuma

- **Dado** uma conexão autenticada como `crm_app`, **sem** que
  `SET LOCAL app.empresa_id` tenha sido chamado na transação
- **Quando** essa conexão tenta `SELECT` ou `INSERT` em qualquer tabela
  coberta por RLS (AC-019)
- **Então** a operação não retorna/grava nenhuma linha de outro tenant — o
  RLS falha fechado (nenhum resultado), nunca aberto

### US-010 — Regras do Playbook garantidas por constraint, não só por código

Como responsável pelo produto, quero que as invariantes centrais do pipeline
(valor obrigatório em Proposta, motivo obrigatório em Perdido, próxima ação
obrigatória em certas etapas, sequência de cadência única) sejam garantidas
pelo próprio banco, para que nenhum bug de aplicação futura consiga gravar um
card inválido (TDD-001 §4.3 "Invariantes garantidas no banco").

#### AC-021 — Card não entra em `Proposta` sem `valor > 0`

- **Dado** uma oportunidade sem valor definido (`valor` nulo ou ≤ 0)
- **Quando** uma escrita tenta colocá-la na etapa `Proposta`
- **Então** o banco rejeita a escrita por violação de `CHECK`

#### AC-022 — Card não entra em `Perdido` sem motivo

- **Dado** uma oportunidade sem `motivo_perda_id`
- **Quando** uma escrita tenta colocá-la na etapa `Perdido`
- **Então** o banco rejeita a escrita por violação de `CHECK`

#### AC-023 — Card não entra em etapas de acompanhamento sem próxima ação

- **Dado** uma oportunidade sem `proxima_acao_em` (nula ou no passado)
- **Quando** uma escrita tenta colocá-la em `Follow de longo prazo`,
  `Proposta`, `Teste (Trial)` ou `Negociação`
- **Então** o banco rejeita a escrita por violação de `CHECK`

#### AC-024 — Sequência de cadência é única e limitada por oportunidade

- **Dado** uma oportunidade com uma atividade de cadência já gravada numa
  sequência
- **Quando** uma segunda atividade tenta usar a mesma sequência para a mesma
  oportunidade, ou uma sequência fora de 1–18, ou um dia fora de 1–3
- **Então** o banco rejeita a escrita (`UNIQUE (oportunidade_id, sequencia)` e
  `CHECK` de intervalo)

#### AC-025 — Log de eventos é imutável para a aplicação

- **Dado** um evento já gravado em `oportunidade_eventos`
- **Quando** a role `crm_app` tenta `UPDATE` ou `DELETE` nessa tabela
- **Então** o banco recusa por falta de privilégio (`REVOKE UPDATE, DELETE ON
  oportunidade_eventos FROM crm_app`)

### US-011 — Transição de etapa e conclusão de atividade são atômicas, com lock otimista

Como desenvolvedor, quero que mudar a etapa de um card e concluir uma
atividade de cadência sejam operações atômicas via função SQL, com proteção
contra escrita concorrente perdida, para que o estado e o evento nunca fiquem
dessincronizados e duas edições simultâneas não se sobrescrevam em silêncio
(TDD-001 §4.1, §4.2, função `mover_oportunidade`/`concluir_atividade`).

#### AC-026 — `mover_oportunidade` grava estado e evento juntos, ou nenhum dos dois

- **Dado** uma oportunidade na `version` N
- **Quando** a função `mover_oportunidade` é chamada informando a `version` N
  e a nova etapa
- **Então** a etapa da oportunidade e o evento correspondente em
  `oportunidade_eventos` são gravados na mesma transação, e a `version` da
  oportunidade avança para N+1

#### AC-027 — Escrita com versão desatualizada é rejeitada (lock otimista)

- **Dado** uma oportunidade na `version` N
- **Quando** `mover_oportunidade` é chamada informando uma `version` diferente
  de N
- **Então** a função rejeita a chamada sem alterar etapa, evento ou versão
  (conflito de versão — a mesma regra que produz o erro `CONFLITO_DE_VERSAO`
  do contrato de API do TDD-001 §4.6)

#### AC-028 — `concluir_atividade` grava o resultado do toque e o efeito em cadeia, atomicamente

- **Dado** uma atividade de cadência pendente
- **Quando** `concluir_atividade` é chamada com um resultado (`sem_resposta`
  ou `conectou`)
- **Então** o resultado é gravado e, na mesma transação: se `conectou`, as
  demais atividades pendentes da oportunidade viram `cancelada` e um evento de
  conexão é gravado; se `sem_resposta` e o bloco atual se completa, nenhuma
  linha fica inconsistente (a geração do próximo bloco é responsabilidade do
  worker/domínio — aqui só se prova que a função não deixa estado parcial)

### US-012 — Configuração fixa do pipeline nasce nos seeds, não digitada à mão

Como desenvolvedor, quero que as 15 etapas, o grafo de transições permitido e
uma lista inicial de motivos de perda sejam seeds idempotentes das migrations,
para que todo ambiente (CI, staging, produção) nasça com a mesma configuração
de pipeline, sem passo manual (TDD-001 §4.3, §4.8).

#### AC-029 — As 15 etapas existem após a migration, na ordem certa

- **Dado** as migrations aplicadas
- **Quando** se consulta `pipeline_etapas` ordenado por `ordem`
- **Então** as 15 etapas do TDD-001 §4.4 aparecem, cada uma com seu
  `macrofluxo` (`SDR`/`CLOSER`) e suas flags (`exige_valor`, `exige_motivo`,
  `exige_proxima_acao`, `exige_evidencia`, `e_terminal`) corretas

#### AC-030 — O grafo de transições permitido existe e bloqueia o resto por omissão

- **Dado** as migrations aplicadas
- **Quando** se consulta `pipeline_transicoes`
- **Então** exatamente as transições do TDD-001 §4.4 (incluindo os saltos:
  conexão imediata, remarcação de no-show, Proposta→Negociação sem Teste,
  Proposta/Teste→Contrato, Follow→1º dia, qualquer etapa→Perdido) estão
  presentes, e nenhuma outra combinação etapa-origem/etapa-destino existe

#### AC-031 — Seeds de `motivos_perda` cobrem os motivos já exigidos pelo mapeamento de migração

- **Dado** as migrations aplicadas
- **Quando** se consulta `motivos_perda`
- **Então** ao menos os motivos usados no mapeamento de etapas do RFC-001 §6
  existem (`Sem interesse`, `Sem perfil/fit`, `Cadência esgotada` com
  `e_sistemico = true`, `Legado — arquivado`) — a lista completa e definitiva
  (TDD-001 §17 pergunta 2, ainda em aberto com @Alana/@Erivelton) pode crescer
  depois sem quebrar nada, porque a tabela não é um enum fechado

### US-013 — Só a role de migration tem DDL

Como responsável pela segurança de dados, quero que apenas `crm_migrator`
consiga criar/alterar/apagar estrutura no schema do CRM, para que a role de
runtime da aplicação (`crm_app`) nunca possa alterar o próprio schema, mesmo
que comprometida (TDD-001 §4.8; RFC-001 R-VPS-3).

#### AC-032 — `crm_app` não executa DDL

- **Dado** uma conexão autenticada como `crm_app` no banco com o schema
  aplicado
- **Quando** essa conexão tenta `CREATE TABLE`, `ALTER TABLE` ou `DROP TABLE`
  em qualquer tabela do schema do CRM
- **Então** o banco recusa por falta de privilégio

## Fora de escopo

- Camada de repositórios da aplicação (`src/repositories`, `SET LOCAL
  app.empresa_id` a partir do código Next.js) — feature `fase1-repositorios-isolamento`.
- Better Auth configurado e funcionando (login, convite, reset, sessão) — só
  as tabelas do adaptador nascem aqui; a feature `fase1-auth-rbac` liga a
  biblioteca.
- Módulo de domínio TypeScript puro (grafo de transições em código, geração de
  blocos de cadência, cálculo de turno/feriado) — feature `fase1-dominio-pipeline`.
- Aplicar as migrations de fato em `crm_prod`/`crm_staging` na VPS — decidido
  nesta conversa (2026-09-23): esta feature entrega e prova o schema num
  Postgres efêmero de CI; a aplicação real na VPS fica para quando o deploy
  for religado.
- ETL de Supabase/Sheets/LP para o modelo novo — feature da Fase 3 (Migração).
- UI, rotas HTTP, worker de cadência.
- Lista final e fechada de `motivos_perda` — pendência de negócio (TDD-001
  §17 pergunta 2), não bloqueia o schema (AC-031).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-006 | UUIDs são gerados com `gen_random_uuid()` nativo do Postgres 15 (disponível desde o core a partir do PG13, sem precisar da extensão `pgcrypto`) | confirmada | Verificado: o `pg-master` roda PostgreSQL 15.18 (RFC-001 §1.3), que já embute `gen_random_uuid()` no core. |
| ASM-007 | O isolamento multi-tenant usa um único schema `public` (sem schema por empresa) — quem isola é o RLS, não a separação de schema | confirmada | Alinhado à sub-decisão D-S3(b) do RFC-001 §5, escolhida explicitamente sobre a opção (c) "um schema/database por empresa". |
| ASM-008 | `pipeline_transicoes.papeis_permitidos` só guarda a lista de papéis autorizados (coluna de dados); **validar** se o ator tem esse papel é responsabilidade da camada de domínio (`fase1-dominio-pipeline`), não desta feature | aberta | — |
| ASM-009 | Os testes de integração desta feature sobem seu próprio Postgres 15 efêmero via `docker run` (mesmo padrão decidido em `fase0-fundacao-ci-staging` Q-003), sem tocar `crm_staging`/`crm_prod` da VPS | confirmada | Confirmado pelo usuário nesta conversa (2026-09-23): migrations só entregues e provadas em CI; aplicação real na VPS fica para o religamento do deploy. |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-004 | A lista final de `motivos_perda` (TDD-001 §17 pergunta 2) ainda depende de @Alana/@Erivelton, prevista para 2026-10-09 | aberta | — |
