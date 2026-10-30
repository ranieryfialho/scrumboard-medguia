// T-266 (fase5-email-disparo, US-171, AC-708, ASM-261): ponto de entrada do `crm-worker-email` (`npm run worker:email`).
// Só exige `DATABASE_URL` e `SEGREDO_CONFIGURACOES` (não as variáveis do Sheets e da LP, que são do `crm-worker`). Roda um
// ciclo a cada 10 s sem sobrepor o anterior; um ciclo que falha não derruba o processo; no SIGTERM termina o ciclo em curso
// antes de sair. Mesma imagem do CRM (ASM-261).
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { INTERVALO_DO_CICLO_MS, rodarCicloDeEmail } from '../lib/email/disparo-worker';
import { ErroConfiguracaoWorker } from './config';

export const VARIAVEIS_OBRIGATORIAS_EMAIL = ['DATABASE_URL', 'SEGREDO_CONFIGURACOES'] as const;

/** AC-708: lança `ErroConfiguracaoWorker` com os NOMES que faltam, nunca os valores. */
export function carregarConfiguracaoWorkerEmail(env: Record<string, string | undefined> = process.env): { databaseUrl: string } {
  const faltando = VARIAVEIS_OBRIGATORIAS_EMAIL.filter((nome) => !env[nome] || env[nome]?.trim() === '');
  if (faltando.length > 0) throw new ErroConfiguracaoWorker(faltando);
  return { databaseUrl: env.DATABASE_URL as string };
}

export interface OpcoesAgendadorDeEmail {
  intervaloMs?: number;
  rodarCiclo: () => Promise<unknown>;
  aoFalhar?: (erro: unknown) => void;
}

export interface AgendadorDeEmail {
  /** Para de disparar ciclos novos e espera o ciclo em curso terminar. */
  pararEEsperar(): Promise<void>;
}

/** AC-708: um ciclo a cada `intervaloMs`, nunca dois ao mesmo tempo; o ciclo que falha não derruba o processo. */
export function iniciarAgendadorDeEmail({ intervaloMs = INTERVALO_DO_CICLO_MS, rodarCiclo, aoFalhar = () => undefined }: OpcoesAgendadorDeEmail): AgendadorDeEmail {
  let emExecucao: Promise<void> | null = null;
  let parado = false;
  const handle = setInterval(() => {
    if (parado || emExecucao) return;
    emExecucao = rodarCiclo()
      .then(() => undefined)
      .catch(aoFalhar)
      .finally(() => {
        emExecucao = null;
      });
  }, intervaloMs);
  return {
    async pararEEsperar() {
      parado = true;
      clearInterval(handle);
      await emExecucao;
    },
  };
}

async function main(): Promise<void> {
  let config: { databaseUrl: string };
  try {
    config = carregarConfiguracaoWorkerEmail();
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoWorker) {
      console.error(erro.message);
      process.exitCode = 1;
      return;
    }
    throw erro;
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);
  const agendador = iniciarAgendadorDeEmail({
    rodarCiclo: () => rodarCicloDeEmail(db),
    aoFalhar: (erro) => console.error('crm-worker-email: ciclo falhou.', erro),
  });

  process.once('SIGTERM', () => {
    (async () => {
      await agendador.pararEEsperar();
      await pool.end();
      process.exit(0);
    })().catch((erro) => {
      console.error('crm-worker-email: erro ao parar com graça.', erro);
      process.exit(1);
    });
  });
}

const EXECUTADO_DIRETAMENTE = typeof process.argv[1] === 'string' && import.meta.url === `file://${process.argv[1]}`;

if (EXECUTADO_DIRETAMENTE) {
  main().catch((erro) => {
    console.error('crm-worker-email falhou ao iniciar.', erro);
    process.exitCode = 1;
  });
}
