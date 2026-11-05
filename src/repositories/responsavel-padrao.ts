// Responsável padrão dos cards novos (migration 0036). Cada empresa escolhe quem recebe, por padrão, os cards que nascem sem responsável;
// a escolha fica em `empresa_configuracoes` e o próprio banco a aplica na criação do card. "Aplicar" leva o padrão também aos cards que já
// estão sem responsável, pela mesma reatribuição das telas (um evento `reatribuicao` em cada card).
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { listarResponsaveisAtivos, reatribuirEmLote, type ResponsavelAtivo } from './lote-reatribuicao';

export const CHAVE_RESPONSAVEL_PADRAO = 'responsavel_padrao_id';

export interface EstadoDoResponsavelPadrao {
  /** O escolhido, se ainda for um membro ativo da empresa; senão `null`. */
  responsavelId: string | null;
  /** Quem pode ser escolhido (membros ativos da empresa). */
  responsaveis: ResponsavelAtivo[];
  /** Quantos cards da empresa estão sem responsável agora. */
  semResponsavel: number;
}

export async function lerResponsavelPadrao(db: NodePgDatabase, contexto: ContextoTenant): Promise<EstadoDoResponsavelPadrao> {
  const responsaveis = await listarResponsaveisAtivos(db, contexto);
  const { gravado, semResponsavel } = await comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(and(eq(empresaConfiguracoes.empresaId, contexto.empresaId), eq(empresaConfiguracoes.chave, CHAVE_RESPONSAVEL_PADRAO)))
      .limit(1);
    const cards = await tx
      .select({ id: oportunidades.id })
      .from(oportunidades)
      .where(and(eq(oportunidades.empresaId, contexto.empresaId), isNull(oportunidades.responsavelId)));
    return { gravado: typeof linha?.valor === 'string' ? linha.valor : null, semResponsavel: cards.length };
  });
  return { responsavelId: responsaveis.some((r) => r.id === gravado) ? gravado : null, responsaveis, semResponsavel };
}

/** Escolhe (ou, com `null`, limpa) o responsável padrão. Só aceita membro ativo da empresa. */
export async function definirResponsavelPadrao(db: NodePgDatabase, contexto: ContextoTenant, responsavelId: string | null): Promise<{ ok: true } | { ok: false; codigo: 'RESPONSAVEL_INVALIDO' }> {
  if (responsavelId !== null) {
    const ativos = await listarResponsaveisAtivos(db, contexto);
    if (!ativos.some((r) => r.id === responsavelId)) return { ok: false, codigo: 'RESPONSAVEL_INVALIDO' };
  }
  await comTenant(db, contexto, async (tx) => {
    if (responsavelId === null) {
      await tx
        .delete(empresaConfiguracoes)
        .where(and(eq(empresaConfiguracoes.empresaId, contexto.empresaId), eq(empresaConfiguracoes.chave, CHAVE_RESPONSAVEL_PADRAO)));
      return;
    }
    await tx
      .insert(empresaConfiguracoes)
      .values({ empresaId: contexto.empresaId, chave: CHAVE_RESPONSAVEL_PADRAO, valor: responsavelId })
      .onConflictDoUpdate({ target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave], set: { valor: responsavelId, atualizadoEm: new Date() } });
  });
  return { ok: true };
}

/** Leva o responsável padrão aos cards que estão sem responsável. Sem padrão escolhido, não faz nada. */
export async function aplicarResponsavelPadrao(db: NodePgDatabase, contexto: ContextoTenant): Promise<{ ok: true; aplicados: number; falhas: number } | { ok: false; codigo: 'SEM_RESPONSAVEL_PADRAO' }> {
  const estado = await lerResponsavelPadrao(db, contexto);
  if (!estado.responsavelId) return { ok: false, codigo: 'SEM_RESPONSAVEL_PADRAO' };
  const ids = await comTenant(db, contexto, (tx) =>
    tx
      .select({ id: oportunidades.id })
      .from(oportunidades)
      .where(and(eq(oportunidades.empresaId, contexto.empresaId), isNull(oportunidades.responsavelId)))
      .orderBy(asc(oportunidades.criadoEm))
  );
  if (ids.length === 0) return { ok: true, aplicados: 0, falhas: 0 };
  const lote = await reatribuirEmLote(db, contexto, ids.map((c) => c.id), estado.responsavelId);
  return { ok: true, aplicados: lote.aplicados, falhas: lote.falhas };
}
