// Testes de spec da feature fase0-fundacao-ci-staging — gerados por onp-spec scaffold
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import module from 'node:module';
import yaml from 'js-yaml';

// `src/app/api/health/route.ts` importa `../../../lib/env` sem extensão —
// convenção do resto do código (compilada normalmente pelo bundler do
// Next.js). O loader ESM nativo de `node --test` exige extensão explícita
// em specifiers relativos, então registramos aqui um hook mínimo que só
// tenta de novo com `.ts` quando a resolução padrão falha — sem alterar
// tsconfig.json/package.json nem o código de produção.
const tsExtensionFallbackHook = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\\.[a-zA-Z0-9]+$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    throw err;
  }
}
`;
module.register(
  'data:text/javascript,' + encodeURIComponent(tsExtensionFallbackHook),
  import.meta.url
);

const { GET: healthGET } = await import('../src/app/api/health/route.ts');

const ciWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
const ciWorkflow = yaml.load(fs.readFileSync(ciWorkflowPath, 'utf8'));

const releaseWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'release.yml');
const releaseWorkflowRaw = fs.readFileSync(releaseWorkflowPath, 'utf8');
const releaseWorkflow = yaml.load(releaseWorkflowRaw);

const deployWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'deploy.yml');
const deployWorkflowRaw = fs.readFileSync(deployWorkflowPath, 'utf8');
const deployWorkflow = yaml.load(deployWorkflowRaw);

const dockerComposePath = path.join(process.cwd(), 'docker-compose.yml');
const dockerComposeRaw = fs.readFileSync(dockerComposePath, 'utf8');
const dockerCompose = yaml.load(dockerComposeRaw);

function findGateSteps(job) {
  const gateOrder = ['lint', 'typecheck', 'test', 'build'];
  const matched = [];
  for (const gate of gateOrder) {
    const step = job.steps.find((candidate) => {
      const haystack = `${candidate.name ?? ''} ${candidate.run ?? ''}`.toLowerCase();
      if (gate === 'typecheck') {
        return haystack.includes('typecheck') || haystack.includes('tsc') || haystack.includes('checagem de tipos');
      }
      if (gate === 'test') {
        return haystack.includes('npm test') || haystack.includes('npm run test') || (haystack.includes('teste') && !haystack.includes('typecheck'));
      }
      return haystack.includes(gate);
    });
    matched.push(step);
  }
  return matched;
}

// US-001 — CI bloqueia código quebrado antes da main
test('AC-001: Workflow de CI cobre os quatro gates na ordem certa @spec:AC-001', () => {
  // Dado: o arquivo `.github/workflows/ci.yml`
  // Quando: ele é inspecionado
  // Então: existe um job que executa, nessa ordem, lint → checagem de tipos
  //        (tsc --noEmit) → testes → build, cada passo dependendo do
  //        anterior ter passado (nenhum continue-on-error: true nos gates)
  assert.ok(ciWorkflow.jobs, 'workflow deve ter jobs definidos');
  const jobs = Object.values(ciWorkflow.jobs);
  assert.ok(jobs.length >= 1, 'deve existir pelo menos um job');

  const job = jobs[0];
  assert.ok(Array.isArray(job.steps), 'job deve ter steps');

  const [lintStep, typecheckStep, testStep, buildStep] = findGateSteps(job);
  assert.ok(lintStep, 'deve existir um step de lint');
  assert.ok(typecheckStep, 'deve existir um step de checagem de tipos (tsc --noEmit)');
  assert.ok(testStep, 'deve existir um step de testes');
  assert.ok(buildStep, 'deve existir um step de build');

  const indices = [lintStep, typecheckStep, testStep, buildStep].map((step) => job.steps.indexOf(step));
  assert.deepEqual(
    indices,
    [...indices].sort((a, b) => a - b),
    'os gates devem aparecer nessa ordem: lint → typecheck → test → build'
  );

  for (const step of job.steps) {
    assert.notEqual(
      step['continue-on-error'],
      true,
      `step "${step.name ?? step.run}" não pode ter continue-on-error: true`
    );
  }
});

// US-001 — CI bloqueia código quebrado antes da main
test('AC-002: CI roda em todo Pull Request e em todo push @spec:AC-002', () => {
  // Dado: o mesmo workflow
  // Quando: inspecionado o gatilho (`on:`)
  // Então: ele dispara em `pull_request` (qualquer branch contra `main`) e em
  //        `push` na `main`
  assert.ok(ciWorkflow.on, 'workflow deve ter gatilhos (on:) definidos');

  assert.ok(
    Object.prototype.hasOwnProperty.call(ciWorkflow.on, 'pull_request'),
    'workflow deve disparar em pull_request'
  );
  const pullRequestBranches = ciWorkflow.on.pull_request?.branches;
  assert.ok(
    !pullRequestBranches || pullRequestBranches.includes('main'),
    'pull_request deve cobrir PRs contra a main'
  );

  assert.ok(
    Object.prototype.hasOwnProperty.call(ciWorkflow.on, 'push'),
    'workflow deve disparar em push'
  );
  const pushBranches = ciWorkflow.on.push?.branches;
  assert.ok(
    Array.isArray(pushBranches) && pushBranches.includes('main'),
    'push deve disparar na branch main'
  );
});

// US-002 — Deploy por imagem versionada, com rollback em minutos
test('AC-003: Build sai da VPS e a imagem é publicada com tag rastreável @spec:AC-003', () => {
  // Dado: um push que dispara o workflow de release
  // Quando: o job de build roda
  // Então: ele publica a imagem no GHCR com uma tag baseada no SHA do commit
  //        (não em `latest`), e nenhum step roda `docker build`/`compose build`
  //        contra a VPS — só o registro GHCR é usado
  assert.ok(releaseWorkflow.jobs, 'workflow de release deve ter jobs definidos');

  assert.ok(
    Object.prototype.hasOwnProperty.call(releaseWorkflow.on, 'push'),
    'workflow de release deve disparar em push'
  );

  const jobs = Object.values(releaseWorkflow.jobs);
  assert.ok(jobs.length >= 1, 'deve existir pelo menos um job de build/publish');

  const allSteps = jobs.flatMap((job) => job.steps ?? []);

  const publishStep = allSteps.find((step) => {
    const usesOrRun = `${step.uses ?? ''} ${step.run ?? ''}`.toLowerCase();
    return usesOrRun.includes('build-push') || usesOrRun.includes('docker push') || usesOrRun.includes('docker buildx build');
  });
  assert.ok(publishStep, 'deve existir um step que builda e publica a imagem');

  const tagsValue = JSON.stringify(publishStep.with ?? publishStep.run ?? '');
  assert.match(
    tagsValue,
    /ghcr\.io\//,
    'a imagem deve ser publicada no GHCR (ghcr.io/...)'
  );
  assert.match(
    tagsValue,
    /github\.sha/,
    'a tag da imagem deve ser baseada no SHA do commit (github.sha)'
  );
  assert.doesNotMatch(
    tagsValue,
    /:\s*latest['"]?(\s|,|$)/,
    'a imagem não pode ser publicada com a tag latest'
  );
  assert.doesNotMatch(
    tagsValue.toLowerCase(),
    /-t\s+[^\s'"]*:latest\b/,
    'a imagem não pode ser publicada com a tag latest'
  );

  assert.doesNotMatch(
    releaseWorkflowRaw,
    /ssh|scp|rsync/i,
    'o workflow de release não deve conter passos que builda/executa nada na VPS'
  );
});

// US-002 — Deploy por imagem versionada, com rollback em minutos
test('AC-004: Rollback é trocar a tag, sem rebuild @spec:AC-004', () => {
  // Dado: uma imagem `sha-B` já rodando em produção e uma imagem anterior
  //       `sha-A` publicada no GHCR
  // Quando: o operador aciona o rollback apontando para `sha-A`
  // Então: a VPS sobe o container com `sha-A` sem executar nenhum build
  assert.ok(deployWorkflow.on, 'workflow de deploy deve ter gatilhos definidos');
  assert.ok(
    Object.prototype.hasOwnProperty.call(deployWorkflow.on, 'workflow_dispatch'),
    'deploy deve ser disparado manualmente (workflow_dispatch)'
  );

  const inputs = deployWorkflow.on.workflow_dispatch?.inputs;
  assert.ok(inputs, 'workflow_dispatch deve receber inputs (a tag da imagem)');
  const tagInputKey = Object.keys(inputs).find((key) => /tag/i.test(key));
  assert.ok(tagInputKey, 'deve existir um input para informar a tag da imagem (usado no rollback)');
  assert.ok(inputs[tagInputKey].required, 'o input da tag deve ser obrigatório');

  assert.doesNotMatch(
    deployWorkflowRaw,
    /docker\s+build|docker\s+compose\s+build|compose(\.\w+)?\s+build/i,
    'o deploy não pode executar nenhum build — só pull'
  );
  assert.match(
    deployWorkflowRaw,
    /docker compose pull/,
    'o deploy deve puxar a imagem já publicada (docker compose pull)'
  );

  const services = dockerCompose.services ?? {};
  // Só os serviços de app construídos por esta feature (release.yml) seguem
  // a regra "imagem publicada no GHCR com tag parametrizável". Serviços de
  // infra que usam imagem oficial de terceiro (ex.: pg-master, adicionado em
  // T-005) ficam fora dessa checagem — eles nunca são buildados por este
  // repositório nem fazem parte do rollback por tag do AC-004.
  const infraServiceNames = new Set(['pg-master']);
  const serviceNames = Object.keys(services).filter((name) => !infraServiceNames.has(name));
  assert.ok(serviceNames.length >= 1, 'docker-compose.yml deve definir ao menos um serviço de app');
  for (const name of serviceNames) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(services[name], 'build'),
      `serviço "${name}" não pode ter build: — deploy é só pull de imagem publicada`
    );
    assert.ok(
      typeof services[name].image === 'string' && services[name].image.includes('ghcr.io'),
      `serviço "${name}" deve referenciar uma imagem publicada no GHCR`
    );
    assert.match(
      services[name].image,
      /\$\{?IMAGE_TAG/,
      `a tag da imagem do serviço "${name}" deve ser parametrizável (variável IMAGE_TAG) para permitir rollback trocando só a tag`
    );
  }
});

// US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
test('AC-009: Postgres não publica porta na internet @spec:AC-009', () => {
  // Dado: o `docker-compose.yml` de produção/staging
  // Quando: inspecionado o serviço `pg-master`
  // Então: não há `ports:` publicando 5432 em `0.0.0.0` — o acesso é só pela
  //        rede Docker interna (`wp-network`) ou por túnel SSH
  const services = dockerCompose.services ?? {};
  const pgMaster = services['pg-master'];
  assert.ok(pgMaster, 'docker-compose.yml deve definir o serviço pg-master');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(pgMaster, 'ports'),
    'o serviço pg-master não pode publicar nenhuma porta — acesso só pela rede Docker interna'
  );
  assert.ok(
    Array.isArray(pgMaster.networks) ? pgMaster.networks.includes('wp-network') : pgMaster.networks?.['wp-network'] !== undefined,
    'pg-master deve estar na rede Docker interna wp-network'
  );
});

// Suíte de integração das AC-005/007/008 — roda um Postgres real (container
// descartável, postgres:15-alpine) aplicando infra/postgres/init/01-databases-and-roles.sql
// e tentando de fato as operações permitidas/vedadas com cada role. Um
// Postgres real (não uma leitura estática do .sql) é a única prova que
// AC-007/AC-008 pedem: "o Postgres rejeita a operação".
describe('T-005 — integração com Postgres real (crm_prod/crm_staging, crm_app/crm_migrator)', () => {
  const containerName = `crm-pg-fase0-test-${crypto.randomBytes(4).toString('hex')}`;
  const initDir = path
    .join(process.cwd(), 'infra', 'postgres', 'init')
    .split(path.sep)
    .join('/');
  const ADMIN_PASSWORD = 'test_admin_pw';
  const CRM_APP_PASSWORD = 'test_crm_app_pw';
  const CRM_MIGRATOR_PASSWORD = 'test_crm_migrator_pw';
  const READY_TIMEOUT_MS = 90_000;

  function runDocker(args) {
    return spawnSync('docker', args, { encoding: 'utf8' });
  }

  // Conecta via socket local dentro do próprio container (auth "trust" para
  // conexões locais no image oficial) — evita depender de psql/driver pg no
  // host, e ainda assim exercita privilégios reais de cada role.
  function psqlAs(role, db, sql) {
    return runDocker([
      'exec',
      containerName,
      'psql',
      '-U', role,
      '-d', db,
      '-v', 'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c', sql,
    ]);
  }

  before(async () => {
    const dockerCheck = runDocker(['ps']);
    assert.equal(
      dockerCheck.status,
      0,
      'Docker precisa estar disponível para provar AC-005/AC-007/AC-008 contra um Postgres real'
    );

    const run = runDocker([
      'run', '-d', '--name', containerName,
      '-e', `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`,
      '-e', `CRM_APP_PASSWORD=${CRM_APP_PASSWORD}`,
      '-e', `CRM_MIGRATOR_PASSWORD=${CRM_MIGRATOR_PASSWORD}`,
      '-v', `${initDir}:/docker-entrypoint-initdb.d:ro`,
      'postgres:15-alpine',
    ]);
    assert.equal(run.status, 0, `falha ao subir container de teste do Postgres: ${run.stderr}`);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      const isReady = runDocker(['exec', containerName, 'pg_isready', '-U', 'postgres']);
      if (isReady.status === 0) {
        const rolesExist = psqlAs('postgres', 'postgres', "SELECT count(*) FROM pg_roles WHERE rolname IN ('crm_app','crm_migrator')");
        if (rolesExist.status === 0 && rolesExist.stdout.trim() === '2') {
          ready = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Postgres de teste não terminou de inicializar (databases/roles) a tempo');
  });

  after(() => {
    runDocker(['rm', '-f', containerName]);
  });

  // US-003 — Ambiente de staging isolado para ensaiar mudanças
  test('AC-005: Staging usa um database Postgres separado de produção @spec:AC-005', () => {
    // Dado: o `pg-master` já existente na VPS (compartilhado com outros
    //       projetos — RFC-001 §1.3, P14)
    // Quando: os databases do CRM são criados
    // Então: existem `crm_prod` e `crm_staging` como databases distintos
    const result = psqlAs('postgres', 'postgres', "SELECT datname FROM pg_database WHERE datname IN ('crm_prod', 'crm_staging') ORDER BY datname");
    assert.equal(result.status, 0, `consulta a pg_database falhou: ${result.stderr}`);
    const databases = result.stdout.trim().split('\n').filter(Boolean);
    assert.deepEqual(databases, ['crm_prod', 'crm_staging'], 'devem existir crm_prod e crm_staging como databases distintos');
  });

  // US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
  test('AC-007: `crm_app` não tem privilégio de superusuário nem DDL @spec:AC-007', () => {
    // Dado: a role `crm_app` usada pela aplicação em runtime
    // Quando: ela tenta executar `CREATE TABLE` ou qualquer DDL, ou ler dados
    //         de outro database do cluster
    // Então: o Postgres rejeita a operação (a role não tem `SUPERUSER`,
    //        `BYPASSRLS` nem privilégio de DDL em `crm_prod`/`crm_staging`)
    const attrs = psqlAs(
      'postgres',
      'postgres',
      "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'crm_app'"
    );
    assert.equal(attrs.status, 0, `consulta a pg_roles falhou: ${attrs.stderr}`);
    assert.equal(attrs.stdout.trim(), 'f|f|f|f', 'crm_app não pode ter SUPERUSER, BYPASSRLS, CREATEDB nem CREATEROLE');

    const ddlInProd = psqlAs('crm_app', 'crm_prod', 'CREATE TABLE ac007_deveria_falhar (id int)');
    assert.notEqual(ddlInProd.status, 0, 'crm_app não pode executar CREATE TABLE em crm_prod');
    assert.match(ddlInProd.stderr, /permission denied|permiss(a|ã)o negada/i, 'a rejeição deve ser por falta de privilégio');

    const ddlInStaging = psqlAs('crm_app', 'crm_staging', 'CREATE TABLE ac007_deveria_falhar (id int)');
    assert.notEqual(ddlInStaging.status, 0, 'crm_app não pode executar CREATE TABLE em crm_staging');

    // "ler dados de outro database do cluster": um database de outro projeto
    // que nunca concedeu nada a crm_app — sem GRANT explícito, a leitura é
    // negada mesmo que a role consiga estabelecer a conexão.
    const outroDbSetup = psqlAs('postgres', 'postgres', 'CREATE DATABASE outro_projeto_db');
    assert.equal(outroDbSetup.status, 0, `falha ao preparar database de outro projeto para o teste: ${outroDbSetup.stderr}`);
    const outroTabela = psqlAs('postgres', 'outro_projeto_db', 'CREATE TABLE dados_sensiveis (segredo text); INSERT INTO dados_sensiveis VALUES (\'top-secret\')');
    assert.equal(outroTabela.status, 0, `falha ao popular tabela de outro projeto para o teste: ${outroTabela.stderr}`);

    const leituraNegada = psqlAs('crm_app', 'outro_projeto_db', 'SELECT * FROM dados_sensiveis');
    assert.notEqual(leituraNegada.status, 0, 'crm_app não pode ler dados de um database de outro projeto no mesmo cluster');
  });

  // US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
  test('AC-008: `crm_migrator` é a única role com DDL, usada só pelo job de migration @spec:AC-008', () => {
    // Dado: o job efêmero de migration (`crm_migrator`)
    // Quando: ele roda uma migration do `drizzle-kit`
    // Então: consegue alterar o schema, e nenhuma outra credencial usada pelo
    //        `crm-app`/`crm-worker` em runtime tem esse privilégio
    const migrationProd = psqlAs('crm_migrator', 'crm_prod', 'CREATE TABLE ac008_migration_probe (id int); DROP TABLE ac008_migration_probe');
    assert.equal(migrationProd.status, 0, `crm_migrator deveria conseguir aplicar DDL em crm_prod: ${migrationProd.stderr}`);

    const migrationStaging = psqlAs('crm_migrator', 'crm_staging', 'CREATE TABLE ac008_migration_probe (id int); DROP TABLE ac008_migration_probe');
    assert.equal(migrationStaging.status, 0, `crm_migrator deveria conseguir aplicar DDL em crm_staging: ${migrationStaging.stderr}`);

    const privileges = psqlAs(
      'postgres',
      'crm_prod',
      "SELECT has_schema_privilege('crm_app', 'public', 'CREATE'), has_schema_privilege('crm_migrator', 'public', 'CREATE')"
    );
    assert.equal(privileges.status, 0, `consulta de privilégios falhou: ${privileges.stderr}`);
    assert.equal(
      privileges.stdout.trim(),
      'f|t',
      'só crm_migrator pode ter CREATE no schema public — crm_app (usada por crm-app/crm-worker) não'
    );
  });
});

// US-003 — Ambiente de staging isolado para ensaiar mudanças
test('AC-006: Staging é publicamente acessível só por quem tem o link/credencial da equipe @spec:AC-006', () => {
  // Dado: o container `crm-app` de staging subindo na VPS
  // Quando: inspecionada a topologia de rede (nginx-proxy-manager, `docker-compose`)
  // Então: staging fica atrás do mesmo proxy com TLS, sem porta adicional
  //        exposta na internet além da já usada por produção
  const stagingComposePath = path.join(process.cwd(), 'docker-compose.staging.yml');
  assert.ok(fs.existsSync(stagingComposePath), 'deve existir docker-compose.staging.yml');
  const stagingCompose = yaml.load(fs.readFileSync(stagingComposePath, 'utf8'));

  const services = stagingCompose.services ?? {};
  const serviceNames = Object.keys(services);
  assert.ok(serviceNames.length >= 1, 'docker-compose.staging.yml deve definir o serviço crm-app de staging');

  const stagingAppName = serviceNames.find((name) => /crm.*app/i.test(name)) ?? serviceNames[0];
  const stagingApp = services[stagingAppName];

  assert.ok(
    !Object.prototype.hasOwnProperty.call(stagingApp, 'ports'),
    'o serviço de staging não pode publicar nenhuma porta nova — deve ficar só atrás do proxy'
  );

  assert.ok(
    Array.isArray(stagingApp.networks)
      ? stagingApp.networks.includes('wp-network')
      : stagingApp.networks?.['wp-network'] !== undefined,
    'o serviço de staging deve estar na mesma rede wp-network do nginx-proxy-manager/produção'
  );

  // Staging conecta só em crm_staging (AC-005), nunca em crm_prod.
  const envString = JSON.stringify(stagingApp.environment ?? '') + JSON.stringify(stagingApp.env_file ?? '');
  assert.doesNotMatch(
    envString,
    /crm_prod/,
    'o serviço de staging não pode referenciar crm_prod — só crm_staging'
  );

  // Nenhum outro arquivo docker-compose* do projeto pode publicar porta nova
  // para o serviço de staging (garante "sem porta adicional exposta na
  // internet além da já usada por produção").
  assert.ok(
    !Object.prototype.hasOwnProperty.call(dockerCompose.services?.[stagingAppName] ?? {}, 'ports'),
    'docker-compose.yml de produção não pode publicar porta nova para o serviço de staging'
  );
});

// Suíte de integração do T-007 — roda um Postgres real (container
// descartável, postgres:15-alpine, mesmo padrão do T-005) com o database
// crm_prod já criado pelo script de init, e executa o
// infra/backup/backup-crm.sh de verdade contra ele. `rclone` e `curl` não
// existem/não podem sair para a internet no ambiente de teste, então são
// substituídos por binários falsos numa pasta na frente do PATH — a única
// forma de provar "existe no remote" e "o alerta foi chamado" sem depender
// de credenciais reais do Google Drive/Evolution API.
describe('T-007 — integração do backup-crm.sh contra um Postgres real', () => {
  const backupScriptPath = path
    .join(process.cwd(), 'infra', 'backup', 'backup-crm.sh')
    .split(path.sep)
    .join('/');
  const crontabPath = path.join(process.cwd(), 'infra', 'backup', 'crontab');

  const containerName = `crm-pg-backup-test-${crypto.randomBytes(4).toString('hex')}`;
  const initDir = path
    .join(process.cwd(), 'infra', 'postgres', 'init')
    .split(path.sep)
    .join('/');
  const ADMIN_PASSWORD = 'test_admin_pw';
  const CRM_APP_PASSWORD = 'test_crm_app_pw';
  const CRM_MIGRATOR_PASSWORD = 'test_crm_migrator_pw';
  const READY_TIMEOUT_MS = 90_000;

  let tmpRoot;
  let fakeBinDir;

  function runDocker(args) {
    return spawnSync('docker', args, { encoding: 'utf8' });
  }

  function psqlAs(role, db, sql) {
    return runDocker([
      'exec', containerName,
      'psql', '-U', role, '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
    ]);
  }

  // Instala um `rclone` falso que, em vez de sincronizar com o Google
  // Drive, copia os arquivos para um diretório local — o suficiente para
  // provar que o script *tenta* enviar o dump+checksum para o remote
  // configurado, com o conteúdo certo.
  function writeFakeRclone(dir) {
    const scriptPath = path.join(dir, 'rclone');
    fs.writeFileSync(
      scriptPath,
      '#!/usr/bin/env bash\n' +
        'set -euo pipefail\n' +
        'if [ "$1" = "copy" ]; then\n' +
        '  mkdir -p "$3"\n' +
        '  cp "$2" "$3/"\n' +
        '  exit 0\n' +
        'fi\n' +
        'exit 1\n',
      { mode: 0o755 }
    );
  }

  // Instala um `curl` falso que grava cada chamada (URL + body) num log,
  // em vez de bater na Evolution API de verdade — prova que o alerta foi
  // disparado com o destino e a mensagem certos.
  function writeFakeCurl(dir, logPath) {
    const scriptPath = path.join(dir, 'curl');
    fs.writeFileSync(
      scriptPath,
      '#!/usr/bin/env bash\n' +
        `echo "CALL: $*" >> "${logPath}"\n` +
        'exit 0\n',
      { mode: 0o755 }
    );
  }

  before(async () => {
    const dockerCheck = runDocker(['ps']);
    assert.equal(
      dockerCheck.status,
      0,
      'Docker precisa estar disponível para provar AC-010/AC-011 contra um Postgres real'
    );

    const run = runDocker([
      'run', '-d', '--name', containerName,
      '-e', `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`,
      '-e', `CRM_APP_PASSWORD=${CRM_APP_PASSWORD}`,
      '-e', `CRM_MIGRATOR_PASSWORD=${CRM_MIGRATOR_PASSWORD}`,
      '-v', `${initDir}:/docker-entrypoint-initdb.d:ro`,
      'postgres:15-alpine',
    ]);
    assert.equal(run.status, 0, `falha ao subir container de teste do Postgres: ${run.stderr}`);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      const isReady = runDocker(['exec', containerName, 'pg_isready', '-U', 'postgres']);
      if (isReady.status === 0) {
        const dbExists = psqlAs('postgres', 'postgres', "SELECT count(*) FROM pg_database WHERE datname = 'crm_prod'");
        if (dbExists.status === 0 && dbExists.stdout.trim() === '1') {
          ready = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Postgres de teste não terminou de inicializar (crm_prod) a tempo');

    // Dado real em crm_prod: prova que o dump gerado não é um arquivo vazio
    // nem de outro database.
    const seed = psqlAs('postgres', 'crm_prod', 'CREATE TABLE backup_probe (id int); INSERT INTO backup_probe VALUES (42)');
    assert.equal(seed.status, 0, `falha ao semear crm_prod para o teste: ${seed.stderr}`);

    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-test-'));
    fakeBinDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    writeFakeRclone(fakeBinDir);
  });

  after(() => {
    runDocker(['rm', '-f', containerName]);
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // US-005 — Backup diário automático com restore testado
  test('AC-010: Backup diário roda e é enviado para fora da VPS @spec:AC-010', () => {
    // Dado: o cron de backup configurado às 03h
    // Quando: o job roda com sucesso
    // Então: existe, no remote externo (`rclone` → `gdrive:`, pasta própria
    //        do CRM), um dump datado de `crm_prod` com checksum
    //        (`sha256sum`) gravado junto
    assert.ok(fs.existsSync(crontabPath), 'deve existir infra/backup/crontab');
    const crontab = fs.readFileSync(crontabPath, 'utf8');
    assert.match(crontab, /^\s*0\s+3\s+\*\s+\*\s+\*\s+.*backup-crm\.sh/m, 'o cron deve rodar o backup-crm.sh às 03h (0 3 * * *)');

    const backupDir = fs.mkdtempSync(path.join(tmpRoot, 'staging-'));
    const remoteDir = fs.mkdtempSync(path.join(tmpRoot, 'remote-'));

    const result = spawnSync('bash', [backupScriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PG_CONTAINER: containerName,
        PG_DATABASE: 'crm_prod',
        POSTGRES_ADMIN_USER: 'postgres',
        BACKUP_DIR: backupDir,
        RCLONE_REMOTE: remoteDir,
      },
    });
    assert.equal(result.status, 0, `backup-crm.sh deveria terminar com sucesso: ${result.stderr}`);

    const remoteFiles = fs.readdirSync(remoteDir);
    const dumpFile = remoteFiles.find((name) => /^crm_prod_.*\.dump$/.test(name));
    const checksumFile = remoteFiles.find((name) => name.endsWith('.sha256'));
    assert.ok(dumpFile, `deve existir no remote um dump datado de crm_prod — encontrado: ${remoteFiles.join(', ')}`);
    assert.ok(checksumFile, 'deve existir no remote o checksum sha256 do dump');
    assert.equal(checksumFile, `${dumpFile}.sha256`, 'o checksum deve ser gravado junto do dump correspondente');

    const dumpBytes = fs.readFileSync(path.join(remoteDir, dumpFile));
    assert.ok(dumpBytes.length > 0, 'o dump enviado ao remote não pode estar vazio');
    const actualHash = crypto.createHash('sha256').update(dumpBytes).digest('hex');
    const checksumContent = fs.readFileSync(path.join(remoteDir, checksumFile), 'utf8').trim();
    assert.ok(
      checksumContent.startsWith(actualHash),
      `o checksum gravado deve corresponder ao sha256 real do dump (esperado ${actualHash}, achou "${checksumContent}")`
    );

    // Prova que o dump é de fato de crm_prod (contém a tabela semeada), não
    // um arquivo qualquer com o nome certo.
    runDocker(['cp', path.join(remoteDir, dumpFile), `${containerName}:/tmp/probe.dump`]);
    const listing = runDocker(['exec', containerName, 'pg_restore', '--list', '/tmp/probe.dump']);
    assert.equal(listing.status, 0, `pg_restore --list falhou no dump enviado: ${listing.stderr}`);
    assert.match(listing.stdout, /backup_probe/, 'o dump deve conter a tabela de crm_prod, não estar vazio/corrompido');
  });

  // US-005 — Backup diário automático com restore testado
  test('AC-011: Alerta dispara se o backup falhar @spec:AC-011', () => {
    // Dado: o job de backup
    // Quando: ele falha
    // Então: um alerta é enviado (WhatsApp via Evolution API, no padrão do
    //        script já existente na VPS)
    // Nota: a outra metade do AC-011 ("ou quando /api/health verifica que o
    // último backup tem mais de 24h") é responsabilidade do T-009, que ainda
    // vai existir — a nota da própria T-007 em tasks.md diz que o
    // /api/health "consome a idade do último backup" produzido aqui.
    const curlLog = path.join(tmpRoot, `curl-calls-${crypto.randomBytes(4).toString('hex')}.log`);
    const failureBinDir = fs.mkdtempSync(path.join(tmpRoot, 'bin-fail-'));
    writeFakeCurl(failureBinDir, curlLog);

    const backupDir = fs.mkdtempSync(path.join(tmpRoot, 'staging-fail-'));

    const result = spawnSync('bash', [backupScriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // fakeBinDir primeiro dá o rclone falso (não deveria nem ser
        // chamado, já que o pg_dump falha antes); failureBinDir dá o curl
        // falso que grava o alerta.
        PATH: `${failureBinDir}${path.delimiter}${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PG_CONTAINER: containerName,
        PG_DATABASE: 'database_que_nao_existe',
        POSTGRES_ADMIN_USER: 'postgres',
        BACKUP_DIR: backupDir,
        RCLONE_REMOTE: fs.mkdtempSync(path.join(tmpRoot, 'remote-fail-')),
        EVOLUTION_API_URL: 'http://evolution.internal:8080',
        EVOLUTION_API_KEY: 'test-api-key',
        EVOLUTION_INSTANCE: 'crm-alerts',
        ALERT_WHATSAPP_NUMBER: '5511999999999',
      },
    });

    assert.notEqual(result.status, 0, 'backup-crm.sh deve falhar quando o pg_dump falha (database inexistente)');

    assert.ok(fs.existsSync(curlLog), 'o alerta (curl para a Evolution API) deveria ter sido disparado na falha');
    const calls = fs.readFileSync(curlLog, 'utf8');
    assert.match(calls, /message\/sendText\/crm-alerts/, 'o alerta deve ser enviado para o endpoint sendText da instância configurada');
    assert.match(calls, /apikey: test-api-key/, 'o alerta deve usar a apikey da Evolution API configurada');
    assert.match(calls, /5511999999999/, 'o alerta deve ser endereçado ao número configurado');
  });
});

