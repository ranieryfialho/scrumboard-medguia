// T-128 (fase3-ingestao-continua, US-090 a US-092): ciclo de importação do
// `crm-worker` — trava, registro e isolamento de falhas por origem.
//
// AC-325 (ASM-110): a trava usa `pg_try_advisory_lock` numa conexão dedicada
// (não a do pool compartilhado do `db`), uma por origem (`job`). Como a
// trava é por sessão Postgres, ela também cobre AC-324: enquanto a conexão
// de um ciclo ainda em andamento está com a trava, um disparo atrasado da
// MESMA origem — do mesmo worker ou de outro processo apontando pro mesmo
// banco — não consegue adquiri-la e volta como "pulado", sem abrir outra
// importação nem tocar em `cron_execucoes`/`importacoes`.
//
// AC-318/AC-319: quem decide o que é lido/criado/ignorado é o
// `executarImportacao` injetado (as etapas de `src/etl/sheets/executar.ts`
// e `src/etl/lp/executar.ts`, chamadas sem decisões — ASM-107, ASM-109).
// Este arquivo só sabe contar o que esse callback devolve; por isso depende
// de T-127 apenas pelo tipo de configuração, não pela leitura real das
// origens (isso é responsabilidade de quem monta o `executarImportacao`,
// em T-130).
//
// AC-321: toda execução que chega a adquirir a trava grava uma linha em
// `cron_execucoes` (início, fim, status) e, se terminar com sucesso, uma em
// `importacoes` (contagens). Erros gravam o texto da mensagem já sem
// credenciais (`mensagemErroSegura`, mesmo padrão de `mascarar` em
// `comum.ts`) — nunca o objeto de erro bruto.
//
// AC-322: `rodarCicloImportacao` nunca deixa um erro escapar — ele vira uma
// linha de "falha" no registro e um resultado de retorno. `rodarCiclosImportacao`
// roda cada origem de forma independente (cada uma com seu `try/catch`), então
// uma origem fora do ar não derruba a outra nem o processo do worker.
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { cronExecucoes, importacoes } from '../db/schema';

export type StatusCiclo = 'sucesso' | 'falha' | 'pulado';

export interface ResultadoImportacao {
  linhasLidas: number;
  linhasCriadas: number;
  linhasIgnoradas: number;
}

/** Roda a importação completa de uma origem e devolve as contagens (AC-318, AC-319). */
export type ExecutorImportacao = () => Promise<ResultadoImportacao>;

export interface ResultadoCiclo extends ResultadoImportacao {
  job: string;
  status: StatusCiclo;
  /** Mensagem já sem segredos (AC-321) — só presente quando `status === 'falha'`. */
  erro?: string;
}

export interface CicloOrigem {
  /** Nome do job, usado como `cron_execucoes.job` / `importacoes.origem` (ASM-111). */
  job: string;
  executarImportacao: ExecutorImportacao;
}

const RESULTADO_VAZIO: ResultadoImportacao = {
  linhasLidas: 0,
  linhasCriadas: 0,
  linhasIgnoradas: 0,
};

// Credenciais em URLs de conexão (`postgres://usuario:senha@host`) nunca
// aparecem na mensagem de erro gravada em `cron_execucoes.erro` (AC-321,
// mesmo princípio de P-002/`mascarar` em `comum.ts`).
const PADRAO_CREDENCIAL_URL = /\/\/[^/\s:@]+:[^/\s@]+@/g;

/** Extrai a mensagem de um erro qualquer sem deixar passar credenciais de URL (AC-321). */
export function mensagemErroSegura(erro: unknown): string {
  const bruta = erro instanceof Error ? erro.message : String(erro);
  return bruta.replace(PADRAO_CREDENCIAL_URL, '//***:***@');
}

/**
 * Deriva uma chave numérica estável (FNV-1a de 32 bits) para
 * `pg_try_advisory_lock` a partir do nome do job — mesma origem sempre cai
 * na mesma chave, origens diferentes (quase certamente) em chaves diferentes.
 */
export function chaveTravaAdvisory(job: string): number {
  let hash = 0x811c9dc5;
  for (let indice = 0; indice < job.length; indice += 1) {
    hash ^= job.charCodeAt(indice);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Roda o ciclo de importação de UMA origem (AC-318/AC-319 via
 * `executarImportacao`), protegido por `pg_try_advisory_lock` (AC-324,
 * AC-325) e registrado em `cron_execucoes`/`importacoes` (AC-321). Nunca
 * lança — qualquer erro do executor vira um resultado `falha` (AC-322).
 */
export async function rodarCicloImportacao(
  pool: Pool,
  db: NodePgDatabase,
  job: string,
  executarImportacao: ExecutorImportacao
): Promise<ResultadoCiclo> {
  const client = await pool.connect();
  const chave = chaveTravaAdvisory(job);
  let travou = false;
  try {
    const { rows } = await client.query<{ travou: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS travou',
      [chave]
    );
    travou = rows[0]?.travou ?? false;
    if (!travou) {
      return { job, status: 'pulado', ...RESULTADO_VAZIO };
    }

    const iniciadoEm = new Date();
    const [execucao] = await db
      .insert(cronExecucoes)
      .values({ job, iniciadoEm, status: 'em_execucao' })
      .returning({ id: cronExecucoes.id });

    try {
      const resultado = await executarImportacao();
      const concluidoEm = new Date();
      await db
        .update(cronExecucoes)
        .set({ status: 'sucesso', concluidoEm, itensProcessados: resultado.linhasLidas })
        .where(eq(cronExecucoes.id, execucao.id));
      await db.insert(importacoes).values({
        origem: job,
        janelaInicio: iniciadoEm,
        janelaFim: concluidoEm,
        linhasLidas: resultado.linhasLidas,
        linhasCriadas: resultado.linhasCriadas,
        linhasIgnoradas: resultado.linhasIgnoradas,
      });
      return { job, status: 'sucesso', ...resultado };
    } catch (erro) {
      const mensagem = mensagemErroSegura(erro);
      await db
        .update(cronExecucoes)
        .set({ status: 'falha', concluidoEm: new Date(), erro: mensagem })
        .where(eq(cronExecucoes.id, execucao.id));
      return { job, status: 'falha', ...RESULTADO_VAZIO, erro: mensagem };
    }
  } finally {
    if (travou) {
      await client.query('SELECT pg_advisory_unlock($1)', [chave]).catch(() => {});
    }
    client.release();
  }
}

/**
 * Roda o ciclo de várias origens de forma isolada (AC-322): cada origem tem
 * seu próprio `try/catch`, então uma origem fora do ar nunca impede o
 * registro ou o resultado das demais, nem derruba quem chamou esta função.
 */
export async function rodarCiclosImportacao(
  pool: Pool,
  db: NodePgDatabase,
  ciclos: CicloOrigem[]
): Promise<ResultadoCiclo[]> {
  return Promise.all(
    ciclos.map(async ({ job, executarImportacao }) => {
      try {
        return await rodarCicloImportacao(pool, db, job, executarImportacao);
      } catch (erro) {
        return { job, status: 'falha' as const, ...RESULTADO_VAZIO, erro: mensagemErroSegura(erro) };
      }
    })
  );
}
