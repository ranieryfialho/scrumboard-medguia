# RFC 001: Pipeline Comercial Orientado a Eventos sobre PostgreSQL Próprio e Profissionalização da Esteira de Entrega

| Campo | Valor |
|---|---|
| **Impacto** | **ALTO** — troca a plataforma de dados e autenticação, altera a fonte de verdade dos leads, a rotina diária da operação comercial e o processo de deploy |
| **Status** | NOT STARTED |
| **Driver** | @Raniery Fialho — Engenharia de Software |
| **Approvers** | @Alana Alexandre (Liderança Comercial) — decisão de negócio/rollout · @Caetano Lima (Cronograma e Operações) — decisão de prazo/esforço |
| **Contributors** | @Erivelton (Consultor Comercial — regras do Playbook Atento) · @Karol (Operação SDR/Closer — usuária principal) |
| **Informed** | Futuros SDRs/Closers · Administradores de empresas clientes (multi-tenant) |
| **Due Date** | 2026-09-30 (proposta para decisão) |
| **Resources** | [PRD-001](../prds/PRD-001-pipeline-comercial-cadencia.md) · [Playbook CRM Atento](../Playbook%20CRM%20Atento%20%20-%20MedGuia.pdf) · [Resumo da reunião com o consultor](../Resumo_Reuniao_Medguia_Consultor_Erivelton.pdf) · TDD (a criar em `/docs/tdds`) |
| **Criado em** | 2026-09-17 |
| **Última atualização** | 2026-09-17 — incluída a Decisão D (saída do Supabase para PostgreSQL próprio na VPS); respostas de Q1–Q13 incorporadas; abordagem definida como **redesenho direto em entrega única** (sem *lift-and-shift*) |

> [!NOTE]
> Este RFC traz **três decisões encadeadas**:
>
> | # | Decisão | Pergunta |
> |---|---|---|
> | **D** | Plataforma de dados e autenticação | Continuamos no Supabase ou migramos para um PostgreSQL próprio (Docker na VPS)? O que substitui Auth, Realtime, Storage e RLS? |
> | **A** | Arquitetura do pipeline e da cadência | Como implementar as 15 etapas e os 18 touchpoints do PRD-001 com travas reais? |
> | **B** | Infraestrutura e esteira de entrega | Como entregar D e A com homologação, testes, migrations, backup e rollback? |
>
> **D vem primeiro:** construir o pipeline sobre o Supabase e migrar depois significaria fazer o trabalho duas vezes. O **como construir** fica para o TDD.
>
> **Abordagem definida pelo Driver em 17/09/2026:** D e A são executadas como **uma única iniciativa**. O schema antigo **não** é portado para o Postgres; o modelo novo já nasce com o pipeline redesenhado, e os dados migram **uma vez só**, num **cutover único** (ver §5, D2, e §8).

---

## 1. Contexto (Background)

### 1.1 Estado atual — Produto

O CRM atual (Next.js 16 App Router + Supabase + Google Sheets, ~11k linhas) funciona assim:

| Aspecto | Como é hoje | Onde está |
|---|---|---|
| **Fonte de verdade dos leads** | Google Sheets (várias planilhas/abas) para empresas com `usa_sheets=true`, tabela `leads` do Supabase para as demais, e ainda um **segundo projeto Supabase** (LP) lido na mesma rota | `src/app/api/sheets/route.ts` (752 linhas) |
| **Etapas do funil** | 9 colunas fixas no front + `Arquivado` | `src/components/kanban/kanban-board.tsx` |
| **Status** | Campo texto livre `situacao`, normalizado por `STATUS_MAP` (valores desconhecidos viram `Novos Leads`) | `route.ts` → `normalizarStatus` |
| **Transições** | Drag & drop sem validação de servidor; só 2 etapas pedem confirmação | `STATUS_COM_CONFIRMACAO` |
| **Histórico** | Um campo `observacoes` (texto) e `data_alteracao`. **Não há log de eventos** | `use-leads.ts` |
| **Atividades/tarefas** | Não existem | — |
| **Tipagem** | `Lead` tem `[key: string]: any` | `src/types/lead.ts` |
| **Atualização** | Polling a cada 120s que relê as planilhas inteiras | `use-leads.ts` |
| **WhatsApp** | Evolution API com webhook e histórico em `whatsapp_mensagens` | `src/app/api/whatsapp/*` |

### 1.2 Estado atual — Dependência do Supabase

Levantamento feito no código em 17/09/2026:

| Recurso Supabase | Uso atual | Onde | Precisa de substituto? |
|---|---|---|---|
| **Postgres (PostgREST)** | 6 tabelas: `empresas`, `empresa_configuracoes`, `leads`, `campanhas`, `envios_campanha`, `whatsapp_mensagens` | ~25 arquivos, **inclusive consultas feitas direto do navegador** (`use-leads.ts`, `nova-campanha-modal.tsx`, `sidebar.tsx`, `usuarios-tab.tsx`…) | Sim: camada de acesso a dados **no servidor** |
| **Auth** | `signInWithPassword`, `verifyOtp` + `updateUser` (nova senha), `auth.admin.inviteUserByEmail`, `listUsers`, `updateUserById` | `login/`, `nova-senha/`, `api/usuarios/`, `middleware.ts` | Sim: biblioteca de auth + envio de e-mail |
| **Metadados de usuário** | `user_metadata.empresa_id`, `is_super_admin` e papel RBAC (MASTER/GERENTE/ATENDENTE) em 35 pontos | Espalhado | Sim: tabela `usuarios` + vínculo com `empresas` |
| **RLS** | Policies com `auth.jwt() -> 'user_metadata' ->> 'empresa_id'` | `supabase/migrations/whatsapp_mensagens.sql` | Sim: RLS com `current_setting` e/ou escopo na aplicação |
| **Service role** | `createClient(URL, SERVICE_ROLE_KEY)` instanciado ad hoc | Várias rotas | Deixa de existir: a conexão do servidor é única |
| **Realtime** | 3 canais (`wpp-chat-*`, `wpp-inbox-*`, `wpp-unread-realtime`) | `whatsapp-chat.tsx`, `whatsapp-inbox-chat.tsx`, `whatsapp-unread-context.tsx` | Sim: SSE + `LISTEN/NOTIFY` ou polling |
| **Storage** | Não usado hoje; **necessário** para os prints do PRD §5.3 | — | Sim (novo) |
| **Projeto Supabase da LP** | Leitura e escrita de `leads` via `SUPABASE_LP_URL`/`SUPABASE_LP_ANON_KEY` | `api/sheets/route.ts` | A decidir (ver D-S8) |
| **`next-auth`** | Dependência instalada; só aparece num `SessionProvider` sem uso efetivo | `auth-provider.tsx` | Resquício: remover ou reaproveitar |

### 1.3 Estado atual — Infraestrutura

| Aspecto | Como é hoje | Risco |
|---|---|---|
| **Deploy** | Push na `main` → `scp` do repositório → `docker compose build --no-cache` **na VPS** → `up -d` | Build com heap de 4GB disputando memória com a produção (e, após D, com o Postgres); sem artefato versionado |
| **Gates de qualidade** | Nenhum: sem lint, typecheck, teste ou build no CI | Entre 07 e 10/07/2026 foram 6 commits de correção de deploy/build |
| **Testes** | Nenhum (`onpspec.config.json` prevê `node --test`, sem arquivos) | Viola o P-001 da `.spec/constituicao.md` |
| **Ambientes** | Só produção | Impossível executar o "card de teste" do PRD §10.4 |
| **Rollback** | Inexistente | Voltar versão exige revert + rebuild de ~10 min |
| **Migrations** | Só `whatsapp_mensagens.sql` versionado; as demais tabelas **não estão no repo** | Schema não reproduzível |
| **Segredos** | `.env` com `source` na VPS; `EVOLUTION_API_KEY` vira `ARG`/`ENV` de build; o compose passa `SUPABASE_SERVICE_ROLE_KEY` e `GOOGLE_PRIVATE_KEY` como build args | Segredos no cache de build |
| **Observabilidade** | Só `console.error`; `catch {}` silenciosos | Falhas invisíveis |
| **Postgres na VPS** | Container **`pg-master`** (**PostgreSQL 15.18**, Alpine), rede `wp-network`, bind mount `/root/postgres/data`, **sem limite de memória**, **porta 5432 publicada em `0.0.0.0`**. Databases: `evolution` (33 MB), `followup_agent`, `nps_ifot`, `medguia_obs`, `admin`, `postgres` — ~70 MB no total. **Todos os apps conectam com o mesmo superusuário `admin`** | Hoje não é usado por este projeto. Porta exposta (R-VPS-1) e ausência de separação de privilégios entre projetos |
| **Backup do `pg-master`** | **Inexistente.** O cron diário cobre apenas o `supabase-db` do outro projeto | `evolution`, `followup_agent`, `nps_ifot` e `medguia_obs` estão sem cópia (ver R-VPS-2) |
| **Backup existente** | `rclone` (remote `gdrive:`) e cron diário às 03h (`/root/backups/supabase/backup-supabase.sh`): dump custom + roles, checksum, 7 diários + 4 semanais, sync para o Drive e alerta por WhatsApp — **modelo pronto para o CRM** | Hoje só cobre o outro projeto |
| **Firewall do host** | `ufw` **inativo**; o `pg-master` publica 5432 em `0.0.0.0` | Banco alcançável pela internet (R-VPS-1) |

