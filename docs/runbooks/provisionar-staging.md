# Runbook: Provisionar o staging do CRM na VPS

> Objetivo: ter `crm_staging` no `pg-master`, com migrations aplicadas e o app
> acessível só para a equipe, para ensaiar o ETL (TDD-001 §16) e o card de teste.
> Fonte dos arquivos: `infra/postgres/init/01-databases-and-roles.sql`,
> `docker-compose.staging.yml`, `drizzle/`.
>
> **Estado deste documento:** passos 2 e 3 já executados na VPS (22/10); os demais
> foram escritos a partir do código e ainda não rodaram. Ajuste o que a máquina
> real contradisser e registre aqui. Medições da VPS em 23/10: ver "Prontidão da VPS".

## Prontidão da VPS (medida em 23/10)

| Item | Estado |
|---|---|
| Docker 29.5.2, Compose v5.1.4, `wp-network` com `pg-master` e proxy | ok |
| `crm_staging`/`crm_prod`, `crm_app`/`crm_migrator` (sem superusuário) | ok |
| Migrations: 14 arquivos, 24 tabelas, 15 etapas, 12 políticas RLS, 11 funções, `crm_app` DML sim / DDL não | ok |
| Backup `/root/backups/pg-master-pre-crm_2026-10-22_1337.sql.gz` | ok |
| Swap de 2 GB (`swappiness=10`, no `fstab`) | criado em 23/10 |
| Imagem no ghcr: o `release.yml` publica só `:<sha-do-commit>`, **nunca `:latest`** | usar o SHA da `main` |
| `.env.staging` | **incompleto**: 7 variáveis, 2 URLs ainda com `TROCAR` |
| Domínio, DNS e host virtual com Access List (proxy tem 9 hosts) | pendente |
| `crm-worker-staging` | bloqueado pelo Dockerfile |

## Antes de começar

- Acesso SSH root à VPS. O código novo vai para **`/root/crm-staging`** (copiado
  com `rsync`). **Não use `~/scrumboard-medguia`**: é o legado em produção
  (cópia de 10/07, sem `.git`). Nos passos abaixo, `cd /root/crm-staging`.
- A VPS tem 2 vCPU e ~7,8 GB de RAM (~2,7 GB disponíveis, 2 GB de swap criados em 23/10). Por isso os
  containers descartáveis rodam com `--memory 1g`: um estouro de memória não
  pode derrubar os outros serviços.
- O `pg-master` já roda e tem dados de **outros projetos**. Nada aqui apaga ou
  altera esses bancos; só cria dois bancos e duas roles novas.
- Faça um backup do cluster antes do passo 2 (`pg_dumpall`).
- O `docker-compose.yml` de produção **não** é tocado. O staging usa
  `docker-compose.staging.yml`, que o `deploy.yml` não copia: leve-o à mão.

## Passo 1 — Senhas e `.env.staging`

Gere as senhas fora do repositório e guarde em um gerenciador de senhas:

As senhas do banco entram dentro de uma URL (`postgres://usuario:SENHA@host/...`),
então use **hexadecimal**: o base64 gera `/`, `+` e `=`, que quebram a URL.

```bash
openssl rand -hex 24      # crm_app
openssl rand -hex 24      # crm_migrator
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -hex 24      # CRON_SEGREDO
openssl rand -hex 24      # ANEXOS_SEGREDO
```

Para não deixar os valores na tela nem no histórico, gere e grave direto no arquivo
(com `umask 077`, para o arquivo nascer só legível pelo dono):

```bash
cd /root/crm-staging && umask 077
cat > .env.staging <<EOF
CRM_APP_PASSWORD=$(openssl rand -hex 24)
CRM_MIGRATOR_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
CRON_SEGREDO=$(openssl rand -hex 24)
ANEXOS_SEGREDO=$(openssl rand -hex 24)
BETTER_AUTH_URL=https://TROCAR-pelo-dominio-do-staging
NEXT_PUBLIC_APP_URL=https://TROCAR-pelo-dominio-do-staging
EOF
```

Complete `/root/crm-staging/.env.staging` (permissão `600`, nunca commitar) com
as variáveis que o código lê:

| Variável | Observação |
|---|---|
| `CRM_APP_PASSWORD`, `CRM_MIGRATOR_PASSWORD` | as senhas geradas acima |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | URL pública do staging |
| `NEXT_PUBLIC_APP_URL` | URL pública do staging |
| `CRON_SEGREDO`, `ANEXOS_SEGREDO` | segredos diferentes dos de produção |
| `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID_1/2/3` | mesmos do legado (leitura) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | origem do ETL (Supabase do CRM) |
| `SUPABASE_LP_URL`, `SUPABASE_LP_ANON_KEY`, `SUPABASE_LP_SERVICE_KEY` | origem da landing page (ver Q-033) |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | **instância de teste**, não a de produção |
| `RESEND_WEBHOOK_SECRET` e a chave do Resend | conferir o nome exato em `src/lib/resend/` |