// Suíte de integração do T-008 — roda um Postgres real (container
// descartável, postgres:15-alpine, mesmo padrão do T-005/T-007) com
// crm_prod e crm_staging criados pelo script de init, semeia crm_prod,
// gera um dump de verdade com pg_dump, e prova que infra/backup/restore-crm.sh
// consegue restaurar esse dump em crm_staging — dados batendo, não só "o
// comando terminou sem erro".
describe('T-008 — integração do restore-crm.sh contra um Postgres real', () => {
  const restoreScriptPath = path
    .join(process.cwd(), 'infra', 'backup', 'restore-crm.sh')
    .split(path.sep)
    .join('/');

  const containerName = `crm-pg-restore-test-${crypto.randomBytes(4).toString('hex')}`;
  const initDir = path
    .join(process.cwd(), 'infra', 'postgres', 'init')
    .split(path.sep)
    .join('/');
  const ADMIN_PASSWORD = 'test_admin_pw';
  const CRM_APP_PASSWORD = 'test_crm_app_pw';
  const CRM_MIGRATOR_PASSWORD = 'test_crm_migrator_pw';
  const READY_TIMEOUT_MS = 90_000;

  let tmpRoot;

  function runDocker(args) {
    return spawnSync('docker', args, { encoding: 'utf8' });
  }

  function psqlAs(role, db, sql) {
    return runDocker([
      'exec', containerName,
      'psql', '-U', role, '-d', db, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
    ]);
  }

  before(async () => {
    const dockerCheck = runDocker(['ps']);
    assert.equal(
      dockerCheck.status,
      0,
      'Docker precisa estar disponível para provar AC-012 contra um Postgres real'
    );

    const run = runDocker([
      'run', '-d', '--name', containerName,
      '-e', `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`,
      '-e', `CRM_APP_PASSWORD=${CRM_APP_PASSWORD}`,
      '-e', `CRM_MIGRATOR_PASSWORD=${CRM_MIGRATOR_PASSWORD}`,
      '-v', `${initDir}:/docker-entrypoint-initdb.d:ro`,
      'postgres:15-alpine',
    ]);
    assert.equal(run.status, 0, `falha ao subir container de teste do Postgres: ${run.stderr}`);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      const isReady = runDocker(['exec', containerName, 'pg_isready', '-U', 'postgres']);
      if (isReady.status === 0) {
        const dbsExist = psqlAs('postgres', 'postgres', "SELECT count(*) FROM pg_database WHERE datname IN ('crm_prod','crm_staging')");
        if (dbsExist.status === 0 && dbsExist.stdout.trim() === '2') {
          ready = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Postgres de teste não terminou de inicializar (crm_prod/crm_staging) a tempo');

    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-restore-test-'));
  });

  after(() => {
    runDocker(['rm', '-f', containerName]);
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // US-005 — Backup diário automático com restore testado
  test('AC-012: Restore ensaiado recupera um dump em staging @spec:AC-012', () => {
    // Dado: um dump de backup válido
    // Quando: o procedimento de restore documentado é executado contra
    //         crm_staging
    // Então: o banco de staging fica íntegro e consultável, provando que o
    //        backup é restaurável de fato (não só "existe o arquivo")

    // Dado: semeia crm_prod com dados conhecidos e gera um dump real via
    // pg_dump (o mesmo formato que backup-crm.sh produz em produção).
    const seed = psqlAs(
      'postgres',
      'crm_prod',
      "CREATE TABLE restore_probe (id int, nome text); INSERT INTO restore_probe VALUES (1, 'alpha'), (2, 'beta')"
    );
    assert.equal(seed.status, 0, `falha ao semear crm_prod para o teste: ${seed.stderr}`);

    const dumpPath = path.join(tmpRoot, 'crm_prod_test.dump');
    const dumpResult = spawnSync(
      'docker',
      ['exec', containerName, 'pg_dump', '--format=custom', '--no-owner', '-U', 'postgres', 'crm_prod'],
      { encoding: 'buffer' }
    );
    assert.equal(dumpResult.status, 0, `pg_dump falhou ao gerar o dump de teste: ${dumpResult.stderr}`);
    fs.writeFileSync(dumpPath, dumpResult.stdout);
    assert.ok(fs.statSync(dumpPath).size > 0, 'o dump gerado para o teste não pode estar vazio');

    const checksum = crypto.createHash('sha256').update(fs.readFileSync(dumpPath)).digest('hex');
    fs.writeFileSync(`${dumpPath}.sha256`, `${checksum}  crm_prod_test.dump\n`);

    // Confere que crm_staging começa sem a tabela semeada, para provar que
    // os dados vieram do restore, não de coincidência de estado prévio.
    const beforeRestore = psqlAs(
      'postgres',
      'crm_staging',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'restore_probe'"
    );
    assert.equal(beforeRestore.status, 0, `consulta prévia a crm_staging falhou: ${beforeRestore.stderr}`);
    assert.equal(beforeRestore.stdout.trim(), '0', 'crm_staging não deveria ter restore_probe antes do restore');

    // Quando: o script de restore documentado roda contra crm_staging.
    const restoreResult = spawnSync('bash', [restoreScriptPath, dumpPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PG_CONTAINER: containerName,
        PG_TARGET_DATABASE: 'crm_staging',
        POSTGRES_ADMIN_USER: 'postgres',
      },
    });
    assert.equal(restoreResult.status, 0, `restore-crm.sh deveria terminar com sucesso: ${restoreResult.stderr}`);
    assert.match(restoreResult.stdout, /consultável/, 'o script deve reportar que o banco ficou consultável depois do restore');

    // Então: crm_staging fica íntegro e consultável, com os mesmos dados de
    // crm_prod no momento do dump.
    const afterRestore = psqlAs(
      'postgres',
      'crm_staging',
      "SELECT id, nome FROM restore_probe ORDER BY id"
    );
    assert.equal(afterRestore.status, 0, `crm_staging deveria estar consultável e conter restore_probe depois do restore: ${afterRestore.stderr}`);
    assert.equal(afterRestore.stdout.trim(), '1|alpha\n2|beta', 'os dados restaurados em crm_staging devem bater com os de crm_prod no momento do dump');

    // Recusa apontar para crm_prod — a proteção existe para o uso rotineiro
    // do script (ver runbook para o procedimento manual de incidente real).
    const guardResult = spawnSync('bash', [restoreScriptPath, dumpPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PG_CONTAINER: containerName,
        PG_TARGET_DATABASE: 'crm_prod',
        POSTGRES_ADMIN_USER: 'postgres',
      },
    });
    assert.notEqual(guardResult.status, 0, 'restore-crm.sh não pode restaurar direto em crm_prod');
  });
});

// Suíte de integração do T-009 — chama de fato o handler `GET` de
// `src/app/api/health/route.ts`, apontando os checks para um banco real
// (via TCP) e um arquivo `.last-success` controlado (o mesmo formato que
// infra/backup/backup-crm.sh grava), em vez de ler o texto do código-fonte.
describe('T-009 — integração do handler GET /api/health', () => {
  const healthEnvKeys = [
    'PGHOST',
    'PGPORT',
    'HEALTH_DB_TIMEOUT_MS',
    'BACKUP_LAST_SUCCESS_FILE',
    'BACKUP_MAX_AGE_HOURS',
  ];

  function withHealthEnv(overrides, fn) {
    const saved = {};
    for (const key of healthEnvKeys) saved[key] = process.env[key];
    Object.assign(process.env, overrides);
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        for (const key of healthEnvKeys) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      });
  }

  // US-006 — Observabilidade mínima para detectar falha silenciosa
  test('AC-013: `/api/health` reporta app, banco e idade do último backup @spec:AC-013', async () => {
    // Dado: o sistema rodando normalmente (banco alcançável, backup recente)
    // Quando: `GET /api/health` é chamado
    // Então: a resposta é `200` com `{ status: "ok", checks: [...] }`, e cada
    //        check indica o estado de: conexão com o banco, idade do último
    //        backup bem-sucedido e horário da última execução do worker/cron
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-health-ok-'));
    const lastSuccessFile = path.join(tmpDir, '.last-success');
    fs.writeFileSync(lastSuccessFile, new Date().toISOString());

    try {
      await withHealthEnv(
        {
          PGHOST: '127.0.0.1',
          PGPORT: String(port),
          BACKUP_LAST_SUCCESS_FILE: lastSuccessFile,
          BACKUP_MAX_AGE_HOURS: '24',
        },
        async () => {
          const res = await healthGET();
          assert.equal(res.status, 200, 'sistema saudável deve responder 200');

          const body = await res.json();
          assert.equal(body.status, 'ok');
          assert.ok(Array.isArray(body.checks), 'deve reportar checks[]');

          const database = body.checks.find((c) => c.name === 'database');
          assert.ok(database, 'deve reportar check de conexão com o banco');
          assert.equal(database.status, 'ok');

          const backup = body.checks.find((c) => /backup/i.test(c.name));
          assert.ok(backup, 'deve reportar check de idade do último backup');
          assert.equal(backup.status, 'ok');
          assert.equal(typeof backup.ageHours, 'number', 'deve reportar a idade do backup em horas');
          assert.ok(backup.lastSuccessAt, 'deve reportar o horário do último backup bem-sucedido');

          const worker = body.checks.find((c) => /worker|cron/i.test(c.name));
          assert.ok(worker, 'deve reportar check da última execução do worker/cron');
          assert.equal(worker.status, 'ok');
          assert.ok(worker.lastRunAt, 'deve reportar o horário da última execução do worker/cron');
        }
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // US-006 — Observabilidade mínima para detectar falha silenciosa
  test('AC-014: `/api/health` reporta falha quando o banco está inacessível @spec:AC-014', async () => {
    // Dado: o banco indisponível (conexão recusada)
    // Quando: `GET /api/health` é chamado
    // Então: a resposta indica falha no check de banco (status HTTP `503` e
    //        checks[].status = "fail" explícito), nunca um 200 genérico
    //        mascarando o problema
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const unusedPort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-health-fail-'));
    const lastSuccessFile = path.join(tmpDir, '.last-success');
    fs.writeFileSync(lastSuccessFile, new Date().toISOString());

    try {
      await withHealthEnv(
        {
          PGHOST: '127.0.0.1',
          PGPORT: String(unusedPort),
          HEALTH_DB_TIMEOUT_MS: '1000',
          BACKUP_LAST_SUCCESS_FILE: lastSuccessFile,
        },
        async () => {
          const res = await healthGET();
          const body = await res.json();

          const database = body.checks.find((c) => c.name === 'database');
          assert.ok(database, 'resposta deve conter o check de banco');
          assert.equal(database.status, 'fail', 'check de banco deve reportar falha explícita');
          assert.notEqual(body.status, 'ok', 'status geral não pode ser "ok" com o banco fora');

          assert.equal(res.status, 503, 'deve responder 503 quando o banco está inacessível — nunca 200 mascarando a falha');
        }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