### 1.4 Problema

1. **O PRD-001 exige travas, cadência e métricas** que o Sheets não sustenta: não há integridade, relógio, concorrência segura nem histórico de eventos.
2. **A dependência do Supabase** está espalhada: consultas do navegador, metadados de auth usados como modelo de domínio, RLS acoplado ao JWT do Supabase e duas contas/projetos. O Driver quer **consolidar os dados na VPS**, num Postgres já disponível, para ter controle total, custo previsível e ficar perto dos demais serviços (Evolution API na mesma rede).
3. **A esteira de entrega** não oferece homologação, testes, migrations nem rollback, e as decisões D e A dependem de todos os quatro.

### 1.5 Por que agora

- **Negócio:** o PRD foi aprovado em 16/09/2026, e a expansão do time depende dele.
- **Técnico:** trocar a plataforma de dados **antes** de criar ~7 tabelas novas e reescrever a rota de leads evita migrar duas vezes. A saída do Supabase e a refatoração da camada de dados que o pipeline já exige são **o mesmo trabalho**.
- **Operação:** a transição dos cards (PRD §7.1) exige migração ensaiada em homologação.

### 1.6 O que acontece se não decidirmos

- O pipeline vira "colunas renomeadas" sem travas.
- A dependência do Supabase cresce (Storage, `pg_cron`, novas policies), o que encarece uma saída futura.
- Os deploys continuam indo direto para produção, sem teste nem rollback.

---

## 2. Premissas (Assumptions)

| # | Premissa | Dono | Confiança | Gatilho de invalidação |
|---|---|---|---|---|
| P1 | O volume de leads fica abaixo de ~50 mil/ano por empresa em 12 meses (um único Postgres atende com folga) | @Raniery | Alta | Crescimento de 10x |
| P2 | Os leads continuam **entrando** pelo Google Sheets no curto prazo, então o Sheets pode virar canal de ingestão | @Alana | Média | Mudança na origem dos leads |
| P3 | O pipeline de 15 etapas é o mesmo para **todas** as empresas do multi-tenant, sem customização | @Alana / @Erivelton | **Alta** ✅ confirmado em 17/09/2026 (Q5) | Cliente exigir funil próprio |
| P4 | Turnos: **Manhã = 08h–12h**, **Tarde = 13h–18h**, `America/Sao_Paulo`, segunda a sexta, com pausa em feriados nacionais | @Erivelton / @Karol | **Alta** ✅ confirmado em 17/09/2026 (Q1) | Mudança de horário da operação |
| P5 | Há **1 desenvolvedor** (Raniery) a ~60% nesta iniciativa | @Caetano | Média | Mudança de prioridades |
| P6 | A operação aceita **uma janela única de congelamento de ~4h** (preferencialmente numa sexta à noite ou fim de semana) para o cutover combinado, mais o tempo de cada usuário definir a senha nova | @Karol / @Alana | Média | Exigência de migração sem parada |
| P7 | ✅ **Medido em 17/09/2026:** a VPS tem **2 vCPU**, **7,8 GB de RAM (4,2 GB disponíveis, sem swap)** e **96 GB de disco (75 GB livres)**. Cabem os databases de produção e de homologação no `pg-master`, desde que o build saia da VPS (B2) e sejam definidos limites de memória | @Raniery | **Alta** | Novos serviços na VPS consumindo a folga; a CPU (2 núcleos) é o recurso mais apertado |
| P8 | **`pg_cron` exige alterar `shared_preload_libraries` e reiniciar o `pg-master`**, que é compartilhado com outros projetos. Se essa parada não for aceitável, o relógio da cadência vira um **worker Node** | @Raniery | Média | Resposta do `show shared_preload_libraries` e aceite de uma janela de restart |
| P9 | A detecção de "conexão" via WhatsApp **de entrada** não viola o PRD §7.2, que veta só o disparo automatizado | @Alana | Média | Leitura diferente do escopo |
| P10 | **Decidido (Q11):** as senhas **não** são migradas. No cutover, todos os usuários recebem e-mail (Resend) para definir a senha nova. São poucos usuários, e isso elimina a dependência do schema `auth` do Supabase | @Raniery | **Alta** ✅ | Base de usuários crescer a ponto de o reset em massa virar problema |
| P11 | ✅ A VPS **já tem `rclone`** e um backup diário às 03h para outro projeto (`/root/backups/supabase/backup-supabase.sh`). O CRM reaproveita o mesmo padrão: `pg_dump` + `rclone` para o mesmo destino externo. Destino final a confirmar (Q12) | @Raniery / @Caetano | Alta | Remote do `rclone` sem espaço ou sem credencial válida |
| P14 | A **stack Supabase self-hosted que roda na VPS pertence a outro projeto** e **não pode ser desligada nem alterada** (13 containers, ~2,2 GB de RAM) | @Raniery | **Alta** ✅ confirmado em 17/09/2026 | — |
| P12 | O envio de e-mails transacionais (convite, redefinição de senha) pode usar o **Resend**, que já está integrado para campanhas | @Raniery | Alta | Limite do plano Resend |
| P13 | O projeto Supabase da **LP** pertence a outro sistema (landing page) e **não precisa** sair do Supabase nesta iniciativa | @Raniery / @Caetano | Média | Decisão de consolidar tudo (D-S8) |

Se alguma premissa for invalidada, o Driver reavalia o RFC e comunica os Approvers.

---

## 3. Critérios de Decisão

Estes critérios foram definidos **antes** das opções.

| Prioridade | Critério | Descrição | Peso |
|---|---|---|---|
| C1 | **Aplicação real das regras do PRD** | Travas, campos obrigatórios e cadência garantidos no servidor/banco | **Must-have** |
| C2 | **Migração sem perda de dados/histórico** | Leads, usuários e cards migram com rastreabilidade e ensaio prévio | **Must-have** |
| C3 | **Recuperação de desastre** | Backup automático **fora da VPS**, RPO ≤ 24h (ideal ≤ 15 min), restore **testado** | **Must-have** (fica crítico ao hospedar o próprio banco) |
| C4 | **Segurança e LGPD** | Dados de leads e médicos isolados por empresa, banco não exposto na internet, senhas com hash forte | **Must-have** |
| C5 | **Rastreabilidade e métricas** | Log de eventos para os KPIs do PRD §6 | Alta |
| C6 | **Tempo até o piloto** | Chegar ao card de teste em homologação no menor prazo | Alta |
| C7 | **Controle e custo recorrente** | Preferência do Driver por infra própria na VPS, com custo mensal previsível | Alta |
| C8 | **Carga operacional para 1 dev** | Quanto de manutenção (upgrades, backup, monitoramento) a opção exige | Alta |
| C9 | **Aderência ao que existe** | Reaproveitar Next.js, VPS, Docker, Evolution API e Resend (o PRD §7.2 veta CRM do zero) | Média |
| C10 | **Reversibilidade** | Poder voltar atrás (feature flag, rollback de imagem, fonte antiga em modo leitura) | Média |
| C11 | **Aprisionamento a fornecedor** | Evitar dependência forte de um terceiro | Média |

**Regra de decisão:** a opção precisa atender C1–C4 e, entre as que atendem, vence a que pontuar mais em C5–C10.

---

## 4. Dados Relevantes

