// T-129 (fase3-ingestao-continua, US-091): verificação de saúde do
// `crm-worker` — prova de AC-323.
//
// AC-323: a saúde é calculada por origem (`job`, mesmo nome gravado em
// `cron_execucoes` por `rodarCicloImportacao`, src/worker/ciclo.ts), olhando
// só para o próprio histórico de execuções — nada de depender do agendador
// (T-130) estar vivo. Uma origem está saudável quando:
//   - a ÚLTIMA tentativa (qualquer status) não terminou em "falha"; E
//   - existe um sucesso cujo fim (`concluidoEm`) caiu dentro do prazo de
//     duas vezes o intervalo configurado (`intervaloImportacaoMin`, ASM-108).
// Sem nenhuma execução registrada para a origem, ela conta como "doente" —
// não há sucesso nenhum dentro do prazo. O worker inteiro só é "saudável"
// se TODAS as origens estiverem.
import { and, desc, eq, gte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { cronExecucoes } from '../db/schema';

// T-137 (fase3-espelho-sheets, US-096): AC-338 — o job `espelho-sheets` tem
// prazo PRÓPRIO e fixo (45 min, TDD-001 §8), independente do intervalo de
// importação usado pelas demais origens.
export const JOB_ESPELHO_SHEETS = 'espelho-sheets';
const PRAZO_ESPELHO_MIN = 45;

export type StatusSaude = 'saudavel' | 'doente';

export interface SaudeOrigem {
  job: string;
  status: StatusSaude;
  ultimoStatus?: 'em_execucao' | 'sucesso' | 'falha';
  ultimoSucessoEm?: Date;
}

export interface ResultadoSaudeWorker {
  status: StatusSaude;
  origens: SaudeOrigem[];
}

/**
 * Verifica a saúde de UMA origem (AC-323): saudável só se a última
 * tentativa não falhou e há um sucesso registrado dentro do prazo (duas
 * vezes `intervaloImportacaoMin`, a partir de `agora`).
 */
export async function verificarSaudeOrigem(
  db: NodePgDatabase,
  job: string,
  intervaloImportacaoMin: number,
  agora: Date = new Date()
): Promise<SaudeOrigem> {
  const prazoMs = intervaloImportacaoMin * 2 * 60_000;
  const desdeEm = new Date(agora.getTime() - prazoMs);

  const [ultimaTentativa] = await db
    .select()
    .from(cronExecucoes)
    .where(eq(cronExecucoes.job, job))
    .orderBy(desc(cronExecucoes.iniciadoEm))
    .limit(1);

  const [ultimoSucessoDentroDoPrazo] = await db
    .select()
    .from(cronExecucoes)
    .where(
      and(
        eq(cronExecucoes.job, job),
        eq(cronExecucoes.status, 'sucesso'),
        gte(cronExecucoes.concluidoEm, desdeEm)
      )
    )
    .orderBy(desc(cronExecucoes.concluidoEm))
    .limit(1);

  const saudavel =
    ultimaTentativa?.status !== 'falha' && ultimoSucessoDentroDoPrazo !== undefined;

  return {
    job,
    status: saudavel ? 'saudavel' : 'doente',
    ultimoStatus: ultimaTentativa?.status,
    ultimoSucessoEm: ultimoSucessoDentroDoPrazo?.concluidoEm ?? undefined,
  };
}

/**
 * Verifica a saúde do espelho Sheets (AC-338): "atrasado" (doente) quando a
 * última execução BEM-SUCEDIDA de `espelho-sheets` tem mais de 45 minutos,
 * ou nunca houve nenhuma. Não olha a última tentativa (diferente de
 * `verificarSaudeOrigem`) nem depende do intervalo de importação — só lê
 * `cron_execucoes`, independente das demais origens.
 */
export async function verificarSaudeEspelho(
  db: NodePgDatabase,
  agora: Date = new Date()
): Promise<SaudeOrigem> {
  const desdeEm = new Date(agora.getTime() - PRAZO_ESPELHO_MIN * 60_000);

  const [ultimoSucessoDentroDoPrazo] = await db
    .select()
    .from(cronExecucoes)
    .where(
      and(
        eq(cronExecucoes.job, JOB_ESPELHO_SHEETS),
        eq(cronExecucoes.status, 'sucesso'),
        gte(cronExecucoes.concluidoEm, desdeEm)
      )
    )
    .orderBy(desc(cronExecucoes.concluidoEm))
    .limit(1);

  return {
    job: JOB_ESPELHO_SHEETS,
    status: ultimoSucessoDentroDoPrazo ? 'saudavel' : 'doente',
    ultimoSucessoEm: ultimoSucessoDentroDoPrazo?.concluidoEm ?? undefined,
  };
}

/**
 * Verifica a saúde do worker inteiro (AC-323, AC-338): roda uma origem por
 * vez e só diz "saudável" se TODAS as origens estiverem em dia. O job
 * `espelho-sheets` usa o prazo fixo de 45 min (`verificarSaudeEspelho`); as
 * demais origens usam o prazo de 2x `intervaloImportacaoMin`.
 */
export async function verificarSaudeWorker(
  db: NodePgDatabase,
  jobs: string[],
  intervaloImportacaoMin: number,
  agora: Date = new Date()
): Promise<ResultadoSaudeWorker> {
  const origens = await Promise.all(
    jobs.map((job) =>
      job === JOB_ESPELHO_SHEETS
        ? verificarSaudeEspelho(db, agora)
        : verificarSaudeOrigem(db, job, intervaloImportacaoMin, agora)
    )
  );

  return {
    status: origens.every((origem) => origem.status === 'saudavel') ? 'saudavel' : 'doente',
    origens,
  };
}
