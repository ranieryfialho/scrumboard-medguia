// Testes de spec da feature fase0-fundacao-ci-staging — gerados por onp-spec scaffold
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

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
  const serviceNames = Object.keys(services);
  assert.ok(serviceNames.length >= 1, 'docker-compose.yml deve definir ao menos um serviço');
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

// US-003 — Ambiente de staging isolado para ensaiar mudanças
test('AC-005: Staging usa um database Postgres separado de produção @spec:AC-005', () => {
  // Dado: o `pg-master` já existente na VPS (compartilhado com outros
  // Quando: os databases do CRM são criados
  // Então: existem `crm_prod` e `crm_staging` como databases distintos, e a
  assert.fail('critério de aceite AC-005 ainda não provado — implemente este teste');
});

// US-003 — Ambiente de staging isolado para ensaiar mudanças
test('AC-006: Staging é publicamente acessível só por quem tem o link/credencial da equipe @spec:AC-006', () => {
  // Dado: o container `crm-app` de staging subindo na VPS
  // Quando: inspecionada a topologia de rede (nginx-proxy-manager, `docker-compose`)
  // Então: staging fica atrás do mesmo proxy com TLS, sem porta adicional
  assert.fail('critério de aceite AC-006 ainda não provado — implemente este teste');
});

// US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
test('AC-007: `crm_app` não tem privilégio de superusuário nem DDL @spec:AC-007', () => {
  // Dado: a role `crm_app` usada pela aplicação em runtime
  // Quando: ela tenta executar `CREATE TABLE` ou qualquer DDL, ou ler dados
  // Então: o Postgres rejeita a operação (a role não tem `SUPERUSER`,
  assert.fail('critério de aceite AC-007 ainda não provado — implemente este teste');
});

// US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
test('AC-008: `crm_migrator` é a única role com DDL, usada só pelo job de migration @spec:AC-008', () => {
  // Dado: o job efêmero de migration (`crm_migrator`)
  // Quando: ele roda uma migration do `drizzle-kit`
  // Então: consegue alterar o schema, e nenhuma outra credencial usada pelo
  assert.fail('critério de aceite AC-008 ainda não provado — implemente este teste');
});

// US-004 — Banco isolado por roles, sem superusuário compartilhado, sem porta exposta
test('AC-009: Postgres não publica porta na internet @spec:AC-009', () => {
  // Dado: o `docker-compose.yml` de produção/staging
  // Quando: inspecionado o serviço `pg-master`
  // Então: não há `ports:` publicando 5432 em `0.0.0.0` — o acesso é só pela
  assert.fail('critério de aceite AC-009 ainda não provado — implemente este teste');
});

// US-005 — Backup diário automático com restore testado
test('AC-010: Backup diário roda e é enviado para fora da VPS @spec:AC-010', () => {
  // Dado: o cron de backup configurado às 03h
  // Quando: o job roda com sucesso
  // Então: existe, no remote externo (`rclone` → `gdrive:`, pasta própria do
  assert.fail('critério de aceite AC-010 ainda não provado — implemente este teste');
});

// US-005 — Backup diário automático com restore testado
test('AC-011: Alerta dispara se o backup falhar ou atrasar @spec:AC-011', () => {
  // Dado: o job de backup
  // Quando: ele falha, ou quando `/api/health` verifica que o último backup
  // Então: um alerta é enviado (WhatsApp via Evolution API, no padrão do
  assert.fail('critério de aceite AC-011 ainda não provado — implemente este teste');
});

// US-005 — Backup diário automático com restore testado
test('AC-012: Restore ensaiado recupera um dump em staging @spec:AC-012', () => {
  // Dado: um dump de backup válido
  // Quando: o procedimento de restore documentado é executado contra
  // Então: o banco de staging fica íntegro e consultável, provando que o
  assert.fail('critério de aceite AC-012 ainda não provado — implemente este teste');
});

// US-006 — Observabilidade mínima para detectar falha silenciosa
test('AC-013: `/api/health` reporta app, banco e idade do último backup @spec:AC-013', () => {
  // Dado: o sistema rodando normalmente
  // Quando: `GET /api/health` é chamado
  // Então: a resposta é `200` com `{ status: "ok", checks: [...] }`, e cada
  assert.fail('critério de aceite AC-013 ainda não provado — implemente este teste');
});

// US-006 — Observabilidade mínima para detectar falha silenciosa
test('AC-014: `/api/health` reporta falha quando o banco está inacessível @spec:AC-014', () => {
  // Dado: o banco indisponível (conexão recusada/timeout)
  // Quando: `GET /api/health` é chamado
  // Então: a resposta indica falha no check de banco (status HTTP `503` ou
  assert.fail('critério de aceite AC-014 ainda não provado — implemente este teste');
});
