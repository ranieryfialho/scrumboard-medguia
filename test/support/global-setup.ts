// Rede de segurança contra container de teste órfão: cada Postgres efêmero
// (test/support/postgres-efemero.ts e test/fase0-fundacao-ci-staging.spec.test.js)
// leva o rótulo `crm-test-run=<id desta rodada>`. Se um teste estoura timeout
// ou o processo do worker morre antes do `afterAll`, o container ficaria vivo
// e, acumulado, a carga do Docker derrubava suítes seguintes (falso "skip").
// Aqui: no início, varre sobras com mais de 1h (rodadas mortas com kill -9);
// no fim, remove tudo que esta rodada subiu.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROTULO = 'crm-test-run';
const IDADE_MAXIMA_MS = 60 * 60 * 1000;

function docker(args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function removerContainers(ids: string[]) {
  if (ids.length > 0) docker(['rm', '-f', '-v', ...ids]);
}

export function setup() {
  const runId = crypto.randomBytes(6).toString('hex');
  // Herdado pelos workers: o harness lê para rotular os containers.
  process.env.CRM_TEST_RUN_ID = runId;

  const listados = docker([
    'ps', '-a', '--filter', `label=${ROTULO}`, '--format', '{{.ID}} {{.CreatedAt}}',
  ]);
  if (listados.status !== 0) return;
  const velhos: string[] = [];
  for (const linha of listados.stdout.split('\n').filter(Boolean)) {
    const [id, ...resto] = linha.split(' ');
    // "2026-10-13 16:12:48 -0300 -03" → Date entende os 3 primeiros campos.
    const criado = Date.parse(resto.slice(0, 3).join(' '));
    if (Number.isFinite(criado) && Date.now() - criado > IDADE_MAXIMA_MS) velhos.push(id);
  }
  removerContainers(velhos);
}

export function teardown() {
  const runId = process.env.CRM_TEST_RUN_ID;
  if (!runId) return;
  const meus = docker(['ps', '-aq', '--filter', `label=${ROTULO}=${runId}`]);
  if (meus.status === 0) removerContainers(meus.stdout.split('\n').filter(Boolean));
}