> **WhatsApp e e-mail em staging:** aponte a Evolution API para uma instância
> de teste e use um domínio/chave de teste no Resend. Staging com credencial de
> produção pode mandar mensagem real para lead real.

## Passo 2 — Criar `crm_staging` e as roles no `pg-master`

O Postgres só executa os scripts de `/docker-entrypoint-initdb.d` na **primeira**
inicialização do cluster. Como o `pg-master` já existe, o script precisa ser
aplicado à mão, pelo `psql` do próprio container:

```bash
cd /root/crm-staging
set -a; source .env.staging; source .env; set +a   # POSTGRES_ADMIN_USER vem do .env

docker exec -i \
  -e CRM_APP_PASSWORD="$CRM_APP_PASSWORD" \
  -e CRM_MIGRATOR_PASSWORD="$CRM_MIGRATOR_PASSWORD" \
  pg-master psql -U "$POSTGRES_ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 \
  < infra/postgres/init/01-databases-and-roles.sql
```

O script é idempotente. **Atenção:** ele cria também um `crm_prod` **vazio**, além
do `crm_staging`. Um banco vazio não afeta o legado, mas confirme que está de
acordo antes de rodar.

Conferência:

```bash
docker exec pg-master psql -U "$POSTGRES_ADMIN_USER" -d postgres -c '\l' | grep crm_
docker exec pg-master psql -U "$POSTGRES_ADMIN_USER" -d postgres -c '\du' | grep crm_
```

Esperado: `crm_prod`, `crm_staging`, `crm_app` e `crm_migrator`, nenhuma das
roles com superusuário.

## Passo 3 — Aplicar as migrations no `crm_staging`

> **Não use `drizzle-kit migrate`.** O journal do drizzle (`drizzle/meta/_journal.json`)
> lista só 4 dos 14 arquivos de `drizzle/`: RLS, constraints, funções, seeds,
> WhatsApp de entrada e cadência são SQL escrito à mão e ficam fora dele. Rodar
> `drizzle-kit migrate` deixa o banco **sem RLS, sem funções e sem as 15 etapas**
> (descoberto no primeiro ensaio, 22/10). Os testes aplicam todos os `drizzle/*.sql`
> em ordem, como `crm_migrator`; o staging faz o mesmo.

```bash
cd /root/crm-staging
for f in $(ls drizzle/*.sql | LC_ALL=C sort); do
  echo "== $f"
  docker exec -i pg-master psql -U crm_migrator -d crm_staging -v ON_ERROR_STOP=1 -q < "$f" \
    || { echo "FALHOU em $f"; break; }
done
```

Os `NOTICE ... does not exist, skipping` são normais (os arquivos fazem
`DROP ... IF EXISTS` antes de criar). Pare em qualquer `FALHOU` ou `ERROR`.
Isto só vale para um banco **novo**: os arquivos não rastreiam o que já foi
aplicado. Para reaplicar, recrie o banco (passo 8).

Conferência (como `admin`, só leitura):

```bash
docker exec pg-master psql -U admin -d crm_staging \
  -c "SELECT count(*) AS etapas FROM pipeline_etapas" \
  -c "SELECT count(*) AS motivos FROM motivos_perda" \
  -c "SELECT count(*) AS politicas_rls FROM pg_policies" \
  -c "SELECT has_table_privilege('crm_app','public.leads','INSERT') AS app_dml, has_schema_privilege('crm_app','public','CREATE') AS app_ddl"
```

Esperado: 15 etapas, os motivos de perda do seed, 12 políticas de RLS
(11 da `0001` + 1 da `0009`), `app_dml = t` e `app_ddl = f`.

## Passo 4 — Subir o app e o worker de staging

```bash
cd /root/crm-staging
docker login ghcr.io -u ranieryfialho        # token com read:packages
export IMAGE_TAG=<sha-completo-do-commit-na-main>   # não existe :latest
docker compose --env-file .env.staging -f docker-compose.staging.yml pull
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d crm-app-staging
```

> **O `crm-worker-staging` usa a imagem de worker** (`scrumboard-medguia-worker:<sha>`, estágio `worker` do
> Dockerfile), e não a do site, que não traz `src/worker` nem `tsx`. Use o mesmo `IMAGE_TAG` e suba com
> `docker compose ... up -d crm-worker-staging`. O ensaio do ETL (passo 6) roda por linha de comando e não depende dele.

