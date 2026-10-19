// T-108 (fase3-etl-supabase, US-074): leitor da origem Supabase legada.
// ASM-087/Q-027: o ETL lê o legado por conexão direta somente leitura, com
// a credencial só em variável de ambiente — nunca `DATABASE_URL` (essa é do
// destino) e nunca hard-coded (P-002). `default_transaction_read_only=on`
// faz o próprio Postgres recusar qualquer escrita nessa conexão, então uma
// etapa que acidentalmente tentasse gravar na origem falha na origem, não
// silenciosamente.
import { Pool } from 'pg';

export const VARIAVEL_AMBIENTE_ORIGEM = 'SUPABASE_LEGADO_DATABASE_URL';

export class ErroOrigemSemCredencial extends Error {
  constructor() {
    super(
      `${VARIAVEL_AMBIENTE_ORIGEM} não definida — necessária para ler o Supabase legado.`
    );
    this.name = 'ErroOrigemSemCredencial';
  }
}

/**
 * Abre uma conexão somente leitura com o Supabase legado. A URL vem de
 * `SUPABASE_LEGADO_DATABASE_URL` por padrão; o parâmetro existe só para
 * facilitar teste.
 */
export function conectarOrigem(
  databaseUrl: string | undefined = process.env[VARIAVEL_AMBIENTE_ORIGEM]
): Pool {
  if (!databaseUrl) {
    throw new ErroOrigemSemCredencial();
  }
  return new Pool({
    connectionString: databaseUrl,
    options: '-c default_transaction_read_only=on',
  });
}

/** Encerra a conexão com a origem. Seguro chamar mesmo após falha parcial. */
export async function encerrarOrigem(pool: Pool): Promise<void> {
  await pool.end();
}
