# Spec: Fase 0 — Fundação (CI, imagem versionada, staging, backup, observabilidade)

> feature: fase0-fundacao-ci-staging
> status: auditada

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - US-xxx = história de usuário · AC-xxx = critério de aceite
    ASM-xxx = suposição · Q-xxx = pergunta em aberto
    São códigos de rastreio: ligam a especificação às tarefas e aos testes.
  - Toda história de usuário precisa de pelo menos um critério de aceite.
  - Todo critério de aceite precisa de Dado/Quando/Então completos.
  - Os códigos são únicos no projeto inteiro (nunca reutilize um número).
  - Suposições e Perguntas em aberto são OBRIGATÓRIAS: se não há nenhuma,
    escreva "Nenhuma." — mas desconfie: quase toda feature esconde uma.
-->

## Contexto

Fonte: [PRD-001](../../../docs/prds/PRD-001-pipeline-comercial-cadencia.md) ·
[RFC-001 §7 Decisão B (B2) e §8 Roadmap "Fase 0"](../../../docs/rfcs/RFC-001-pipeline-comercial-cadencia-e-infra.md) ·
[TDD-001 §6 Plano de Implementação — Fase 0](../../../docs/tdds/TDD-001-pipeline-comercial-cadencia-postgres.md).

Hoje o deploy do CRM (`scrumboard-medguia`) é `scp` + `docker compose build --no-cache`
direto na VPS de produção, sem CI, sem testes, sem staging, sem migrations
versionadas e sem rollback (RFC-001 §1.3). Antes de reescrever o pipeline
comercial (Fase 1+) sobre um Postgres próprio, esta feature entrega a rede de
proteção que todo o resto depende: CI com gates, imagem versionada com
rollback por tag, banco e roles dedicados no `pg-master` já existente, backup
externo com restore ensaiado, e observabilidade mínima. Sem isso não há como
ensaiar com segurança nenhuma mudança de schema, auth ou pipeline.

## Histórias

### US-001 — CI bloqueia código quebrado antes da main

Como desenvolvedor único do projeto, quero que todo Pull Request rode lint,
checagem de tipos, testes e build automaticamente, para que um erro não
alcance a `main` só porque ninguém rodou os testes na mão.

#### AC-001 — Workflow de CI cobre os quatro gates na ordem certa

- **Dado** o arquivo `.github/workflows/ci.yml`
- **Quando** ele é inspecionado
- **Então** existe um job que executa, nessa ordem, lint → checagem de tipos
  (`tsc --noEmit`) → testes → build, e cada passo depende do anterior ter
  passado (nenhum `continue-on-error: true` nos gates)

#### AC-002 — CI roda em todo Pull Request e em todo push

- **Dado** o mesmo workflow
- **Quando** inspecionado o gatilho (`on:`)
- **Então** ele dispara em `pull_request` (qualquer branch contra `main`) e em
  `push` na `main`, para cobrir tanto o PR quanto um merge direto

### US-002 — Deploy por imagem versionada, com rollback em minutos

Como desenvolvedor operando a própria infraestrutura, quero publicar uma
imagem Docker versionada por commit e só então atualizar a VPS, para que
voltar uma versão não exija reverter código e re-buildar (hoje ~10 min de
build competindo por memória com a produção).

#### AC-003 — Build sai da VPS e a imagem é publicada com tag rastreável

- **Dado** um push que dispara o workflow de release
- **Quando** o job de build roda
- **Então** ele publica a imagem no GHCR com uma tag baseada no SHA do commit
  (não em `latest`), e a VPS não executa `docker build` nenhum — só `pull`

#### AC-004 — Rollback é trocar a tag, sem rebuild

- **Dado** uma imagem `sha-B` já rodando em produção e uma imagem anterior
  `sha-A` publicada no GHCR
- **Quando** o operador aciona o rollback apontando para `sha-A`
- **Então** a VPS sobe o container com `sha-A` sem executar nenhum build,
  em menos de 2 minutos

### US-003 — Ambiente de staging isolado para ensaiar mudanças

Como desenvolvedor que vai reescrever schema, auth e pipeline, quero um
ambiente de staging com banco próprio, separado de produção, para poder
ensaiar migrations e o "card de teste" (PRD §10.4) sem risco de corromper
dados reais.

#### AC-005 — Staging usa um database Postgres separado de produção

- **Dado** o `pg-master` já existente na VPS (compartilhado com outros
  projetos — RFC-001 §1.3, P14)
- **Quando** os databases do CRM são criados
- **Então** existem `crm_prod` e `crm_staging` como databases distintos, e a
  aplicação de staging conecta só em `crm_staging`

