import fs from 'node:fs';
import net from 'node:net';
import { getHealthEnvConfig, type HealthEnvConfig } from '../../../lib/env';

export const dynamic = 'force-dynamic';

interface CheckResult {
  name: string;
  status: 'ok' | 'fail';
  detail?: string;
  lastSuccessAt?: string;
  ageHours?: number;
  lastRunAt?: string;
}

// Tenta abrir uma conexão TCP com o Postgres. Sem um driver `pg` no projeto
// ainda (a app roda hoje sobre Supabase — ver decisão de saída para Postgres
// na VPS), uma conexão TCP recusada/expirada já prova o que AC-014 pede:
// "banco indisponível (conexão recusada/timeout)".
function checkDatabaseConnection(config: HealthEnvConfig): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (status: 'ok' | 'fail', detail?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(detail ? { name: 'database', status, detail } : { name: 'database', status });
    };
    socket.setTimeout(config.dbConnectTimeoutMs);
    socket.once('connect', () => finish('ok'));
    socket.once('timeout', () => finish('fail', 'timeout ao conectar no banco'));
    socket.once('error', (err) => finish('fail', err.message));
    socket.connect(config.pgPort, config.pgHost);
  });
}

function checkBackupAge(config: HealthEnvConfig): CheckResult {
  let raw: string;
  try {
    raw = fs.readFileSync(config.backupLastSuccessFile, 'utf8').trim();
  } catch {
    return { name: 'backup', status: 'fail', detail: 'nenhum backup bem-sucedido registrado' };
  }

  const lastSuccessAt = new Date(raw);
  if (Number.isNaN(lastSuccessAt.getTime())) {
    return { name: 'backup', status: 'fail', detail: 'arquivo de último backup com data inválida' };
  }

  const ageHours = (Date.now() - lastSuccessAt.getTime()) / 3_600_000;
  return {
    name: 'backup',
    status: ageHours <= config.backupMaxAgeHours ? 'ok' : 'fail',
    lastSuccessAt: lastSuccessAt.toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
  };
}

// O relógio de cadência (worker Node) é fora do escopo desta feature de
// fundação — hoje o único cron em produção é o backup diário (T-007), então
// seu registro de sucesso também serve como sinal de "última execução do
// worker/cron" pedido por AC-013.
function checkWorkerCron(config: HealthEnvConfig): CheckResult {
  try {
    const stat = fs.statSync(config.backupLastSuccessFile);
    return { name: 'worker', status: 'ok', lastRunAt: stat.mtime.toISOString() };
  } catch {
    return { name: 'worker', status: 'fail', detail: 'nenhuma execução de cron/worker registrada' };
  }
}

export async function GET() {
  const config = getHealthEnvConfig();
  const [database, backup, worker] = await Promise.all([
    checkDatabaseConnection(config),
    Promise.resolve(checkBackupAge(config)),
    Promise.resolve(checkWorkerCron(config)),
  ]);

  const checks = [database, backup, worker];
  const overallOk = checks.every((check) => check.status === 'ok');
  // Falha do banco nunca vira 200 mascarado (AC-014); falha isolada de
  // backup/worker fica reportada em checks[] mas não derruba o HTTP status,
  // já que o alerta desses casos é responsabilidade do próprio job (AC-011).
  const httpStatus = database.status === 'fail' ? 503 : 200;

  return Response.json({ status: overallOk ? 'ok' : 'fail', checks }, { status: httpStatus });
}
