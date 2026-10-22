// T-127 (fase3-ingestao-continua, US-090/US-093): lê e valida a
// configuração do `crm-worker` antes de ele subir.
//
// AC-327 — se faltar uma variável obrigatória, `carregarConfiguracaoWorker`
// lança `ErroConfiguracaoWorker` com os NOMES das variáveis ausentes, nunca
// seus valores (P-002, mesmo padrão de `ErroOrigemSemCredencial` em
// `src/etl/lp/origem.ts`).
//
// AC-320 — `intervaloImportacaoMin` é o intervalo único usado pelos dois
// ciclos (Sheets e LP); `WORKER_INTERVALO_IMPORT_MIN` é opcional e cai no
// padrão de 5 minutos (ASM-108) quando ausente ou não for um número > 0.
//
// T-136 (fase3-espelho-sheets, AC-337, ASM-120) — `intervaloEspelhoMin` é o
// intervalo do job `espelho-sheets`, independente do dos dois ciclos de
// importação. `WORKER_INTERVALO_ESPELHO_MIN` segue a mesma validação de
// `WORKER_INTERVALO_IMPORT_MIN`: ausente ou inválido cai no padrão de 15 min.

/** Nomes das variáveis obrigatórias — nunca os valores aparecem em erro ou log. */
export const VARIAVEIS_OBRIGATORIAS = [
  'DATABASE_URL',
  'SUPABASE_LP_URL',
  'SUPABASE_LP_SERVICE_KEY',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
] as const;

export const INTERVALO_IMPORT_MIN_PADRAO = 5;
export const INTERVALO_ESPELHO_MIN_PADRAO = 15;

export class ErroConfiguracaoWorker extends Error {
  constructor(public readonly variaveisFaltando: string[]) {
    super(`Configuração do worker incompleta. Faltam: ${variaveisFaltando.join(', ')}.`);
    this.name = 'ErroConfiguracaoWorker';
  }
}

export interface ConfiguracaoWorker {
  databaseUrl: string;
  supabaseLpUrl: string;
  supabaseLpServiceKey: string;
  googleClientEmail: string;
  googlePrivateKey: string;
  intervaloImportacaoMin: number;
  intervaloEspelhoMin: number;
}

function lerIntervaloMin(valorBruto: string | undefined, padrao: number): number {
  if (valorBruto === undefined || valorBruto.trim() === '') {
    return padrao;
  }
  const valor = Number(valorBruto);
  if (!Number.isFinite(valor) || valor <= 0) {
    return padrao;
  }
  return valor;
}

/**
 * Carrega a configuração do worker a partir de `env` (por padrão `process.env`).
 * AC-327: lança `ErroConfiguracaoWorker` com a lista de nomes faltando antes
 * de o worker tentar subir, sem revelar nenhum valor.
 */
export function carregarConfiguracaoWorker(
  env: Record<string, string | undefined> = process.env
): ConfiguracaoWorker {
  const faltando = VARIAVEIS_OBRIGATORIAS.filter((nome) => !env[nome] || env[nome]?.trim() === '');
  if (faltando.length > 0) {
    throw new ErroConfiguracaoWorker(faltando);
  }

  return {
    databaseUrl: env.DATABASE_URL as string,
    supabaseLpUrl: env.SUPABASE_LP_URL as string,
    supabaseLpServiceKey: env.SUPABASE_LP_SERVICE_KEY as string,
    googleClientEmail: env.GOOGLE_CLIENT_EMAIL as string,
    googlePrivateKey: env.GOOGLE_PRIVATE_KEY as string,
    intervaloImportacaoMin: lerIntervaloMin(env.WORKER_INTERVALO_IMPORT_MIN, INTERVALO_IMPORT_MIN_PADRAO),
    intervaloEspelhoMin: lerIntervaloMin(env.WORKER_INTERVALO_ESPELHO_MIN, INTERVALO_ESPELHO_MIN_PADRAO),
  };
}
