// T-040 (fase1-repositorios-isolamento, US-026): única porta de entrada dos
// repositórios para o banco. `comTenant` abre uma transação e seta
// `app.empresa_id` (via `set_config`, parametrizado — `SET LOCAL` puro não
// aceita bind) a partir do `ContextoTenant` já resolvido da sessão
// (`resolverContextoTenant`, T-031) ANTES de rodar a operação, para que o
// RLS (T-015) tenha o que filtrar (AC-065). Nenhum repositório desta feature
// toca `db`/`tx` fora desta função — é a segunda camada de defesa em
// profundidade do TDD-001 §4.7 (sessão → repositório → RLS).
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContextoTenant } from '../lib/auth/tenant';

/** Transação Drizzle recebida pelo callback de `comTenant`. */
export type TransacaoTenant = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export class ErroContextoTenantAusente extends Error {
  constructor() {
    super('Operação de repositório exige um ContextoTenant válido.');
    this.name = 'ErroContextoTenantAusente';
  }
}

/**
 * Roda `fn` dentro de uma transação com `app.empresa_id` já definido a
 * partir de `contexto.empresaId` (AC-065).
 *
 * - AC-066: sem `contexto` (ou sem `contexto.empresaId`) — por exemplo, uma
 *   chamada que ignora o tipo em tempo de execução — nenhuma query roda; a
 *   função recusa antes de abrir a transação.
 * - AC-067: a role usada pela conexão é responsabilidade do `db` recebido
 *   (em produção, `crm_app` — a mesma role que AC-020 já prova, sem
 *   `SET LOCAL`, não lê nem escreve linha nenhuma).
 */
export async function comTenant<T>(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  fn: (tx: TransacaoTenant) => Promise<T>
): Promise<T> {
  if (!contexto || !contexto.empresaId) {
    throw new ErroContextoTenantAusente();
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.empresa_id', ${contexto.empresaId}, true)`);
    return fn(tx);
  });
}
