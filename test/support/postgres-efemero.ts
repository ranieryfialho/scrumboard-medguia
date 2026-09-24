// T-020 (fase1-schema-drizzle, US-007): harness de teste com Postgres 15
// efêmero. Sobe um container descartável (mesmo padrão de
// test/fase0-fundacao-ci-staging.spec.test.js), aplica
// infra/postgres/init/01-databases-and-roles.sql (databases + roles
// crm_migrator/crm_app) e, em seguida, as migrations desta feature
// (drizzle/*.sql, em ordem lexical — elas não passam pelo journal do
// drizzle-kit porque RLS/constraints/funções/seeds são SQL escrito à mão,
// não gerado por `drizzle-kit generate`), expondo conexões prontas para os
// testes de schema/RLS/constraints/funções/seeds (T-021 a T-025).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_PASSWORD = 'harness_admin_pw';
const CRM_APP_PASSWORD = 'harness_crm_app_pw';
const CRM_MIGRATOR_PASSWORD = 'harness_crm_migrator_pw';
const READY_TIMEOUT_MS = 90_000;

export interface PostgresEfemero {
  containerName: string;
  host: string;
  port: number;
  database: string;
  migratorUrl: string;
  appUrl: string;
  /** Aplica drizzle/*.sql (em ordem) no database do harness, como crm_migrator. */
  aplicarMigrations(): void;
  /** Executa SQL via `docker exec psql`, autenticado como a role informada. */
  psqlComo(role: 'postgres' | 'crm_migrator' | 'crm_app', sql: string, database?: string): {
    status: number | null;
    stdout: string;
    stderr: string;
  };
  /** Remove o container. Idempotente — seguro chamar mesmo se já parado. */
  parar(): void;
}

function runDocker(args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function runDockerComEntrada(args: string[], entrada: string) {
  return spawnSync('docker', args, { encoding: 'utf8', input: entrada });
}

export interface SubirPostgresEfemeroOptions {
  /** Database contra o qual os testes vão rodar. Default: crm_prod (criado pelo init script). */
  database?: string;
}

export async function subirPostgresEfemero(
  options: SubirPostgresEfemeroOptions = {}
): Promise<PostgresEfemero> {
  const database = options.database ?? 'crm_prod';
  const containerName = `crm-pg-schema-test-${crypto.randomBytes(4).toString('hex')}`;
  const initDir = path
    .join(process.cwd(), 'infra', 'postgres', 'init')
    .split(path.sep)
    .join('/');

  const dockerCheck = runDocker(['ps']);
  if (dockerCheck.status !== 0) {
    throw new Error(
      `Docker precisa estar disponível para subir o Postgres efêmero de teste: ${dockerCheck.stderr}`
    );
  }

  const run = runDocker([
    'run',
    '-d',
    '--name',
    containerName,
    '-p',
    '127.0.0.1::5432',
    '-e',
    `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`,
    '-e',
    `CRM_APP_PASSWORD=${CRM_APP_PASSWORD}`,
    '-e',
    `CRM_MIGRATOR_PASSWORD=${CRM_MIGRATOR_PASSWORD}`,
    '-v',
    `${initDir}:/docker-entrypoint-initdb.d:ro`,
    'postgres:15-alpine',
  ]);
  if (run.status !== 0) {
    throw new Error(`Falha ao subir container de Postgres efêmero: ${run.stderr}`);
  }

  function psqlComo(
    role: 'postgres' | 'crm_migrator' | 'crm_app',
    sql: string,
    db: string = database
  ) {
    const resultado = runDocker([
      'exec',
      containerName,
      'psql',
      '-U',
      role,
      '-d',
      db,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      sql,
    ]);
    return { status: resultado.status, stdout: resultado.stdout, stderr: resultado.stderr };
  }

  function parar() {
    // `-v` remove também o volume anônimo que a imagem oficial do Postgres
    // declara para `/var/lib/postgresql/data` — sem isso, cada container
    // efêmero deixa um volume órfão para trás (acúmulo silencioso de disco
    // que, com uso suficiente, pressiona a memória do Docker Desktop e causa
    // falhas espúrias de "database system is shutting down" em containers
    // concorrentes).
    runDocker(['rm', '-f', '-v', containerName]);
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    const isReady = runDocker(['exec', containerName, 'pg_isready', '-U', 'postgres']);
    if (isReady.status === 0) {
      const rolesExist = psqlComo(
        'postgres',
        "SELECT count(*) FROM pg_roles WHERE rolname IN ('crm_app','crm_migrator')",
        'postgres'
      );
      if (rolesExist.status === 0 && rolesExist.stdout.trim() === '2') {
        ready = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    parar();
    throw new Error('Postgres efêmero de teste não terminou de inicializar (databases/roles) a tempo.');
  }

  const portInspect = runDocker([
    'inspect',
    '-f',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    containerName,
  ]);
  if (portInspect.status !== 0) {
    parar();
    throw new Error(`Falha ao descobrir a porta publicada do Postgres efêmero: ${portInspect.stderr}`);
  }
  const port = Number(portInspect.stdout.trim());
  const host = '127.0.0.1';

  function aplicarMigrations() {
    const drizzleDir = path.join(process.cwd(), 'drizzle');
    const arquivos = fs
      .readdirSync(drizzleDir)
      .filter((nome) => nome.endsWith('.sql'))
      .sort();

    for (const arquivo of arquivos) {
      const sql = fs.readFileSync(path.join(drizzleDir, arquivo), 'utf8');
      const resultado = runDockerComEntrada(
        [
          'exec',
          '-i',
          containerName,
          'psql',
          '-U',
          'crm_migrator',
          '-d',
          database,
          '-v',
          'ON_ERROR_STOP=1',
        ],
        sql
      );
      if (resultado.status !== 0) {
        throw new Error(`Falha ao aplicar migration "${arquivo}": ${resultado.stderr}`);
      }
    }
  }

  const migratorUrl = `postgres://crm_migrator:${CRM_MIGRATOR_PASSWORD}@${host}:${port}/${database}`;
  const appUrl = `postgres://crm_app:${CRM_APP_PASSWORD}@${host}:${port}/${database}`;

  return {
    containerName,
    host,
    port,
    database,
    migratorUrl,
    appUrl,
    aplicarMigrations,
    psqlComo,
    parar,
  };
}
