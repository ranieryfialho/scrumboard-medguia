// Testes de spec da feature fase0-fundacao-ci-staging — gerados por onp-spec scaffold
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ciWorkflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
const ciWorkflow = yaml.load(fs.readFileSync(ciWorkflowPath, 'utf8'));

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
  assert.fail('critério de aceite AC-003 ainda não provado — implemente este teste');
});

// US-002 — Deploy por imagem versionada, com rollback em minutos
test('AC-004: Rollback é trocar a tag, sem rebuild @spec:AC-004', () => {
  // Dado: uma imagem `sha-B` já rodando em produção e uma imagem anterior
  // Quando: o operador aciona o rollback apontando para `sha-A`
  // Então: a VPS sobe o container com `sha-A` sem executar nenhum build,
  assert.fail('critério de aceite AC-004 ainda não provado — implemente este teste');
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
