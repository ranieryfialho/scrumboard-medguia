// T-219 (fase5-metas, US-144): leitura e gravação das metas da empresa da sessão. Sempre por
// `comTenant` — o RLS de `empresa_metas` garante o isolamento por empresa (AC-619).
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaMetas, usuarios } from '../db/schema';
import { ehChaveMeta, type ChaveMeta, type MetasDaEmpresa } from '../lib/metas/catalogo';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export interface MetaCadastrada {
  chave: ChaveMeta;
  valor: number;
  atualizadoEm: string;
  atualizadoPorNome: string | null;
}

export async function lerMetas(db: NodePgDatabase, contexto: ContextoTenant): Promise<MetaCadastrada[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select({ chave: empresaMetas.chave, valor: empresaMetas.valor, atualizadoEm: empresaMetas.atualizadoEm, nome: usuarios.nome })
      .from(empresaMetas)
      .leftJoin(usuarios, eq(usuarios.id, empresaMetas.atualizadoPor));
    return linhas
      .filter((l) => ehChaveMeta(l.chave))
      .map((l) => ({ chave: l.chave as ChaveMeta, valor: Number(l.valor), atualizadoEm: l.atualizadoEm.toISOString(), atualizadoPorNome: l.nome }));
  });
}

export function comoMapa(metas: MetaCadastrada[]): MetasDaEmpresa {
  return Object.fromEntries(metas.map((m) => [m.chave, m.valor]));
}

/** `null` remove a meta (AC-618); número válido grava ou troca (AC-616). Tudo numa transação. */
export async function gravarMetas(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  alteracoes: Partial<Record<ChaveMeta, number | null>>
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    for (const [chave, valor] of Object.entries(alteracoes) as Array<[ChaveMeta, number | null | undefined]>) {
      if (valor === undefined) continue;
      if (valor === null) {
        await tx.delete(empresaMetas).where(and(eq(empresaMetas.empresaId, contexto.empresaId), eq(empresaMetas.chave, chave)));
        continue;
      }
      await tx
        .insert(empresaMetas)
        .values({ empresaId: contexto.empresaId, chave, valor: valor.toFixed(2), atualizadoPor: contexto.usuarioId })
        .onConflictDoUpdate({
          target: [empresaMetas.empresaId, empresaMetas.chave],
          set: { valor: valor.toFixed(2), atualizadoPor: contexto.usuarioId, atualizadoEm: sql`now()` },
        });
    }
  });
}
