-- Databases e roles dedicados do CRM no pg-master compartilhado.
-- Ver RFC-001 §7 (R-VPS-3) e spec fase0-fundacao-ci-staging
-- (AC-005, AC-007, AC-008, AC-009).
--
-- Executado pelo entrypoint do postgres:15-alpine (/docker-entrypoint-initdb.d)
-- como o superusuário administrativo do cluster. Idempotente: pode rodar de
-- novo sem duplicar databases/roles já existentes.
--
-- Requer as variáveis de ambiente CRM_APP_PASSWORD e CRM_MIGRATOR_PASSWORD
-- (nunca hard-coded aqui — ver constituição P-002).

\set ON_ERROR_STOP on

\getenv crm_app_password CRM_APP_PASSWORD
\getenv crm_migrator_password CRM_MIGRATOR_PASSWORD

-- Databases distintos para produção e staging (AC-005).
SELECT 'CREATE DATABASE crm_prod'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm_prod')\gexec

SELECT 'CREATE DATABASE crm_staging'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm_staging')\gexec

-- crm_migrator: única role com DDL, usada só pelo job efêmero de migration
-- (AC-008). crm_app: role de runtime da aplicação, sem DDL (AC-007).
-- Nenhuma das duas tem SUPERUSER, CREATEDB, CREATEROLE ou BYPASSRLS.
--
-- format()+\gexec (em vez de um bloco DO $$...$$) porque a interpolação de
-- variáveis do psql (:'var') não acontece dentro de string dollar-quoted —
-- a senha ficaria com o literal ":'crm_migrator_password'" em vez do valor.
SELECT format(
  'CREATE ROLE crm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'crm_migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_migrator')\gexec

SELECT format(
  'CREATE ROLE crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'crm_app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app')\gexec

-- Só crm_app e crm_migrator conectam nos databases do CRM — nenhum outro
-- database do cluster concede acesso a essas roles (AC-007: crm_app não lê
-- dados de outro database do cluster).
\c crm_prod
REVOKE ALL ON DATABASE crm_prod FROM PUBLIC;
GRANT CONNECT ON DATABASE crm_prod TO crm_app, crm_migrator;
-- CREATE no banco (não só no schema public) é exigido pelo próprio
-- `drizzle-kit migrate` (fase1-schema-drizzle, achado do AC-017): mesmo
-- com o journal apontado para o schema public, o comando roda
-- `CREATE SCHEMA IF NOT EXISTS "public"`, que o Postgres sempre valida
-- como um CREATE de banco — não basta ter CREATE só no schema.
GRANT CREATE ON DATABASE crm_prod TO crm_migrator;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT USAGE, CREATE ON SCHEMA public TO crm_migrator;

-- Toda tabela/sequência criada por crm_migrator (via migration) já nasce com
-- DML liberado para crm_app — sem exigir um GRANT manual a cada migration.
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;

\c crm_staging
REVOKE ALL ON DATABASE crm_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE crm_staging TO crm_app, crm_migrator;
GRANT CREATE ON DATABASE crm_staging TO crm_migrator;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT USAGE, CREATE ON SCHEMA public TO crm_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
