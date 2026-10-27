// T-177 (fase4-pipeline-lote, US-116, AC-450 a AC-452): reatribuir o comercial de
// vários cards. Cada card é atualizado SOZINHO (numa transação própria) e a
// mudança vira um evento `reatribuicao` no histórico dele (ASM-153: `tipo` é
// texto livre, sem migration), com de/para por id e por nome (o nome fica
// gravado como era na hora, para a linha do tempo não mudar se alguém for
// renomeado). Só responsável ATIVO da empresa da sessão é aceito.
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresasUsuarios, oportunidadeEventos, oportunidades, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { idsDistintos, resumirLote, type ResultadoDoCard, type ResultadoDoLote } from './lote-oportunidades';

export const TIPO_EVENTO_REATRIBUICAO = 'reatribuicao';

export class ErroResponsavelInvalidoNoLote extends Error {
  constructor() {
    super('RESPONSAVEL_INVALIDO');
    this.name = 'ErroResponsavelInvalidoNoLote';
  }
}

export interface ResponsavelAtivo {
  id: string;
  nome: string;
  papel: 'MASTER' | 'GERENTE' | 'ATENDENTE';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Usuários ATIVOS da empresa da sessão, por nome — a lista do seletor de "Reatribuir Comercial". */
export async function listarResponsaveisAtivos(db: NodePgDatabase, contexto: ContextoTenant): Promise<ResponsavelAtivo[]> {
  return comTenant(db, contexto, (tx) =>
    tx
      .select({ id: usuarios.id, nome: usuarios.nome, papel: empresasUsuarios.papel })
      .from(usuarios)
      .innerJoin(empresasUsuarios, eq(empresasUsuarios.usuarioId, usuarios.id))
      .where(
        and(eq(usuarios.ativo, true), eq(empresasUsuarios.empresaId, contexto.empresaId), eq(empresasUsuarios.ativo, true))
      )
      .orderBy(asc(usuarios.nome))
  );
}

async function buscarResponsavelAtivo(db: NodePgDatabase, contexto: ContextoTenant, id: string) {
  if (!UUID.test(id)) return null;
  const lista = await listarResponsaveisAtivos(db, contexto);
  return lista.find((responsavel) => responsavel.id === id) ?? null;
}

async function reatribuirCard(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  cardId: string,
  novo: ResponsavelAtivo
): Promise<ResultadoDoCard> {
  if (!UUID.test(cardId)) return { id: cardId, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' };

  return comTenant(db, contexto, async (tx) => {
    const [card] = await tx
      .select({ id: oportunidades.id, responsavelId: oportunidades.responsavelId })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, cardId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    if (!card) return { id: cardId, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' };

    // Já está com essa pessoa: nada a gravar (e nenhum evento de ruído).
    if (card.responsavelId === novo.id) return { id: cardId, ok: true };

    let antigoNome: string | null = null;
    if (card.responsavelId) {
      const [antigo] = await tx
        .select({ nome: usuarios.nome })
        .from(usuarios)
        .where(eq(usuarios.id, card.responsavelId))
        .limit(1);
      antigoNome = antigo?.nome ?? null;
    }

    await tx
      .update(oportunidades)
      .set({ responsavelId: novo.id, atualizadoEm: new Date() })
      .where(and(eq(oportunidades.id, cardId), eq(oportunidades.empresaId, contexto.empresaId)));

    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId: cardId,
      tipo: TIPO_EVENTO_REATRIBUICAO,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { de: card.responsavelId, deNome: antigoNome, para: novo.id, paraNome: novo.nome },
    });

    return { id: cardId, ok: true };
  });
}

/** AC-450 a AC-452: reatribui cada card ao responsável; devolve o resultado de cada um. Lança `ErroResponsavelInvalidoNoLote` antes de tocar em qualquer card. */
export async function reatribuirEmLote(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  ids: readonly string[],
  responsavelId: string
): Promise<ResultadoDoLote> {
  const responsavel = await buscarResponsavelAtivo(db, contexto, responsavelId);
  if (!responsavel) throw new ErroResponsavelInvalidoNoLote();

  const resultados: ResultadoDoCard[] = [];
  for (const id of idsDistintos(ids)) {
    resultados.push(await reatribuirCard(db, contexto, id, responsavel));
  }
  return resumirLote(resultados);
}
