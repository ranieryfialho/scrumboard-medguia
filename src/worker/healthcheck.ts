// T-283 (fase3-ingestao-continua, AC-323, AC-732): o healthcheck do container do worker, como um ARQUIVO de verdade, e não um
// script dentro do YAML. A versão antiga (`npx tsx -e "import('./src/worker/config').then(({ carregarConfiguracaoWorker }) => …"`)
// recebia `undefined` no carregamento dinâmico, caía no `.catch(() => process.exit(1))` e saía com 1 para sempre, mesmo com o
// worker perfeito; nunca tinha sido executada, só o texto dela era testado. Aqui os imports são normais, o resultado por origem
// vai para a saída (o Docker guarda a última em `docker inspect`) e um erro é impresso, nunca engolido.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { carregarConfiguracaoWorker, lpHabilitada, type ConfiguracaoWorker } from './config';
import { verificarSaudeWorker, type ResultadoSaudeWorker } from './saude';

type ConfigDeSaude = Pick<ConfiguracaoWorker, 'supabaseLpUrl' | 'supabaseLpServiceKey' | 'intervaloImportacaoMin'>;

/** AC-731: a LP só entra na conta de saúde quando está configurada. */
export function origensParaSaude(config: ConfigDeSaude): string[] {
  return lpHabilitada(config) ? ['import-sheets', 'import-lp'] : ['import-sheets'];
}

/** AC-323: 0 = todas as origens em dia; 1 = alguma doente. */
export async function executarHealthcheckWorker(
  db: NodePgDatabase,
  config: ConfigDeSaude,
  agora: Date = new Date()
): Promise<{ codigo: 0 | 1; resultado: ResultadoSaudeWorker }> {
  const resultado = await verificarSaudeWorker(db, origensParaSaude(config), config.intervaloImportacaoMin, agora);
  return { codigo: resultado.status === 'saudavel' ? 0 : 1, resultado };
}

async function main(): Promise<void> {
  let pool: Pool | undefined;
  try {
    const config = carregarConfiguracaoWorker();
    pool = new Pool({ connectionString: config.databaseUrl });
    const { codigo, resultado } = await executarHealthcheckWorker(drizzle(pool), config);
    console.log(JSON.stringify(resultado));
    process.exitCode = codigo;
  } catch (erro) {
    console.error('healthcheck do worker falhou:', erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

const EXECUTADO_DIRETAMENTE = typeof process.argv[1] === 'string' && import.meta.url === `file://${process.argv[1]}`;

if (EXECUTADO_DIRETAMENTE) {
  void main();
}