#### AC-006 — Staging é publicamente acessível só por quem tem o link/credencial da equipe

- **Dado** o container `crm-app` de staging subindo na VPS
- **Quando** inspecionada a topologia de rede (nginx-proxy-manager, `docker-compose`)
- **Então** staging fica atrás do mesmo proxy com TLS, sem porta adicional
  exposta na internet além da já usada por produção

### US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta

Como responsável pela infraestrutura, quero que o CRM se conecte ao Postgres
com roles próprias (sem `SUPERUSER` nem `BYPASSRLS`) e que a porta 5432 não
fique acessível pela internet, para reduzir o risco levantado em
RFC-001 §7 (R-VPS-1: porta publicada em `0.0.0.0` com `ufw` inativo; R-VPS-3:
todos os projetos usando o superusuário `admin`).

#### AC-007 — `crm_app` não tem privilégio de superusuário nem DDL

- **Dado** a role `crm_app` usada pela aplicação em runtime
- **Quando** ela tenta executar `CREATE TABLE` ou qualquer DDL, ou ler dados
  de outro database do cluster
- **Então** o Postgres rejeita a operação (a role não tem `SUPERUSER`,
  `BYPASSRLS` nem privilégio de DDL em `crm_prod`/`crm_staging`)

#### AC-008 — `crm_migrator` é a única role com DDL, usada só pelo job de migration

- **Dado** o job efêmero de migration (`crm_migrator`)
- **Quando** ele roda uma migration do `drizzle-kit`
- **Então** consegue alterar o schema, e nenhuma outra credencial usada pelo
  `crm-app`/`crm-worker` em runtime tem esse privilégio

#### AC-009 — Postgres não publica porta na internet

- **Dado** o `docker-compose.yml` de produção/staging
- **Quando** inspecionado o serviço `pg-master`
- **Então** não há `ports:` publicando 5432 em `0.0.0.0` — o acesso é só pela
  rede Docker interna (`wp-network`) ou por túnel SSH para administração

### US-005 — Backup diário automático com restore testado

Como responsável pela infraestrutura, quero um backup diário do banco do CRM
enviado para fora da VPS, com um restore já ensaiado, para que uma falha de
disco não signifique perda total dos dados comerciais (RFC-001 §7, R-VPS-2:
hoje o `pg-master` não tem nenhum backup).

#### AC-010 — Backup diário roda e é enviado para fora da VPS

- **Dado** o cron de backup configurado às 03h
- **Quando** o job roda com sucesso
- **Então** existe, no remote externo (`rclone` → `gdrive:`, pasta própria do
  CRM), um dump datado de `crm_prod` com checksum (`sha256sum`) gravado junto

#### AC-011 — Alerta dispara se o backup falhar ou atrasar

- **Dado** o job de backup
- **Quando** ele falha, ou quando `/api/health` verifica que o último backup
  bem-sucedido tem mais de 24h
- **Então** um alerta é enviado (WhatsApp via Evolution API, no padrão do
  script já existente na VPS)

#### AC-012 — Restore ensaiado recupera um dump em staging

- **Dado** um dump de backup válido
- **Quando** o procedimento de restore documentado é executado contra
  `crm_staging`
- **Então** o banco de staging fica íntegro e consultável, provando que o
  backup é restaurável de fato (não só "existe o arquivo")

### US-006 — Observabilidade mínima para detectar falha silenciosa

Como desenvolvedor operando sozinho a infraestrutura, quero um endpoint de
saúde que reporte o estado real do sistema, para descobrir uma falha (banco
fora, backup atrasado, cron travado) antes que a operação comercial perceba.

#### AC-013 — `/api/health` reporta app, banco e idade do último backup

- **Dado** o sistema rodando normalmente
- **Quando** `GET /api/health` é chamado
- **Então** a resposta é `200` com `{ status: "ok", checks: [...] }`, e cada
  check indica o estado de: conexão com o banco, idade do último backup
  bem-sucedido e horário da última execução do worker/cron

#### AC-014 — `/api/health` reporta falha quando o banco está inacessível

- **Dado** o banco indisponível (conexão recusada/timeout)
- **Quando** `GET /api/health` é chamado
- **Então** a resposta indica falha no check de banco (status HTTP `503` ou
  `checks[].status = "fail"` explícito), nunca um `200` genérico mascarando o
  problema

## Fora de escopo

- Schema de domínio, auth (Better Auth), pipeline de 15 etapas, motor de
  cadência, ETL de migração — isso é Fase 1/2/3 do TDD-001, tratado em
  features futuras do onp-spec-driven.
