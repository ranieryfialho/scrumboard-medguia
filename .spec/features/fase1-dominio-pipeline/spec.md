# Spec: Fase 1 — Domínio do pipeline (transições)

> feature: fase1-dominio-pipeline
> status: auditada

## Contexto

O schema do pipeline (`pipeline_etapas`, `pipeline_transicoes`, a função SQL
`mover_oportunidade`) já existe (fase1-schema-drizzle), mas não valida nada
sozinho — ele move a etapa que mandarem. Esta feature entrega o módulo de
domínio TypeScript puro (`src/domain/pipeline`) que decide, ANTES de chamar o
banco, se uma transição de etapa é permitida: ela está no grafo? o papel do
ator pode fazê-la? os dados obrigatórios daquela etapa estão presentes?

## Fora de escopo

- Chamar de fato `mover_oportunidade`/persistir no Postgres — isso é da rota
  HTTP `/api/oportunidades/:id/transicao` (TDD-001 §4.6), uma feature futura
  que vai USAR este módulo de domínio.
- Motor de cadência: geração de blocos, virada de dia, 18 toques, breakup
  (TDD-001 §4.5) — feature futura própria.
- Regras específicas de reunião: duração mínima, resumo, remarcação com 24h,
  integração com Calendar (TDD-001 §4.4, linhas "Reunião agendada"/"No-show"/
  "Reunião realizada" além da evidência genérica) — feature futura.
- Filtrar se um `motivo_perda` está `ativo`/selecionável na UI — fica na
  camada de repositório/API, que já sabe filtrar por essa coluna.
- Resolver `empresa_id`/sessão/papel do ator — já entregue por
  fase1-schema-drizzle (RLS) e fase1-auth-rbac (sessão/tenant). Esta feature
  RECEBE o papel do ator já resolvido, não o descobre.

## Histórias

### US-021 — Bloquear transição fora do grafo do playbook

Como sistema, quero rejeitar qualquer transição de etapa que não esteja
cadastrada em `pipeline_transicoes`, para que um card nunca pule etapas do
playbook comercial por um bug de UI ou uma chamada direta à API.

#### AC-048 — Transição sem registro no grafo é rejeitada

- **Dado** um par (etapa de origem, etapa de destino) sem linha correspondente
  em `pipeline_transicoes`
- **Quando** o módulo de domínio valida a transição
- **Então** o resultado é um erro com código `TRANSICAO_NAO_PERMITIDA` e
  nenhuma outra regra é avaliada

#### AC-049 — Transição registrada no grafo passa a checagem de existência

- **Dado** um par (etapa de origem, etapa de destino) com linha correspondente
  em `pipeline_transicoes`
- **Quando** o módulo de domínio valida a transição
- **Então** a validação segue para a checagem de papel (não retorna
  `TRANSICAO_NAO_PERMITIDA`)

### US-022 — Bloquear transição por papel sem permissão

Como gestor de empresa, quero que só os papéis autorizados por
`pipeline_transicoes.papeis_permitidos` consigam executar cada transição,
para que um ATENDENTE não feche negociações que são do CLOSER/GERENTE.

#### AC-050 — Papel fora da lista é rejeitado

- **Dado** uma transição cujo `papeis_permitidos` é `[MASTER, GERENTE]`
- **Quando** um ator com papel `ATENDENTE` (e sem `is_super_admin`) tenta essa
  transição
- **Então** o resultado é um erro com código `PAPEL_NAO_PERMITIDO`

#### AC-051 — Papel presente na lista é aceito

- **Dado** uma transição cujo `papeis_permitidos` inclui `GERENTE`
- **Quando** um ator com papel `GERENTE` tenta essa transição
- **Então** a validação de papel passa (não retorna `PAPEL_NAO_PERMITIDO`)

#### AC-052 — Super admin ignora `papeis_permitidos`

- **Dado** uma transição cujo `papeis_permitidos` é `[MASTER]`
- **Quando** um ator com `is_super_admin=true` e papel `ATENDENTE` na empresa
  tenta essa transição
- **Então** a validação de papel passa mesmo com o papel efetivo fora da
  lista (decisão do usuário em 2026-09-25, ver Q-007)

### US-023 — Exigir os dados obrigatórios de cada etapa antes de mover o card

Como sistema, quero recusar a transição quando a etapa de destino exige um
dado (valor, motivo de perda, próxima ação ou evidência) e ele não foi
informado, para que o board nunca mostre um card em Proposta sem valor, ou
Perdido sem motivo.

#### AC-053 — Valor obrigatório ausente ou zero/negativo é rejeitado

- **Dado** uma etapa de destino com `exige_valor=true`
- **Quando** a transição é validada sem `valor` ou com `valor <= 0`
- **Então** o resultado é um erro com código `VALOR_OBRIGATORIO`

#### AC-054 — Valor positivo é aceito

- **Dado** uma etapa de destino com `exige_valor=true`
- **Quando** a transição é validada com `valor > 0`
- **Então** a validação de valor passa (não retorna `VALOR_OBRIGATORIO`)