## Passo 5 — Acesso restrito ao staging

No nginx-proxy-manager: crie um host virtual para o staging apontando para
`crm-app-staging:3000` (porta interna, o container não publica porta), com
**Access List** (usuário e senha) ou restrição por IP, e TLS. Só quem tem a
credencial deve alcançar o staging (AC-006).

Conferência: sem credencial, o host retorna 401/403; com credencial,
`/api/health` responde.

## Passo 6 — Ensaio do ETL (dry-run primeiro)

O ETL grava como **`crm_migrator`** (dono das tabelas): a RLS está ligada e o ETL
não define `app.empresa_id`, então como `crm_app` ele não conseguiria gravar (os
testes dele também usam o `crm_migrator`). A conexão de origem é separada.

**6.1 — Variáveis do ETL** (`.env.etl`, `chmod 600`, nunca commitar). A URL do
Supabase do CRM é montada com a senha do usuário de leitura `etl_leitura` (ver
"Acesso de leitura ao Supabase" abaixo); o resto é acrescentado assim:

```bash
cd /root/crm-staging
set -a; source .env.staging; set +a
{
  echo "SUPABASE_LEGADO_TABELA_USUARIOS=etl.usuarios"
  echo "DATABASE_URL=postgres://crm_migrator:${CRM_MIGRATOR_PASSWORD}@pg-master:5432/crm_staging"
} >> .env.etl
cut -d= -f1 .env.etl     # só os nomes
```

**6.2 — Dry-run** (não grava nada; a fila de revisão vai para fora do repositório,
porque tem dados pessoais):

```bash
mkdir -p /root/etl-saida && chmod 700 /root/etl-saida
docker run --rm --memory 1g --network wp-network \
  -v "$PWD":/app -v /root/etl-saida:/saida -w /app --env-file .env.etl \
  node:20-alpine sh -c "npx tsx scripts/etl-supabase.ts --dry-run --fila-revisao /saida/fila-supabase.csv"
```

Repita para `scripts/etl-sheets.ts` (depende do Supabase já ter rodado, por causa
das empresas) e `scripts/etl-lp.ts` (precisa de `SUPABASE_LP_SERVICE_KEY`, Q-033).
Só depois de a fila voltar preenchida (`--decisoes`) rode sem `--dry-run`.

### Acesso de leitura ao Supabase do CRM (feito em 22/10)

O ETL lê a origem por conexão direta somente leitura (`SUPABASE_LEGADO_DATABASE_URL`).
No Supabase do CRM, em SQL Editor: usuário `etl_leitura` (senha em hexadecimal, nunca
colada em chat), `SELECT` nas 6 tabelas, política `etl_leitura_le` em cada uma
(o RLS esconde as linhas sem ela) e a view `etl.usuarios` (só `id`, `email`,
`raw_user_meta_data`) em schema próprio — `usage` no schema `auth` **não** pôde ser
concedido (`permission denied to set role "supabase_auth_admin"`). Use a string do
**Session pooler** (porta 5432), com a senha codificada para URL (`@` → `%40`).
Depois dos ensaios: `drop view etl.usuarios; drop schema etl; drop owned by etl_leitura;
drop role etl_leitura;` (com `revoke all on schema public from etl_leitura` antes, se
o `drop role` reclamar).

## Passo 7 — Critérios de aceite do ensaio (TDD-001 §16)

Hoje a conferência é manual, com SQL:

1. Contagens de leads, oportunidades, usuários e mensagens batem com a origem, por empresa.
2. Zero cards sem etapa.
3. Fila de revisão manual zerada por @Alana e @Karol.
4. Nenhum card em etapa que exige `proxima_acao_em`, `valor` ou `motivo` sem o campo.
5. Amostra de 20 cards conferida contra a origem.
6. Todos os usuários ativos em `usuarios` e `empresas_usuarios`, com o papel certo.

## Passo 8 — Recriar o staging do zero

```bash
docker exec pg-master psql -U admin -d postgres -c 'DROP DATABASE crm_staging WITH (FORCE)'
```

Depois refaça o passo 2 (cria o banco e as permissões) e o passo 3. Use isso entre
ensaios para partir sempre de um banco limpo.

## Dados pessoais

O ETL traz telefone e e-mail reais de leads para o staging. O TDD-001 §8 prevê
staging com dado **anonimizado**. Enquanto o anonimizador não existir, trate o
staging como ambiente com dado real (LGPD): acesso restrito, sem compartilhar a
URL, e apague o banco (passo 8) ao fim dos ensaios.