- **Cadência:** 18 toques em 3 dias. A taxa de conexão sobe a partir do 9º toque, e operadores sem cadência desistem antes do 6º (PRD §2.1.2).
- **Leitura atual:** `GET /api/sheets` lê todas as abas + Supabase + LP a cada 120s por usuário conectado.
- **Superfície de migração do Supabase:** ~25 arquivos com `supabase-js`, 7 chamadas de Auth, 3 canais Realtime e 35 usos de `user_metadata`.
- **Histórico:** 71 commits; 6 correções de deploy/build em 4 dias (07–10/07/2026).
- **O webhook da Evolution API já cria cards** a partir de mensagens recebidas, o que dá base para detectar conexão pelo WhatsApp.
- **Referências de mercado:** ferramentas de *sales engagement* (Outreach, Apollo, Meetime) usam *sequences* com passos gerados sob demanda e log de atividades imutável.

---

## 5. Decisão D — Plataforma de Dados e Autenticação

### Opção D1: Manter o Supabase Cloud (status quo da plataforma)

**Descrição:** continuar com Postgres, Auth e Realtime gerenciados e adicionar Storage e `pg_cron` para o pipeline.

**Prós:**
- Menor esforço: Auth, Realtime, Storage e backups diários já vêm prontos.
- Nenhuma migração de usuários ou senhas.
- Branching e projetos de staging nativos.

**Contras:**
- **Contraria a direção do Driver (C7):** dados fora da VPS e custo que cresce com uso e com mais projetos (produção + staging + LP).
- Aprisionamento (C11): RLS acoplado a `auth.jwt()`, consultas diretas do navegador e `auth.admin`.
- No plano gratuito, pausa por inatividade e backups limitados; recuperação pontual (PITR) só em planos pagos.
- Dois bancos (Supabase + Postgres da VPS) continuariam existindo na organização.

**Custo:** PEQUENO de esforço · Financeiro: US$ 0–25+/mês por projeto · Risco: BAIXO

---

### Opção D2: PostgreSQL próprio em Docker na VPS + camada de dados e auth na aplicação ⭐ (Recomendada — direção do Driver)

**Descrição:** usar o Postgres que já roda na VPS como **banco único** do CRM. Substituir cada recurso do Supabase por um componente explícito dentro do Next.js e retirar do navegador todo acesso direto ao banco.

**Como funciona:**

| Recurso Supabase | Substituto proposto | Sub-decisão |
|---|---|---|
| PostgREST + `supabase-js` | **Camada de repositórios no servidor** (Route Handlers/Server Actions) com **Drizzle ORM** + driver `pg` | D-S2 |
| Auth | **Better Auth** (e-mail/senha, convites, reset, sessões em Postgres, plugin de organização/multi-tenant) | D-S1 |
| E-mails de auth | **Resend** (já integrado) | — |
| `user_metadata` | Tabelas `usuarios`, `empresas_usuarios` (papel RBAC por empresa) e `is_super_admin` | — |
| RLS com `auth.jwt()` | **Escopo obrigatório por `empresa_id` no repositório** + RLS com `current_setting('app.empresa_id')` como defesa extra | D-S3 |
| Realtime | **SSE** (`/api/stream`) alimentado por `LISTEN/NOTIFY` | D-S4 |
| Storage (prints) | **Volume Docker** com URLs assinadas pela aplicação, ou **MinIO** / R2 | D-S5 |
| `pg_cron` (Supabase) | Extensão `pg_cron` na imagem do Postgres, **ou** container `worker` Node com agendador | D-S6 |
| Backups gerenciados | **pgBackRest/WAL-G** (PITR) ou `pg_dump` agendado, com envio para armazenamento **fora da VPS** | D-S7 |
| Projeto LP | Continua no Supabase, lido pelo import (P13) | D-S8 |

**Plano de migração — redesenho direto (sem *lift-and-shift*), conforme decisão do Driver em 17/09/2026 (detalhes no TDD):**

> O schema antigo **não** é portado para o Postgres. O **modelo novo** (auth, empresas, leads, pipeline, cadência, WhatsApp, campanhas) nasce direto no Postgres, e os dados antigos migram **uma única vez**, por ETL, para esse modelo.

1. Modelar no Drizzle o schema novo **completo**: `usuarios`/sessões (Better Auth), `empresas`, `empresas_usuarios`, `empresa_configuracoes`, `leads`, as entidades do pipeline (A2), `whatsapp_mensagens`, `campanhas` e `envios_campanha`.
2. **ETL idempotente** (`scripts/migracao/`), que extrai de três origens e grava no modelo novo:
   - **Supabase** (`public.*` e a lista de usuários via `auth.admin.listUsers`);
   - **Google Sheets**;
   - **Supabase da LP**.

   Cada registro guarda `origem + id_externo` e ganha um evento `migrado_de`. Os cards antigos são convertidos para as 15 etapas pela tabela de mapeamento (A2.8).
3. **Usuários:** os **UUIDs são mantidos** e os papéis/empresa vêm de `user_metadata`. **Senhas não são migradas:** no cutover, todos recebem um e-mail (Resend) para definir a senha nova (Q11).
4. Implementar a camada de repositórios no servidor. Nenhum componente do navegador acessa o banco.
5. Trocar os 3 canais Realtime por SSE.
6. **Ensaios em staging** com cópia real dos dados, repetidos até ficarem limpos. Critérios:
   - contagens de origem e destino batem por empresa;
   - zero cards sem etapa;
   - fila de revisão manual resolvida por @Alana e @Karol.
7. **Cutover único** na janela de congelamento (P6):
   1. colocar o sistema antigo em modo leitura;
   2. rodar o ETL final;
   3. fazer o deploy da nova imagem;
   4. virar o DNS/compose;
   5. disparar os convites de senha.
8. **Rollback:** o sistema antigo (imagem atual + Supabase + Sheets) fica **intacto e em modo leitura por 30 dias**. Até 48h após o cutover, voltar significa religar a imagem antiga; os dados criados no sistema novo nesse intervalo são exportados em CSV para lançamento manual. Depois disso, desativar o Supabase.

**Prós:**
- **Atende C7 e C11:** dados na infraestrutura própria, sem aprisionamento, só com Postgres e bibliotecas open source.
- Um único banco para o CRM, na mesma rede Docker da Evolution API (latência baixa, sem sair para a internet).
- Remove as consultas do navegador ao banco, uma melhoria real de segurança (C4). Hoje a segurança depende 100% de as policies de RLS estarem corretas.
- `pg_cron`, `LISTEN/NOTIFY` e transações ficam disponíveis sem restrição de plano.
- Custo recorrente previsível (só o backup externo).
- A refatoração da camada de dados é pré-requisito do pipeline de qualquer forma (A2).

**Contras:**
- **Carga operacional maior (C8):** backups, upgrades de versão do Postgres, espaço em disco, tuning e monitoramento passam a ser responsabilidade do time.
- **Ponto único de falha:** se a VPS cair, caem aplicação **e** banco. O RPO/RTO depende do backup externo e de um procedimento de restauração ensaiado.
- **Auth própria** é código sensível: reset de senha, expiração de sessão, rate limit de login e convites passam a ser do time (mitigado por usar uma biblioteca madura).
- Esforço adicional de ~15–20 pessoa-dias antes de começar o pipeline.
- Postgres compartilhado com outros sistemas da VPS (se for o caso) exige isolamento por **database e role** próprios, além de limites de recursos.

**Custo:** GRANDE — ~15–20 pessoa-dias · Financeiro: ~R$ 0–30/mês (armazenamento externo de backup) · Risco: **MÉDIO** (mitigado por ensaio em staging e rollback para o Supabase por 30 dias)

---

### Opção D3: Supabase self-hosted na VPS (docker-compose oficial)

> [!IMPORTANT]
> **Achado de 17/09/2026:** a VPS **já roda** uma stack Supabase self-hosted (13 containers: `supabase-db` com Postgres 17, kong, auth, storage, realtime, studio, pooler, imgproxy…), consumindo ~2,2 GB de RAM. Ela **pertence a outro projeto** e, por decisão do Driver, **não pode ser desligada, reutilizada nem alterada** (P14). Portanto esta opção **não** significa "aproveitar o que já está lá": significaria subir uma segunda stack, o que é inviável nos recursos atuais.

**Descrição:** rodar a stack completa do Supabase (Postgres, GoTrue, PostgREST, Realtime, Storage, Kong, Studio…) na própria VPS.

