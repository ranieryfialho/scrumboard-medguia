// T-108 (fase3-etl-supabase, US-074): contrato comum que T-109 a T-113 usam
// para ler a origem e gravar no destino — mascaramento de segredos
// (AC-266), checagem de idempotência via `migracao_registros` (AC-267),
// simulação (dry-run, AC-268) e transação única por execução (AC-270).
//
// `executarEtl` abre UMA transação Drizzle por execução e passa a mesma
// `tx` para todas as etapas do orquestrador (T-113): um erro em qualquer
// etapa derruba a transação inteira (AC-270, nada fica pela metade) — e,
// em simulação, a transação é sempre desfeita no final, mesmo sem erro
// (AC-268), via `RollbackSimulacao` (erro interno que nunca escapa daqui).
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { migracaoRegistros } from '../db/schema';

/** Transação recebida pelo callback de `executarEtl`. */
export type TransacaoEtl = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * AC-730: informa ao banco de qual empresa é a transação do ETL (o mesmo `app.empresa_id` das telas). Sem isso o isolamento por
 * empresa recusa qualquer consulta às tabelas de dados e o ETL só funcionava com o papel dono das tabelas (`crm_migrator`, que o
 * isolamento não barra), papel que o worker não deve usar em tempo de execução (AC-008). Com a empresa informada o worker roda com
 * o papel limitado `crm_app`. Vale para os ETLs de UMA empresa (Sheets e LP); o do Supabase lê várias e segue rodando como dono.
 */
export async function definirEmpresaDoEtl(tx: TransacaoEtl, empresaId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.empresa_id', ${empresaId}, true)`);
}

/** Contexto fixo de uma execução do ETL — a mesma instância percorre todas as etapas. */
export interface ContextoExecucao {
  /** Identifica a origem para `migracao_registros` (ex.: "supabase-legado"). */
  origem: string;
  /** Modo simulação (dry-run, AC-268): nada é gravado no destino ao final. */
  simulacao: boolean;
}

export interface RegistroMigracao {
  /** Entidade do destino (ex.: "empresa", "usuario", "lead"). */
  entidade: string;
  /** Id do registro na origem (chave que casa com `migracao_registros`). */
  idExterno: string;
  /** Id já criado no destino. */
  idDestino: string;
}

const QUANTIDADE_VISIVEL = 2;

/**
 * Mascara um segredo para relatório/log (AC-266): mantém só os primeiros e
 * últimos `QUANTIDADE_VISIVEL` caracteres, cobrindo o resto com `*`. Valores
 * curtos (≤ 2×QUANTIDADE_VISIVEL) ficam totalmente mascarados — não há
 * tamanho mínimo que garanta espaço para os dois lados visíveis sem vazar o
 * segredo inteiro.
 */
export function mascarar(valor: string | null | undefined): string {
  if (!valor) return '';
  if (valor.length <= QUANTIDADE_VISIVEL * 2) return '*'.repeat(valor.length);
  const inicio = valor.slice(0, QUANTIDADE_VISIVEL);
  const fim = valor.slice(-QUANTIDADE_VISIVEL);
  const meio = '*'.repeat(valor.length - QUANTIDADE_VISIVEL * 2);
  return `${inicio}${meio}${fim}`;
}

/**
 * Busca o `id` de destino já migrado para `(origem, idExterno)`, se existir
 * (AC-267) — a etapa chamadora usa isso para pular a criação e não duplicar
 * em reexecução.
 */
export async function buscarIdDestino(
  tx: TransacaoEtl,
  origem: string,
  idExterno: string
): Promise<string | undefined> {
  const [linha] = await tx
    .select({ idDestino: migracaoRegistros.idDestino })
    .from(migracaoRegistros)
    .where(and(eq(migracaoRegistros.origem, origem), eq(migracaoRegistros.idExterno, idExterno)));
  return linha?.idDestino;
}

/**
 * Registra `(origem, idExterno) -> idDestino` em `migracao_registros`
 * (AC-267). Não faz checagem prévia de duplicidade — quem decide se cria ou
 * pula é a etapa chamadora, via `buscarIdDestino`; a constraint única de
 * `(origem, id_externo)` é a última linha de defesa.
 */
export async function registrarMigracao(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  registro: RegistroMigracao
): Promise<void> {
  await tx.insert(migracaoRegistros).values({
    origem: contexto.origem,
    idExterno: registro.idExterno,
    entidade: registro.entidade,
    idDestino: registro.idDestino,
  });
}

/** Erro interno de controle de fluxo — nunca escapa de `executarEtl`. */
class RollbackSimulacao extends Error {
  constructor() {
    super('Rollback interno de simulação — não deveria ser visto fora de executarEtl.');
    this.name = 'RollbackSimulacao';
  }
}

/**
 * Roda `fn` dentro de uma única transação (AC-270: erro no meio derruba
 * tudo, nada fica pela metade). Em simulação (`contexto.simulacao`, AC-268),
 * `fn` roda por completo — para que a etapa calcule o que faria — mas a
 * transação é sempre desfeita ao final, mesmo sem erro, então o destino sai
 * idêntico a como entrou.
 */
export async function executarEtl<T>(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  fn: (tx: TransacaoEtl, contexto: ContextoExecucao) => Promise<T>
): Promise<T> {
  let resultado: T | undefined;
  try {
    await db.transaction(async (tx) => {
      resultado = await fn(tx, contexto);
      if (contexto.simulacao) {
        throw new RollbackSimulacao();
      }
    });
  } catch (erro) {
    if (erro instanceof RollbackSimulacao) {
      return resultado as T;
    }
    throw erro;
  }
  return resultado as T;
}