- `pg_cron` na imagem do Postgres — decisão já tomada (D-S6): o relógio é um
  worker Node, não faz parte desta feature de fundação.
- PITR/WAL contínuo — RPO de 24h foi aceito no RFC-001 (Q12); só o `pg_dump`
  diário entra aqui.
- Migração dos outros projetos que hoje usam o superusuário `admin` do
  `pg-master` (`evolution`, `followup_agent`, `nps_ifot`) para roles próprias
  — fica como recomendação (R-VPS-3), fora do escopo do CRM.
- Sentry e monitor de uptime externo como produto terceirizado — a integração
  do endpoint `/api/health` com um monitor externo é configuração operacional,
  não código desta feature.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | O RFC-001 ainda não tem o Outcome (§12) preenchido nem passou pela reunião de decisão de 2026-09-30 com os Approvers (@Alana, @Caetano). Está sendo implementado mesmo assim por decisão explícita do Driver/usuário nesta conversa (2026-09-23), tratando a aprovação formal como pendente-mas-não-bloqueante para o trabalho de infraestrutura agnóstico à decisão D/A. | confirmada | Confirmado pelo usuário (Raniery, Driver do RFC) em 2026-09-23: seguir com a Fase 0 completa sem esperar a reunião de 30/09. |
| ASM-002 | O runner de testes é Vitest (RFC-001 Q6), substituindo o `node --test` hoje configurado em `onpspec.config.json`. | confirmada | Migração concluída em 2026-09-23: `vitest` instalado (`^3.2.7`, compatível com `@types/node ^20`), `vitest.config.ts` criado, `package.json`/`onpspec.config.json` apontando para `vitest run` com reporter JSON. Os 14 testes passam e têm prova registrada via `onp-spec verify`. |
| ASM-003 | O nome da imagem publicada no GHCR segue o padrão `ghcr.io/ranieryfialho/scrumboard-medguia:<sha>`. | confirmada | Verificado em `.github/workflows/release.yml` (`ghcr.io/${{ github.repository_owner }}/scrumboard-medguia:${{ github.sha }}`) e `docker-compose.yml` (`ghcr.io/ranieryfialho/scrumboard-medguia:${IMAGE_TAG:-latest}`). |
| ASM-004 | O remote `rclone` (`gdrive:`) e as credenciais já configuradas na VPS para o backup do outro projeto podem ser reaproveitados para o backup do CRM, numa pasta própria — sem precisar de uma nova conta/remote. | confirmada | `infra/backup/backup-crm.sh` usa `RCLONE_REMOTE="gdrive:backups/crm"` — mesmo remote, pasta própria, sem nova credencial. |
| ASM-005 | O deploy de produção continua manual (`workflow_dispatch`) mesmo depois desta feature — a trava tática adotada nesta conversa (2026-09-23) não é substituída automaticamente pelo gate de CI. | confirmada | Decisão mantida: `deploy.yml` segue `workflow_dispatch`. Voltar a deploy automático por push (protegido por CI verde + PR obrigatório) é decisão explícita futura do usuário, fora do escopo desta feature. |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-001 | O restore ensaiado (AC-012) deve rodar automaticamente todo mês (como o TDD-001 §4.9 recomenda para o regime permanente) ou, nesta feature de fundação, basta provar que o procedimento funciona uma vez (manual, documentado)? | respondida | Decidido pelo usuário em 2026-09-23: fica para depois. O teste automatizado no CI (`AC-012`) já prova que `restore-crm.sh` funciona; o ensaio mensal contra o backup real da VPS é rotina operacional futura, não bloqueia esta feature. |
| Q-002 | Existe hoje uma conta Sentry (ou equivalente) disponível para o projeto, ou a criação de uma conta/projeto Sentry é um passo manual que o usuário fará fora desta feature? | respondida | Decidido pelo usuário em 2026-09-23: não existe conta ainda — fica fora do escopo desta feature. `/api/health` cobre a observabilidade mínima; Sentry fica como integração manual futura. |
| Q-003 | O CI precisa de um Postgres real como *service container* para os testes de integração de roles/RLS (AC-007 a AC-009) — confirmar que o GitHub Actions runner padrão (`ubuntu-latest`) é aceitável, sem precisar de self-hosted runner. | respondida | Confirmado em 2026-09-23: os testes de integração sobem seu próprio container Postgres via `docker run` (não via `services:` do workflow), e `ubuntu-latest` já vem com Docker disponível — `runs-on: ubuntu-latest` em `ci.yml` é suficiente, sem runner dedicado. |