**Prós:**
- **Quase nenhuma mudança de código:** `supabase-js`, Auth, Realtime e RLS continuam iguais.
- Dados na VPS (C7) e migração de usuários direta, porque o schema `auth` é o mesmo.

**Contras:**
- **~10 containers** para operar e atualizar juntos; consumo de memória alto para uma VPS que já roda outras coisas (P7).
- Upgrades do self-hosted são manuais e mais sujeitos a quebra que os do Cloud.
- **Não usaria o Postgres que já existe**: a stack exige a própria imagem do Postgres com extensões específicas.
- Mantém o acoplamento (C11) e as consultas do navegador ao banco.
- Backup continua sendo responsabilidade do time.

**Custo:** MÉDIO — ~5–8 pessoa-dias · Financeiro: R$ 0 + recursos de VPS · Risco: **MÉDIO/ALTO** (operação complexa)

---

### Opção D4: Híbrido — Postgres próprio para dados e Supabase apenas para Auth

**Descrição:** mover as tabelas para o Postgres da VPS e manter o Supabase Auth como provedor de identidade, validando o JWT no servidor.

**Prós:**
- Evita reescrever a autenticação agora; os usuários e senhas não mudam.
- Pode servir de **etapa intermediária** de D2.

**Contras:**
- Continua com dois sistemas e dependência externa para login.
- `user_metadata` fica fora do banco de domínio, o que complica joins e RBAC por empresa.
- Não elimina o custo e o aprisionamento, só os reduz.

**Custo:** MÉDIO — ~10–12 pessoa-dias · Risco: MÉDIO

---

### Sub-decisões de D2 (validar nesta RFC)

| # | Tema | Alternativas | Recomendação | Motivo |
|---|---|---|---|---|
| **D-S1** | Biblioteca de auth | (a) **Better Auth** · (b) Auth.js v5 · (c) `next-auth` v4 (já instalado) · (d) implementação própria | **(a)** | Senha, convite, reset, organizações/multi-tenant e adaptador Postgres/Drizzle nativos; permite verificador de hash customizado (bcrypt legado). (c) está em modo manutenção; (d) é arriscado |
| **D-S2** | Acesso a dados e migrations | (a) **Drizzle ORM + drizzle-kit** · (b) Prisma · (c) Kysely + dbmate · (d) `pg` puro + SQL | **(a)** | Tipos TypeScript a partir do schema (substitui `[key: string]: any`), migrations SQL legíveis, leve no runtime e sem engine binária |
| **D-S3** | Isolamento multi-tenant | (a) só filtro na aplicação · (b) **filtro obrigatório no repositório + RLS com `current_setting`** · (c) um schema/database por empresa | **(b)** | Defesa em profundidade sem o custo operacional de (c); a aplicação conecta com uma role **sem** `BYPASSRLS` |
| **D-S4** | Tempo real | (a) polling curto · (b) **SSE + `LISTEN/NOTIFY`** · (c) WebSocket (socket.io) | **(b)** com fallback em (a) | Unidirecional basta (notificações e chat), funciona no App Router e não exige servidor extra |
| **D-S5** | Arquivos (prints) | (a) **volume Docker + URLs assinadas** · (b) MinIO na VPS · (c) Cloudflare R2/S3 | **(a)** agora, **(c)** se o volume crescer | Simplicidade; os prints são pequenos. O volume **entra no backup** (D-S7) |
| **D-S6** | Relógio da cadência | (a) `pg_cron` no `pg-master` · (b) **container `worker` Node (`node-cron`/pg-boss)** · (c) cron do host chamando endpoint | **(b)** | O `pg-master` é compartilhado com outros projetos, e ligar o `pg_cron` exigiria mexer em `shared_preload_libraries` e reiniciar o banco de todo mundo (P8). O worker é isolado, versionado junto do código, testável e traz fila de retries. Toda tarefa continua **idempotente** e registrada em `cron_execucoes` |
| **D-S7** | Backup e recuperação | (a) **`pg_dump` do database do CRM → `rclone`, diário às 03h** · (b) frequência horária · (c) pgBackRest/WAL-G com PITR | **(a)** ✅ decidido em 17/09/2026 (Q12) | Reaproveita o script que já roda na VPS para o outro projeto, adaptado para o database do CRM (detalhes abaixo). **RPO = 24h** — risco registrado na §10; subir para (b) é mudar uma linha de cron |
| **D-S8** | Projeto Supabase da LP | (a) **manter e ler via import** · (b) migrar também para a VPS | **(a)** | Fora do escopo do PRD (P13); isola o risco |
| **D-S9** | Onde fica o banco do CRM | (a) **database + roles dedicados no `pg-master` existente** · (b) container Postgres novo e dedicado | **(a)** ✅ decidido em 17/09/2026 | Reaproveita o container que já existe (Postgres 15, rede `wp-network`, mesma rede do app e da Evolution API), sem somar mais um serviço numa VPS de 2 vCPU. Implica: databases `crm_prod` e `crm_staging`, roles `crm_app` (DML) e `crm_migrator` (DDL), **sem** `SUPERUSER` nem `BYPASSRLS`, e sem `pg_cron` (ver D-S6) |

### Comparação — Decisão D

| Critério | D1 Supabase Cloud | **D2 Postgres próprio** ⭐ | D3 Supabase self-hosted | D4 Híbrido |
|---|---|---|---|---|
| C2 Migração segura (Must) | ✅ (sem migração) | ✅ (com ensaio) | ✅ | ✅ |
| C3 Recuperação (Must) | ✅ gerenciada | ✅ **se** D-S7 for implementado | ⚠️ manual | ✅ se D-S7 |
| C4 Segurança (Must) | ⚠️ consultas no navegador | ✅ só servidor + RLS | ⚠️ consultas no navegador | ✅ |
| C6 Tempo | Melhor | +3–4 semanas | +1–2 semanas | +2–3 semanas |
| C7 Controle/custo | Baixo | **Alto** | Alto | Médio |
| C8 Carga operacional | **Baixa** | Média | **Alta** | Média |
| C11 Aprisionamento | Alto | **Nenhum** | Alto | Médio |

**Recomendação D:** **D2**, alinhada à direção do Driver. É a única que atende C7 e C11 e ainda melhora a segurança (C4). O custo é a carga operacional (C8), que **só é aceitável se o backup externo com restore testado (D-S7) for requisito de go-live**.

> **D4 descartada (Q14, 17/09/2026):** o Driver optou pelo redesenho direto em entrega única. Migrar os dados primeiro e a auth depois criaria duas viradas e manteria o Supabase no caminho crítico por mais tempo.

---

## 6. Decisão A — Arquitetura do Pipeline e do Motor de Cadência

> Esta decisão parte de D2: o Postgres próprio é a fonte de verdade.

### Opção A1: Manter o Google Sheets como fonte de verdade e adicionar colunas

**Descrição:** colunas `etapa`, `tentativas`, `dia_cadencia`, `valor_proposta`, `motivo_perda` e `proxima_acao_em` na planilha; regras em `/api/sheets`.

**Prós:** menor mudança imediata; a planilha continua familiar.

**Contras:** qualquer pessoa burla as travas editando a célula (**falha em C1**); sem log de eventos; escritas concorrentes se sobrescrevem; cota da API do Sheets; aumenta a complexidade da rota mais frágil do sistema.

**Custo:** MÉDIO (~15–20 pessoa-dias) · Risco: **ALTO** · **Veredito:** ❌ desqualificada por C1.

---

### Opção A2: Postgres como fonte de verdade, com modelo orientado a eventos e motor de cadência por blocos ⭐ (Recomendada)

**Descrição:** o estado do pipeline fica no Postgres (D2), com etapas fixas, atividades de cadência como entidades e **log de eventos append-only**. As regras ficam num **módulo de domínio TypeScript puro**, reforçado por **constraints e uma função transacional** no banco. O Sheets vira **canal de ingestão**.

**Como funciona (alto nível):**

