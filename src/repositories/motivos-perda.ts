// T-240 (fase5-motivos-por-empresa, ASM-235/ASM-236): a regra "o motivo é global ou da empresa da
// sessão" — usada pela lista de escolha, pelo catálogo da administração e pelos guards da perda e do
// arquivamento em lote. `motivos_perda` não tem RLS: quem filtra é esta regra.
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { motivosPerda } from '../db/schema';
import type { TransacaoTenant } from './contexto';

/** O que a empresa enxerga: os globais e os dela. */
export function motivosDaEmpresa(empresaId: string): SQL {
  return or(isNull(motivosPerda.empresaId), eq(motivosPerda.empresaId, empresaId)) as SQL;
}

type Consulta = NodePgDatabase | TransacaoTenant;

/** AC-664: os motivos ativos que a empresa pode escolher, em ordem alfabética. */
export async function listarMotivosAtivos(db: Consulta, empresaId: string): Promise<Array<{ id: string; nome: string }>> {
  return db
    .select({ id: motivosPerda.id, nome: motivosPerda.nome })
    .from(motivosPerda)
    .where(and(eq(motivosPerda.ativo, true), motivosDaEmpresa(empresaId)))
    .orderBy(asc(motivosPerda.nome));
}

/** AC-665: o motivo existe e é global ou da empresa (ativo ou não — quem decide "ativo" é cada chamador). */
export async function motivoDaEmpresaOuGlobal(db: Consulta, empresaId: string, motivoId: string): Promise<{ id: string; ativo: boolean } | null> {
  const [motivo] = await db
    .select({ id: motivosPerda.id, ativo: motivosPerda.ativo })
    .from(motivosPerda)
    .where(and(eq(motivosPerda.id, motivoId), motivosDaEmpresa(empresaId)))
    .limit(1);
  return motivo ?? null;
}
