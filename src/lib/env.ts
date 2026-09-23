import path from 'node:path';

// Configuração lida em runtime por `/api/health` (AC-013/AC-014). Nenhum
// destes valores é segredo — hosts/portas/caminhos de infraestrutura, não
// credenciais — por isso ficam com default de produção e não em .env.
export interface HealthEnvConfig {
  pgHost: string;
  pgPort: number;
  dbConnectTimeoutMs: number;
  backupLastSuccessFile: string;
  backupMaxAgeHours: number;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getHealthEnvConfig(): HealthEnvConfig {
  const backupDir = process.env.BACKUP_DIR || '/root/backups/crm';
  return {
    pgHost: process.env.PGHOST || 'pg-master',
    pgPort: readPositiveIntEnv('PGPORT', 5432),
    dbConnectTimeoutMs: readPositiveIntEnv('HEALTH_DB_TIMEOUT_MS', 3000),
    // Mesmo arquivo que infra/backup/backup-crm.sh grava em caso de sucesso
    // (ver LAST_SUCCESS_FILE nesse script) — também usado como sinal de
    // "última execução do worker/cron" (T-009 nota em tasks.md).
    backupLastSuccessFile:
      process.env.BACKUP_LAST_SUCCESS_FILE || path.join(backupDir, '.last-success'),
    backupMaxAgeHours: readPositiveIntEnv('BACKUP_MAX_AGE_HOURS', 24),
  };
}