1. **Modelo de dados (novo):**

   | Entidade | Papel |
   |---|---|
   | `pipeline_etapas` | Seed imutável: 15 etapas, ordem, macrofluxo (SDR/Closer) e flags de regra (`exige_proxima_acao`, `exige_valor`, `exige_motivo`) |
   | `oportunidades` | O card: `lead_id`, `empresa_id`, `etapa_id`, `responsavel_id`, `valor`, `motivo_perda_id`, `proxima_acao_em`, `cadencia_dia`, `cadencia_turno`, `version` (lock otimista) |
   | `cadencia_atividades` | Um toque: `sequencia` (1–18), `dia`, `turno`, `canal`, `resultado` (`pendente` · `sem_resposta` · `conectou` · `cancelada`), `realizada_em`, `realizada_por` |
   | `oportunidade_eventos` | Log **append-only** (quem, quando, de→para, payload JSONB); base dos KPIs do PRD §6 |
   | `motivos_perda` | Lista padronizada (seed) |
   | `anexos` | Metadados dos prints (arquivos conforme D-S5) |
   | `tarefas_agendadas` | Retornos futuros (follow de longo prazo, revisitar perdido em 30–60 dias) |

2. **Transições como máquina de estados:**
   - Um único ponto de escrita: `POST /api/oportunidades/:id/transicao`. Ele chama o módulo `src/domain/pipeline/`, que valida os *guards*: `Proposta` exige `valor > 0`; `Perdido` exige motivo; `Follow`, `Proposta`, `Teste` e `Negociação` exigem `proxima_acao_em` futura; `Reunião realizada` exige duração ≥ 10 min.
   - A persistência é uma **função SQL transacional** (`mover_oportunidade`) que grava o estado e o evento de forma atômica, com lock otimista.
   - `CHECK constraints` e triggers são a última defesa. A role da aplicação **não tem permissão** de `UPDATE`/`DELETE` em `oportunidade_eventos`.
   - A UI usa o mesmo módulo para desabilitar movimentos inválidos antes do clique.

3. **Motor de cadência (geração bloco a bloco):**
   - A entrada em `1º dia de contato` gera **só as 3 atividades do bloco atual**.
   - Quando as 3 atividades do bloco são concluídas com `sem_resposta`, o próximo bloco é gerado (manhã → tarde).
   - Qualquer `conectou` **encerra a cadência**: as atividades restantes viram `cancelada` e o card vai para `Qualificando`.
   - **Virada de dia:** um job (D-S6), em dias úteis às 00:05 (`America/Sao_Paulo`), avança os cards cujos blocos do dia foram **todos** concluídos. Cards com pendências ficam como "atrasados": o avanço é por fato, não por tempo (Q3). O job é **idempotente** e registra cada execução.
   - Ao completar os 18 toques sem conexão, o card vai para `Perdido` com o motivo "Cadência esgotada", e o sistema oferece uma `tarefa_agendada` para 30–60 dias.
   - **Conexão por WhatsApp:** uma mensagem recebida pelo webhook da Evolution, de um número vinculado a uma oportunidade em cadência, gera o evento `conexao_whatsapp` e move o card para `Qualificando` (P9).
   - **Fila do dia:** a tela "Minhas tarefas" lista as atividades pendentes do turno vigente por operador.

4. **Ingestão:** um import idempotente (por `origem + id_externo`) lê as linhas novas das planilhas e do Supabase da LP e cria `leads` e `oportunidades` em `Entrada de leads`. O app **para de escrever status na planilha**; a liderança passa a consultar um espelho somente leitura (Q7, item 7).

5. **Atualização da UI:** SSE (D-S4) substitui a releitura completa a cada 120s.

6. **Rollout:** **cutover único para todas as empresas**, porque o pipeline é global (Q5) e a saída do Supabase acontece no mesmo momento. A reversão é feita pelo sistema antigo preservado (D2, passo 8). Não há convivência de dois pipelines.

7. **Regras definidas nas respostas de 17/09/2026:**
   - **Turnos (Q1):** Manhã 08h–12h e Tarde 13h–18h, segunda a sexta (`America/Sao_Paulo`); feriados nacionais pausam a cadência. O bloco da tarde só aparece a partir das 13h **e** depois de concluída a manhã.
   - **Reunião realizada (Q4), comprovação em camadas:**
     - quando existe evento no Google Calendar (`/api/agenda`), o horário e a duração vêm do evento;
     - em todos os casos, o Closer confirma início, fim e resumo num modal (duração ≥ 10 min);
     - uma **evidência** é obrigatória (print da chamada ou link da gravação), armazenada em `anexos`.
   - **Grafo de transições (Q8):** a sequência linear da lista do PRD §5.1 (Q2), mais os saltos permitidos:
     - conexão imediata (1º/2º/3º dia → Qualificando);
     - Qualificando → Follow de longo prazo;
     - Reunião agendada → No-show;
     - **Proposta → Negociação** (sem Teste);
     - **Proposta/Teste → Contrato**;
     - **No-show → Reunião agendada** (remarcação);
     - **Follow de longo prazo → 1º dia de contato** (nova cadência de 18 toques);
     - **qualquer etapa → Perdido** (com motivo).

     Qualquer outro movimento é bloqueado.
   - **Reabertura (Q9):** **qualquer papel** pode reabrir um card em Perdido ou Contrato (Ganho), com **justificativa obrigatória**. Isso gera o evento `reaberto`, e a liderança vê as reaberturas no relatório.
   - **Espelho no Sheets (Q7):** um job periódico (a cada 15 min) escreve numa aba **somente leitura** do Google Sheets o estado atual dos cards, só para consulta da liderança. As edições feitas nessa aba **são ignoradas**.

8. **Migração dos cards atuais** (script idempotente, *dry-run* em CSV revisado por @Alana e @Karol, evento `migrado_de` em cada card):

   | Situação atual | Etapa nova | Observação |
   |---|---|---|
   | Novos Leads / Sem situação | Entrada de leads | — |
   | Em contato | **Revisão manual** → 1º/2º/3º dia ou Qualificando | Depende de ter havido conexão |
   | Recontato | Follow de longo prazo | Exige `proxima_acao_em`; sem data → fila de revisão |
   | Reunião agendada | Reunião agendada | — |
   | Aguardando Ativação | Teste (Trial) | Exige `proxima_acao_em` |
   | Logins Ativados / Fechamento de Clientes | Contrato (Ganho) | Preserva `data_fechamento` |
   | Sem interesse | Perdido | Motivo: "Sem interesse" |
   | Desqualificado | Perdido | Motivo: "Sem perfil/fit" |
   | Arquivado | Perdido | Motivo: "Legado — arquivado" |

**Prós:** atende C1 e C2; log de eventos para todos os KPIs; remove a rota de 752 linhas que mistura três fontes; regras testáveis (P-001).

**Contras:** esforço maior; perda da edição direta na planilha; lógica no banco exige disciplina de migrations; convivência temporária de dois fluxos por flag.

**Custo:** GRANDE — ~30–40 pessoa-dias · Risco: **MÉDIO**

---

### Opção A3: Adotar um CRM de mercado com cadências nativas (Pipedrive, HubSpot, RD Station CRM, Meetime)

**Prós:** cadências, tarefas, relatórios e app mobile prontos.

**Contras:** **contraria o PRD §7.2** e a direção de infra própria (C7/C11); custo por usuário cresce com o time (R$ 50–300/usuário/mês); perde a integração de WhatsApp, o multi-tenant, as campanhas e os relatórios; travas finas (no-show de 24h, blocos por turno) costumam exigir plano Enterprise.

**Custo:** MÉDIO (setup) + recorrente ALTO · **Veredito:** plano B caso P5 seja invalidada.

---

### Opção A4: Não fazer nada

**Contras:** não atende nenhum objetivo do PRD e mantém o time impossível de escalar (PRD §2.3). **Custo:** pequeno agora, grande no longo prazo.

---

### Sub-decisões de A2

| Tema | Alternativas | Recomendação | Motivo |
|---|---|---|---|
| **Onde ficam as regras** | (a) só UI · (b) só API · (c) domínio TS + função/constraints SQL · (d) só PL/pgSQL | **(c)** | Testável em TS, reutilizado pela UI, invariantes garantidas no banco |
| **Geração das atividades** | (a) as 18 na entrada · (b) bloco a bloco · (c) só contadores | **(b)** | (a) exige reagendar tudo em ausências; (c) perde a auditoria |
| **Grafo de transições** | (a) linear estrito · (b) linear com saltos permitidos e explícitos | **(b)** ✅ definido (Q8, item 7) | O PRD mostra desvios (conexão imediata, no-show, perdido) |

### Comparação — Decisão A