#### AC-055 — Motivo de perda ausente é rejeitado

- **Dado** uma etapa de destino com `exige_motivo=true`
- **Quando** a transição é validada sem `motivoPerdaId`
- **Então** o resultado é um erro com código `MOTIVO_PERDA_OBRIGATORIO`

#### AC-056 — Motivo de perda presente é aceito

- **Dado** uma etapa de destino com `exige_motivo=true`
- **Quando** a transição é validada com `motivoPerdaId` preenchido
- **Então** a validação de motivo passa (não retorna
  `MOTIVO_PERDA_OBRIGATORIO`)

#### AC-057 — Próxima ação ausente ou no passado é rejeitada

- **Dado** uma etapa de destino com `exige_proxima_acao=true`
- **Quando** a transição é validada sem `proximaAcaoEm`, ou com
  `proximaAcaoEm` no passado em relação ao instante da validação
- **Então** o resultado é um erro com código `PROXIMA_ACAO_OBRIGATORIA`

#### AC-058 — Próxima ação futura é aceita

- **Dado** uma etapa de destino com `exige_proxima_acao=true`
- **Quando** a transição é validada com `proximaAcaoEm` no futuro
- **Então** a validação de próxima ação passa (não retorna
  `PROXIMA_ACAO_OBRIGATORIA`)

#### AC-059 — Evidência obrigatória ausente é rejeitada

- **Dado** uma etapa de destino com `exige_evidencia=true`
- **Quando** a transição é validada sem `anexoId`
- **Então** o resultado é um erro com código `EVIDENCIA_OBRIGATORIA`

#### AC-060 — Evidência presente é aceita

- **Dado** uma etapa de destino com `exige_evidencia=true`
- **Quando** a transição é validada com `anexoId` preenchido
- **Então** a validação de evidência passa (não retorna
  `EVIDENCIA_OBRIGATORIA`)

### US-024 — Exigir justificativa para reabrir um card terminal

Como gestor de empresa, quero que reabrir um card em `Perdido` ou `Ganho`
sempre exija uma justificativa textual, para que toda reabertura fique
registrada e explicada no relatório (TDD-001 §4.4).

#### AC-061 — Reabertura sem justificativa é rejeitada

- **Dado** uma transição com `exige_justificativa=true`
- **Quando** a transição é validada sem `justificativa`, ou com
  `justificativa` vazia/só espaços
- **Então** o resultado é um erro com código `JUSTIFICATIVA_OBRIGATORIA`

#### AC-062 — Reabertura com justificativa preenchida é aceita

- **Dado** uma transição com `exige_justificativa=true`
- **Quando** a transição é validada com `justificativa` preenchida
- **Então** a validação de justificativa passa (não retorna
  `JUSTIFICATIVA_OBRIGATORIA`)

### US-025 — Reportar sempre uma única causa de rejeição, numa ordem previsível

Como desenvolvedor da API que vai consumir este módulo, quero que a validação
pare no primeiro problema encontrado e devolva só um código de erro, para que
a resposta HTTP (TDD-001 §4.6: "envelope único com código nomeado") mostre ao
usuário exatamente uma regra do playbook por vez.

#### AC-063 — Quando várias regras são violadas, só a primeira (na ordem grafo → papel → dados obrigatórios da etapa → justificativa) é reportada

- **Dado** uma transição fora do grafo E com papel sem permissão (se
  existisse)
- **Quando** a transição é validada
- **Então** o único erro retornado é `TRANSICAO_NAO_PERMITIDA`

- **Dado** uma transição dentro do grafo, com papel sem permissão E etapa de
  destino exigindo valor não informado
- **Quando** a transição é validada
- **Então** o único erro retornado é `PAPEL_NAO_PERMITIDO`

#### AC-064 — Quando todas as regras aplicáveis passam, a validação retorna sucesso sem nenhum erro

- **Dado** uma transição dentro do grafo, com papel permitido, e todos os
  dados obrigatórios da etapa de destino presentes e válidos
- **Quando** a transição é validada
- **Então** o resultado é de sucesso, sem código de erro

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-013 | Os guards desta feature usam só os 4 flags booleanos de `pipeline_etapas` (`exige_valor`/`exige_motivo`/`exige_proxima_acao`/`exige_evidencia`) e o `exige_justificativa` de `pipeline_transicoes` — guards que dependem de outras tabelas (reuniões, Calendar, motor de cadência) ficam fora de escopo | confirmada | Escopo explícito, decidido pelo usuário nesta conversa (2026-09-25): esta feature cobre só "grafo + guards + papel"; motor de cadência e API HTTP ficam para features futuras. |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-007 | (TDD-001 §10, pergunta 9) Super admin pode transicionar cards de qualquer empresa mesmo fora de `papeis_permitidos`? | respondida | Decidido pelo usuário (Raniery) em 2026-09-25: sim — super admin ignora `papeis_permitidos` em qualquer transição, mesma convenção de bypass de RBAC já usada na fase1-auth-rbac (troca de empresa). |
