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

// T-093 (fase2b-cadencia, AC-202): segredo que protege a rota interna do
// job diário de virada (`POST /api/cron/cadencia`, ASM-058). Este, sim, é
// credencial — por isso não tem default: sem `CRON_SEGREDO` configurada, a
// rota deve falhar fechada (nenhuma chamada autoriza por acidente), nunca
// aceitar silenciosamente.
export function getCronSegredo(): string {
  const valor = process.env.CRON_SEGREDO;
  if (!valor) throw new Error('CRON_SEGREDO não definida — necessária para a rota interna do job diário de cadência.');
  return valor;
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