| Critério | A1 Sheets | **A2 Eventos em Postgres** ⭐ | A3 CRM SaaS | A4 Nada |
|---|---|---|---|---|
| C1 Regras aplicadas (Must) | ❌ | ✅ | ⚠️ | ❌ |
| C2 Migração com histórico (Must) | ⚠️ | ✅ | ⚠️ | n/a |
| C5 Rastreabilidade | Baixa | **Alta** | Alta | Nenhuma |
| C6 Tempo até o piloto | ~4 sem | ~6 sem após D | ~3–4 sem | — |
| C7 Custo/controle | Alto | **Alto** | Baixo | — |
| C10 Reversibilidade | Média | **Alta** (flag) | Baixa | — |

**Recomendação A:** **A2**.

---

## 7. Decisão B — Infraestrutura e Esteira de Entrega

### Opção B1: Não fazer nada

**Contras:** sem homologação, testes, migrations, backup do banco próprio nem rollback. Com D2, isso **fere C3 diretamente**. **Veredito:** ❌ desqualificada.

---

### Opção B2: Evolução incremental na VPS (CI com gates + imagem versionada + staging + banco como código + backup) ⭐ (Recomendada)

**Como funciona:**

1. **CI com gates (GitHub Actions)** em todo PR e push: `npm ci` → `eslint` → `tsc --noEmit` → testes (com **Postgres como service container**) → `next build`. Merge na `main` só via PR com CI verde.

2. **Testes:**
   - **Unitários** do domínio (máquina de estados e cadência). Cada regra do PRD vira teste anotado (`@principle`/AC), integrado ao `onp-spec-driven`.
   - **Integração** dos repositórios e das funções SQL contra Postgres real (Testcontainers ou o service do CI).
   - **E2E** (Playwright) do "card de teste" (PRD §10.4) e do login/convite/reset (regressão da troca de auth).
   - Runner: Vitest (Q6).

3. **Build fora da VPS:** a imagem é publicada no **GHCR** com tag `sha`; a VPS só faz `docker compose pull && up -d`. **Rollback** = subir a tag anterior. Isso também **libera a memória** que o build usava, necessária para o Postgres (P7).

4. **Topologia Docker na VPS (proposta):**

   ```mermaid
   flowchart LR
     subgraph VPS["VPS (2 vCPU · 7,8 GB) — rede wp-network"]
       proxy["nginx-proxy-manager (TLS)"]
       app["crm-app (prod) :3001"]
       appstg["crm-app (staging)"]
       worker["crm-worker (cron da cadência + import)"]
       pg[("pg-master · postgres:15-alpine\nDB crm_prod · DB crm_staging\nroles crm_app / crm_migrator")]
       bkp["pg_dump + rclone (03h/11h/19h)"]
       evo["Evolution API"]
       vol[["Volume: anexos (prints)"]]
       outros["Outros projetos:\nstack Supabase self-hosted,\nmedguia-hub, nps-ifot\n(intocados — P14)"]
     end
     ext[("Armazenamento externo\n(destino do rclone — Q12)")]
     proxy --> app & appstg
     app & appstg & worker --> pg
     app --> vol
     evo -- webhook --> app
     pg --> bkp --> ext
     vol -. cópia diária .-> ext
     outros -.- pg
   ```

   **R-VPS-1 — banco exposto à internet (achado de 17/09/2026, severidade ALTA):** o `pg-master` publica `0.0.0.0:5432`, o **`ufw` está inativo** (sem firewall no host) e o usuário administrativo usa uma senha previsível. Na verificação, **nenhuma conexão externa estava estabelecida** (`ss -tnp state established '( sport = :5432 )'` vazio), o que indica que a porta publicada não tem uso legítimo.

   **Ações (§11):**
   1. trocar a senha do usuário administrativo do `pg-master` e a API key da Evolution API, que circularam fora do cofre de segredos;
   2. remover o `ports:` do `pg-master` (ou restringir a `127.0.0.1:5432`), alinhando antes com os outros projetos;
   3. ativar o firewall do host, liberando apenas 22, 80 e 443.

   O CRM **não** publicará porta nenhuma: acesso só pela rede `wp-network` e administração por túnel SSH.

   **Verificação de impacto (17/09/2026):** as únicas conexões ativas no `pg-master` vêm do container da Evolution API (`172.18.0.12`, IP interno da rede Docker). **Nenhum cliente externo usa a porta publicada**, então fechá-la não afeta nenhum projeto.

   **R-VPS-2 — o `pg-master` não tem backup (severidade ALTA):** o cron diário cobre apenas o `supabase-db`. Os databases `evolution`, `followup_agent`, `nps_ifot` e `medguia_obs` estão **sem qualquer cópia**. Como o cluster inteiro tem ~70 MB, o script de backup do CRM deve rodar **`pg_dumpall` do cluster completo**, protegendo os outros projetos pelo mesmo custo. Fora do escopo formal deste RFC, mas resolvido de graça por ele.

   **R-VPS-3 — superusuário único:** todos os projetos conectam como `admin` (superusuário), de modo que qualquer app comprometido alcança os dados de todos os outros. O CRM inaugura o padrão correto (`crm_app` e `crm_migrator`, sem `SUPERUSER` nem `BYPASSRLS`), e a migração dos demais projetos fica como recomendação.

   - **Postgres nunca exposto publicamente:** sem `ports:` publicado; acesso administrativo só por túnel SSH.
   - **Roles separadas:** `crm_migrator` (DDL, usada só pelo job de migration) e `crm_app` (DML, sem `BYPASSRLS`).
   - **Staging:** database `crm_staging` (ou um container separado, conforme D-S9), recriável a partir de um dump **anonimizado** de produção.
   - Limites de memória e CPU por serviço; `healthcheck` em todos.

5. **Banco como código:**
   - Migrations do **drizzle-kit** versionadas no repo, incluindo RLS, funções, `pg_cron` e seeds (`pipeline_etapas`, `motivos_perda`).
   - O deploy roda um **job de migration** (container efêmero com `crm_migrator`) **antes** de subir a nova imagem. As migrations são compatíveis com a versão anterior do app (*expand/contract*), para que o rollback de imagem seja seguro.

6. **Backup e recuperação (requisito de go-live de D2)** — modelado no script que já roda na VPS (`/root/backups/supabase/backup-supabase.sh`), que serve de referência pronta:
   - `pg_dump --format=custom --no-owner` do database do CRM + **`pg_dumpall` do cluster inteiro** (~70 MB, protege também `evolution`, `followup_agent`, `nps_ifot` e `medguia_obs`, hoje sem backup — R-VPS-2);
   - `sha256sum` de cada arquivo, retenção de **7 diários + 4 semanais** em disco;
   - `rclone sync` para o remote **`gdrive:`** já configurado, em **pasta própria do CRM** (separada da do outro projeto);
   - **alerta por WhatsApp via Evolution API** em caso de falha **e** de sucesso, no mesmo padrão do script existente;
   - o **volume de anexos** (prints) entra no mesmo pacote;
   - cron diário às 03h, em horário diferente do backup do outro projeto, para não disputar CPU (a VPS tem 2 vCPU).

   **O que exatamente se perde no pior caso (análise de 17/09/2026).** Hoje a VPS guarda pouco dado exclusivo, porque o Sheets é a fonte de verdade. Depois da migração isso se inverte:

   | Dado | Recuperável fora do backup? |
   |---|---|
   | Leads (nome, contato, origem) | **Sim** — continuam chegando pelo Google Sheets |
   | Etapa atual do card | **Parcial** — o espelho somente leitura (Q7) é atualizado a cada 15 min |
   | Atividades da cadência e seus checks | **Não** |
   | Log de eventos (quem moveu, quando, de onde para onde) | **Não** |
   | Notas, prints e evidências de reunião | **Não** |
   | Histórico de WhatsApp | **Não** |
   | Propostas, valores e motivos de perda | **Não** |
   | Usuários e sessões | **Não** |

   Ou seja: um desastre ao fim do dia não custa os leads, custa **o trabalho do dia** — quais ligações foram feitas, o que foi anotado e em que tentativa cada lead está. Como a régua de 18 toques depende justamente desse registro, a operação do dia seguinte ficaria sem saber onde retomar. **O Driver aceitou esse risco em troca de simplicidade operacional**, ciente de que aumentar a frequência é uma mudança de uma linha de cron.

   Demais itens:
   - WAL contínuo + base backup diário → R2/B2 (retenção de 14 dias), mais `pg_dump` lógico semanal (retenção de 8 semanas).
   - Backup do volume de anexos.
   - **Restore ensaiado** em staging antes do cutover e depois **todo mês** (checklist documentado).
   - Alerta se o último backup tiver mais de 24h.

