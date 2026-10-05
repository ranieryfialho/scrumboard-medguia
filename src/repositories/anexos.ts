// T-054 (fase2c-anexos, US-034/US-035/US-036): repositório de anexos. Mesmas
// regras de leads.ts/oportunidades.ts: tudo passa por `comTenant` (T-040) e
// toda query filtra explicitamente por `empresa_id = contexto.empresaId` além
// do RLS — anexo de outro tenant "não existe" (AC-102).
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { anexos, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type Anexo = typeof anexos.$inferSelect;

/** A oportunidade do anexo não existe no tenant do `contexto` (AC-099) — nem em outro tenant, nem em lugar nenhum. */
export class ErroOportunidadeNaoEncontrada extends Error {
  constructor() {
    super('Oportunidade informada não existe no tenant da sessão.');
    this.name = 'ErroOportunidadeNaoEncontrada';
  }
}

export interface DadosNovoAnexo {
  oportunidadeId: string;
  caminho: string;
  mime: string;
  tamanho: number;
  hash: string;
}

/**
 * Registra o anexo sob o tenant e o usuário do `contexto` (AC-095); `empresa_id`
 * e `enviado_por` nunca vêm do payload. O RLS só confere a empresa do anexo,
 * não a da oportunidade referenciada — por isso a checagem explícita (AC-099).
 */
export async function criarAnexo(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: DadosNovoAnexo
): Promise<Anexo> {
  return comTenant(db, contexto, async (tx) => {
    const [oportunidade] = await tx
      .select({ id: oportunidades.id })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, dados.oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    if (!oportunidade) throw new ErroOportunidadeNaoEncontrada();

    const [anexo] = await tx
      .insert(anexos)
      .values({
        empresaId: contexto.empresaId,
        oportunidadeId: dados.oportunidadeId,
        caminho: dados.caminho,
        mime: dados.mime,
        tamanho: dados.tamanho,
        hash: dados.hash,
        enviadoPor: contexto.usuarioId,
      })
      .returning();
    return anexo;
  });
}

/**
 * Anexo do tenant do `contexto`, ou `null` se não existe nele (AC-102). Só
 * precisa da empresa: a rota de arquivo (sem sessão) chama com a empresa que
 * foi assinada na URL (AC-103).
 */
export async function buscarAnexoPorId(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  id: string
): Promise<Anexo | null> {
  return comTenant(db, contexto, async (tx) => {
    const registros = await tx
      .select()
      .from(anexos)
      .where(and(eq(anexos.id, id), eq(anexos.empresaId, contexto.empresaId)))
      .limit(1);
    return registros[0] ?? null;
  });
}

/**
 * `true` só se o anexo existe no tenant E foi enviado para essa mesma
 * oportunidade — evidência de outro card (ou de outro tenant) não vale
 * (AC-106). `anexoId` que não é uuid também dá `false`, sem erro.
 */
export async function anexoValidoParaOportunidade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  anexoId: string,
  oportunidadeId: string
): Promise<boolean> {
  if (!UUID.test(anexoId)) return false;
  const anexo = await buscarAnexoPorId(db, contexto, anexoId);
  return anexo?.oportunidadeId === oportunidadeId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
