// T-321 (fase4-admin, US-137): o registro de auditoria da equipe (migration 0033) — grava quem fez o quê com quem, e lê o registro
// junto das exportações de CSV (`auditoria_exportacoes`, 0014) numa linha do tempo só. Sempre por `comTenant`. Registrar nunca
// derruba a ação principal: a falha de gravação é engolida (a ação já aconteceu e não há como desfazê-la aqui).
import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { auditoriaEquipe, auditoriaExportacoes, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type AcaoDeEquipe = 'convite' | 'reenvio_convite' | 'papel_alterado' | 'desativado' | 'reativado' | 'acessos_alterados';

export async function registrarAuditoriaDaEquipe(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  evento: { acao: AcaoDeEquipe; alvoId: string | null; alvoEmail: string; detalhe?: Record<string, unknown> }
): Promise<void> {
  try {
    await comTenant(db, contexto, async (tx) => {
      await tx.insert(auditoriaEquipe).values({
        empresaId: contexto.empresaId,
        atorId: contexto.usuarioId,
        alvoId: evento.alvoId,
        alvoEmail: evento.alvoEmail,
        acao: evento.acao,
        detalhe: evento.detalhe ?? {},
      });
    });
  } catch {
    // O registro é complementar; ver o comentário do arquivo.
  }
}

export interface EventoDeAuditoria {
  id: string;
  quando: string;
  /** Quem fez (nome); `null` se a pessoa foi removida. */
  ator: string | null;
  acao: AcaoDeEquipe | 'exportacao';
  /** Sobre quem (e-mail) ou, na exportação, de qual tela. */
  alvo: string;
  detalhe: Record<string, unknown>;
}

export const LIMITE_DA_AUDITORIA = 500;

/** Os eventos mais recentes da empresa (equipe + exportações), do mais novo para o mais antigo. */
export async function listarAuditoria(db: NodePgDatabase, contexto: ContextoTenant, limite: number = LIMITE_DA_AUDITORIA): Promise<EventoDeAuditoria[]> {
  return comTenant(db, contexto, async (tx) => {
    const equipe = await tx
      .select({ id: auditoriaEquipe.id, quando: auditoriaEquipe.criadoEm, ator: usuarios.nome, acao: auditoriaEquipe.acao, alvo: auditoriaEquipe.alvoEmail, detalhe: auditoriaEquipe.detalhe })
      .from(auditoriaEquipe)
      .leftJoin(usuarios, eq(usuarios.id, auditoriaEquipe.atorId))
      .where(eq(auditoriaEquipe.empresaId, contexto.empresaId))
      .orderBy(desc(auditoriaEquipe.criadoEm))
      .limit(limite);
    const exportacoes = await tx
      .select({ id: auditoriaExportacoes.id, quando: auditoriaExportacoes.criadoEm, ator: usuarios.nome, tela: auditoriaExportacoes.tela, linhas: auditoriaExportacoes.linhas, filtros: auditoriaExportacoes.filtros })
      .from(auditoriaExportacoes)
      .leftJoin(usuarios, eq(usuarios.id, auditoriaExportacoes.usuarioId))
      .where(eq(auditoriaExportacoes.empresaId, contexto.empresaId))
      .orderBy(desc(auditoriaExportacoes.criadoEm))
      .limit(limite);
    const todos: EventoDeAuditoria[] = [
      ...equipe.map((e) => ({ id: e.id, quando: e.quando.toISOString(), ator: e.ator, acao: e.acao as AcaoDeEquipe, alvo: e.alvo, detalhe: (e.detalhe ?? {}) as Record<string, unknown> })),
      ...exportacoes.map((e) => ({ id: e.id, quando: e.quando.toISOString(), ator: e.ator, acao: 'exportacao' as const, alvo: e.tela, detalhe: { linhas: e.linhas } })),
    ];
    return todos.sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, limite);
  });
}