7. **Segredos e configuração:** só `NEXT_PUBLIC_*` como build args; o resto só em runtime. Validação de env no boot (`zod`). `DATABASE_URL` distinta por ambiente. Remover as variáveis do Supabase depois do período de rollback.

8. **Observabilidade:**
   - `GET /api/health` (app + banco + idade do último backup + última execução do cron).
   - Monitor de uptime externo e Sentry.
   - Logs estruturados.
   - Métricas do Postgres (`pg_stat_statements`, disco) com alerta de disco > 80%.

9. **Higiene de código:** quebrar `api/sheets/route.ts` em `ingestao/` e `oportunidades/`; tipos gerados pelo schema Drizzle; remover `.vercel/`, o `next-auth` sem uso (se D-S1 = Better Auth) e o `tsconfig.tsbuildinfo`; README com o setup local (`docker compose -f compose.dev.yml up`).

**Prós:** entrega homologação, testes, migrations, backup e rollback com baixo custo e numa só plataforma; tirar o build da VPS abre espaço para o Postgres.

**Contras:** tudo continua sob responsabilidade de 1 dev; staging divide recursos com produção; mais peças para documentar.

**Custo:** MÉDIO — ~10–14 pessoa-dias (inclui backup/restore) · Financeiro: ~R$ 0–30/mês · Risco: **BAIXO**

---

### Opção B3: Migrar a aplicação para uma PaaS (Vercel) mantendo o banco na VPS

**Prós:** *preview* por PR sem operar servidor para o app.

**Contras:** **conflita com D2**, porque o app serverless precisaria acessar um Postgres na VPS pela internet: exporia o banco ou exigiria túnel/pooler, além da latência. Duas plataformas; timeouts de funções; custo do plano Pro. **Veredito:** ❌ incompatível com a direção de D2.

---

### Comparação — Decisão B

| Critério | B1 Nada | **B2 Evolução na VPS** ⭐ | B3 Vercel + BD na VPS |
|---|---|---|---|
| C2 Ensaio de migração (Must) | ❌ | ✅ | ✅ |
| C3 Recuperação (Must) | ❌ | ✅ | ✅ |
| C4 Banco não exposto (Must) | ✅ | ✅ | ❌ |
| C6 Tempo | — | ~2,5 semanas | ~2 semanas |
| C8 Carga operacional | Baixa (arriscada) | Média | Média + 2 plataformas |

**Recomendação B:** **B2**.

---

## 8. Recomendação Consolidada e Roadmap

Adotar **D2 + A2 + B2** como **uma única iniciativa, com um cutover só** (decisão do Driver, 17/09/2026). O sistema atual continua rodando e recebendo apenas correções críticas até a virada.

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    title Roadmap proposto — redesenho direto (1 dev ~60%)
    section Fase 0 — Fundação (B2)
    TDD aprovado                                 :f0a, 2026-10-01, 5d
    CI gates (lint/tsc/Vitest) + proteção da main :f0b, 2026-10-01, 4d
    Imagem no GHCR + rollback por tag            :f0c, after f0b, 3d
    Postgres: DBs, roles, staging, backup+restore :f0d, after f0c, 5d
    Health + Sentry + uptime                     :f0e, after f0d, 2d
    section Fase 1 — Núcleo novo (D2 + A2)
    Schema completo no Drizzle (auth+domínio+pipeline) :f1a, after f0a, 6d
    Better Auth + RBAC por empresa + convites    :f1b, after f1a, 5d
    Repositórios + RLS por empresa + testes      :f1c, after f1b, 6d
    Domínio: máquina de estados + guards         :f1d, after f1c, 6d
    section Fase 2 — Funcionalidades
    Kanban 15 etapas + modais de trava           :f2a, after f1d, 6d
    Cadência: blocos, fila do turno, relógio     :f2b, after f2a, 7d
    WhatsApp (SSE) + conexão automática + prints :f2c, after f2b, 5d
    Campanhas, relatórios e admin no modelo novo :f2d, after f2c, 6d
    Espelho somente leitura no Sheets            :f2e, after f2d, 2d
    section Fase 3 — Migração e virada
    ETL (Supabase + Sheets + LP) → modelo novo   :f3a, after f2e, 5d
    Ensaios em staging + revisão de @Alana/@Karol :f3b, after f3a, 4d
    Card de teste E2E + aceite da operação       :f3c, after f3b, 3d
    Cutover único (freeze, ETL final, reset de senhas) :milestone, after f3c, 0d
```

**Estimativa total:** ~55–65 pessoa-dias, cerca de **4,5–5 meses a 60%**. O redesenho direto **economiza ~10 pessoa-dias** frente ao caminho em duas etapas, porque as telas e o acesso a dados são escritos uma vez só, já no modelo novo, e há um cutover em vez de dois.

**A troca (trade-off) que os Approvers precisam aceitar:** por uns 4 meses **não há entrega visível** para a operação, e a virada é de uma vez (*big-bang*), sem rollout gradual por empresa. Em compensação, não há retrabalho, nem conviverão dois pipelines, nem duas janelas de parada.

**Go/no-go do cutover único:**
- CI verde, com as regras do PRD §5 cobertas por testes automatizados.
- Ensaio do ETL em staging: contagens batem por empresa, zero cards sem etapa e fila de revisão manual zerada.
- Card de teste aceito por @Karol e @Erivelton em staging (PRD §10.4).
- Backup externo funcionando e **restore ensaiado** com sucesso.
- Plano de rollback escrito e ensaiado: imagem antiga + Supabase em leitura por 30 dias, com janela de retorno de 48h.
- Comunicação enviada com uma semana de antecedência, avisando da parada e do reset de senha.

---

## 9. Questões — respostas de 17/09/2026

| # | Questão | Resposta | Onde entrou |
|---|---|---|---|
| Q1 ✅ | Horários dos turnos e dias de operação | **Manhã 08h–12h, Tarde 13h–18h, seg–sex**, com pausa em feriados nacionais | P4; A2 item 7 |
| Q2 ✅ | Ordem canônica das etapas | **A ordem da lista do PRD §5.1** (Follow = 7, No-show = 9, Perdido = 15) | Seed `pipeline_etapas` |
| Q3 ✅ | Card sem os blocos do dia concluídos | **Não avança: fica "atrasado"** até as pendências serem feitas (avanço por fato) | A2 item 3 |
| Q4 ✅ | Comprovação de "reunião ≥ 10 min" | **As três camadas juntas:** Google Calendar quando houver evento + declaração do Closer (início/fim/resumo) + **evidência anexada obrigatória** | A2 item 7 |
| Q5 ✅ | O pipeline vale para todos os tenants? | **Sim, global para todas as empresas** | P3; A2 item 6 |
| Q6 ✅ | Runner de testes | **Vitest** (+ Playwright para E2E); `onpspec.config.json` passa a usar `vitest run` | B2 item 2 |
| Q7 ✅ | Planilha para a liderança | **Espelho automático somente leitura** no Google Sheets, atualizado a cada 15 min; edições na aba são ignoradas | A2 item 7 |
| Q8 ✅ | Saltos permitidos | Proposta → Negociação · Proposta/Teste → Contrato · No-show → Reunião agendada · Follow → 1º dia de contato · qualquer etapa → Perdido (com motivo) | A2 item 7 |
| Q9 ✅ | Quem reabre Perdido/Ganho | **Qualquer papel, com justificativa obrigatória** registrada no log de eventos | A2 item 7 |
| Q10 ✅ | Specs da VPS e do Postgres existente | **2 vCPU · 7,8 GB RAM (4,2 GB livres, sem swap) · 96 GB de disco (75 GB livres).** Postgres: **`pg-master`, versão 15.18 (Alpine)**, rede `wp-network`, bind mount `/root/postgres/data`, sem limite de memória, porta 5432 publicada, ~70 MB em 6 databases (`evolution`, `followup_agent`, `nps_ifot`, `medguia_obs`, `admin`, `postgres`), todos acessados pelo superusuário `admin`. Só a Evolution API mantém conexões, e elas são internas. A VPS também roda a **stack Supabase self-hosted de outro projeto (intocável)** e `rclone` (`gdrive:`) com backup diário às 03h **que não cobre o `pg-master`**. **Decisão: databases + roles dedicados no `pg-master`** | P7, P8, P11, P14; D-S6, D-S7, D-S9; R-VPS-1, R-VPS-2 |
| Q11 ✅ | Migrar hashes de senha? | **Não.** Todos redefinem a senha no cutover, por e-mail (Resend) | P10; D2 passo 3 |
| Q12 ✅ | Backups: frequência e destino | **`pg_dump` diário às 03h**, enviado por `rclone` para o **mesmo remote já configurado na VPS**, em pasta própria do CRM. RPO = 24h, aceito pelo Driver, com a opção de passar para frequência horária se a liderança pedir | P11; D-S7; risco na §10 |
| Q13 ✅ | Exigência de região (LGPD) | **Não há.** Backups podem ficar fora do Brasil, desde que criptografados e com acesso restrito | D-S7 |
| Q14 ✅ | Ordem das fases | **Redesenho direto em entrega única:** sair do Supabase e implantar o pipeline juntos, com um cutover só (sem *lift-and-shift* e sem D4) | §5 D2; §8 |

---

## 10. Riscos e Mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| **Perda de dados por falha da VPS/disco** com banco próprio | Média | **Crítico** | Backup diário externo (D-S7), restore mensal ensaiado, alerta de backup atrasado e de disco > 80% |
| **Perda de até 24h de operação** por causa do RPO do backup diário | Baixa | Alto | **Reconfirmado pelo Driver em 17/09/2026, após análise da exposição real** (abaixo). Mitigação disponível a custo quase zero, se a liderança quiser depois: `pg_dump` horário (o cluster tem ~70 MB) e/ou enriquecer o espelho do Sheets com dia de cadência, tentativas e próxima ação |
| **Cutover *big-bang***: tudo muda de uma vez (banco, login, telas e pipeline), sem rollout gradual | **Alta** | Alto | Ensaios repetidos em staging; card de teste aceito pela operação; janela em fim de semana; sistema antigo preservado por 30 dias com retorno possível em 48h; plantão do Driver na segunda-feira seguinte |
| Usuários sem conseguir logar após a troca de auth | Média | Alto | Reset de senha planejado e comunicado (P10); E2E de login/convite/reset; lista de usuários conferida antes da virada; @Raniery cria senha provisória se alguém não receber o e-mail |
| **Período longo sem entrega visível** (~4 meses) desmotivar os stakeholders | Média | Médio | Demonstrações quinzenais em staging; a Fase 2 já mostra o Kanban novo funcionando antes da virada |
| Vazamento entre empresas (multi-tenant) após remover RLS do Supabase | Baixa | Crítico | Repositório exige `empresa_id`; RLS com `current_setting`; testes de isolamento no CI |
| Postgres compartilhado sofrendo com a carga de outros sistemas | Média | Médio | Database/role próprios, limites de recursos ou container dedicado (D-S9) |
| Perda ou duplicação de leads na troca de fonte de verdade | Média | Alto | Import idempotente, *dry-run*, snapshot antes do go-live, evento `migrado_de` |
| Operação rejeitar as travas | Média | Médio | Homologação com a Karol; mensagens de bloqueio explicando a regra do Playbook |
| Cron/worker falhar silenciosamente | Baixa | Alto | Tabela de execuções + health + job idempotente |
| Esforço maior que o estimado (1 dev) | **Alta** | Médio | Marcos quinzenais; se a Fase 2 atrasar mais de 3 semanas, reavaliar o escopo com os Approvers (ex.: adiar campanhas/relatórios para depois da virada); A3 como plano B |
| Upgrade de versão do Postgres quebrar algo | Baixa | Médio | Versão fixada na imagem; upgrade ensaiado em staging |

---

## 11. Action Items (após aprovação)

| Ação | Dono | Prazo | Status |
|---|---|---|---|
| Responder às questões Q1–Q9, Q11, Q13 e Q14 | @Raniery (com @Erivelton, @Alana, @Karol) | 2026-09-17 | **DONE** |
| Homologar com @Erivelton e @Alana as respostas de Q1–Q9 registradas no §9 | @Raniery | 2026-09-26 | NOT STARTED |
| Levantar specs da VPS e do Postgres existente (Q10) | @Raniery | 2026-09-17 | **DONE** |
| Confirmar o usuário/role e os databases do `pg-master` e o remote do `rclone` (dado operacional para a Fase 0) | @Raniery | 2026-09-19 | IN PROGRESS |
| Apresentar a @Alana o RPO de 24h e confirmar se aceita, ou subir para frequência horária (D-S7) | @Raniery | 2026-09-26 | NOT STARTED |
| **Rotacionar a senha administrativa do `pg-master` e a API key da Evolution API** (credenciais saíram do cofre) | @Raniery | 2026-09-19 | NOT STARTED |
| Fechar a porta 5432 do `pg-master` (sem uso externo comprovado) e ativar o firewall do host (R-VPS-1) | @Raniery | 2026-09-26 | NOT STARTED |
| Estender o backup para o cluster inteiro do `pg-master`, cobrindo os projetos hoje sem cópia (R-VPS-2) | @Raniery | 2026-10-16 (Fase 0) | NOT STARTED |
| Definir o destino dos backups (Q12) e validar o RPO aceitável com a liderança | @Caetano / @Raniery | 2026-09-26 | NOT STARTED |
| Reunião de decisão deste RFC | @Caetano | 2026-09-30 | NOT STARTED |
| Escrever o TDD (`/docs/tdds/TDD-001-...`): schema, auth, repositórios, funções, rotas, topologia Docker | @Raniery | 2026-10-07 | NOT STARTED |
| Fase 0: CI + GHCR + rollback | @Raniery | 2026-10-09 | NOT STARTED |
| Fase 0: databases, roles e backup externo com restore ensaiado | @Raniery | 2026-10-16 | NOT STARTED |
| Especificar as features no `onp-spec-driven` (US/AC rastreáveis ao PRD §5 e à migração) | @Raniery | 2026-10-09 | NOT STARTED |
| Validar `motivos_perda` e o mapeamento de migração dos cards | @Alana / @Erivelton | 2026-10-09 | NOT STARTED |
| Comunicar aos usuários a janela de cutover e o reset de senha | @Caetano | 1 semana antes do cutover | NOT STARTED |
| Roteiro do "card de teste" | @Karol / @Erivelton | antes da Fase 3 | NOT STARTED |

---

## 12. Resultado (Outcome)

> _Preencher após a decisão._

**Decisão D (plataforma):** _[D1 / D2 / D3 / D4]_
**Decisão A (pipeline):** _[A1 / A2 / A3 / A4]_
**Decisão B (infra):** _[B1 / B2 / B3]_
**Sub-decisões aprovadas:** _[D-S1…D-S9]_

**Data da decisão:** _AAAA-MM-DD_

**Decidido por:** _@Alana Alexandre, @Caetano Lima_

**Justificativa:** _[referenciar os critérios C1–C11]_

**Condições / ressalvas:**
- _ex.: "D2 aprovada condicionada a backup externo com restore ensaiado antes do cutover"_

**Follow-up:**
- [ ] Criar o TDD de implementação
- [ ] Atualizar o README e o runbook de deploy/backup/restore
- [ ] Notificar os stakeholders informados
- [ ] Desativar o projeto Supabase 30 dias após o cutover
- [ ] Retrospectiva 30 dias após o go-live do pipeline (KPIs do PRD §6)

---

## 13. Referências

- [PRD-001 — Pipeline Comercial e Motor de Cadência](../prds/PRD-001-pipeline-comercial-cadencia.md)
- `docs/Playbook CRM Atento - MedGuia.pdf` · `docs/Resumo_Reuniao_Medguia_Consultor_Erivelton.pdf`
- `.spec/constituicao.md` — P-001 (todo requisito tem prova executável)
- Código atual: `src/app/api/sheets/route.ts`, `src/app/api/usuarios/route.ts`, `src/middleware.ts`, `src/contexts/whatsapp-unread-context.tsx`, `src/components/kanban/kanban-board.tsx`, `src/hooks/use-leads.ts`, `.github/workflows/deploy.yml`, `Dockerfile`, `docker-compose.yml`
- PostgreSQL: Row Level Security, `LISTEN/NOTIFY`, `pg_cron`
- pgBackRest / WAL-G — backup contínuo e PITR
- Better Auth · Drizzle ORM / drizzle-kit
- GitHub Actions: Environments com *required reviewers*; GitHub Container Registry
