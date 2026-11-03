// T-176 (fase4-pipeline-lote, US-115, AC-446 a AC-448): o motor dos lotes. Cada
// card é processado SOZINHO, em sequência, pela mesma `transicionarCard` do card
// avulso — assim a regra (grafo, papel, dados obrigatórios) nunca diverge e uma
// falha num card não desfaz nem trava os outros ("aplica nos que dão e lista os
// que não"). A versão de cada card é lida na hora (ASM-151); se alguém mexer
// nele entre a leitura e a escrita, ele falha com `CONFLITO_DE_VERSAO` e só ele.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContextoTenant } from '../lib/auth/tenant';
import { cardTemToquesDeCadencia, ErroConflitoDeVersao as ErroConflitoDeVersaoDaCadencia, iniciarCadencia } from './cadencia';
import { buscarOportunidadePorId } from './oportunidades';
import { transicionarCard } from './transicao-card';

import { LIMITE_DE_IDS_POR_LOTE } from '../lib/lote-limite';

export { LIMITE_DE_IDS_POR_LOTE };

export interface ResultadoDoCard {
  id: string;
  ok: boolean;
  /** Só quando `ok` é `false`: o código do domínio, `OPORTUNIDADE_NAO_ENCONTRADA` ou `CONFLITO_DE_VERSAO`. */
  codigo?: string;
}

export interface ResultadoDoLote {
  resultados: ResultadoDoCard[];
  /** Quantos deram certo e quantos não (a soma é o total de ids distintos). */
  aplicados: number;
  falhas: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids na ordem em que chegaram, sem repetição. */
export function idsDistintos(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** AC-448: lista de ids válida para um lote (1 a 100 textos); qualquer outra coisa é recusada antes de tocar no banco. */
export function idsDeLoteValidos(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length >= 1 &&
    ids.length <= LIMITE_DE_IDS_POR_LOTE &&
    ids.every((id) => typeof id === 'string' && id.length > 0)
  );
}

function resumir(resultados: ResultadoDoCard[]): ResultadoDoLote {
  const aplicados = resultados.filter((resultado) => resultado.ok).length;
  return { resultados, aplicados, falhas: resultados.length - aplicados };
}

export interface DadosMoverEmLote {
  etapaDestinoId: number;
  /** Para o destino "Perdido" (arquivar em lote, T-177). */
  motivoPerdaId?: string | null;
}

/** AC-446/AC-447: move cada card para a etapa de destino pelas regras de um card; devolve o resultado de cada um. */
export async function moverEmLote(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  ids: readonly string[],
  dados: DadosMoverEmLote
): Promise<ResultadoDoLote> {
  const resultados: ResultadoDoCard[] = [];

  for (const id of idsDistintos(ids)) {
    // `id` que nem é uuid nunca existe — mesmo "não encontrado" de card alheio (AC-448).
    const card = UUID.test(id) ? await buscarOportunidadePorId(db, contexto, id) : null;
    if (!card) {
      resultados.push({ id, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      continue;
    }

    const resultado = await transicionarCard(db, contexto, id, {
      version: card.version,
      etapaDestinoId: dados.etapaDestinoId,
      motivoPerdaId: dados.motivoPerdaId ?? null,
    });
    resultados.push(resultado.ok ? { id, ok: true } : { id, ok: false, codigo: resultado.codigo });
  }

  return resumir(resultados);
}

const ETAPA_ENTRADA_DE_LEADS = 1;

/**
 * AC-759/AC-760: inicia a cadência de cada card, sozinho, como o botão "Iniciar Cadência" do card avulso. Só vale para quem está em
 * "Entrada de leads" (`CADENCIA_SO_EM_ENTRADA`) e ainda sem toques (`CADENCIA_JA_INICIADA`); o resto do lote segue normalmente.
 */
export async function iniciarCadenciaEmLote(db: NodePgDatabase, contexto: ContextoTenant, ids: readonly string[], agora: Date): Promise<ResultadoDoLote> {
  const resultados: ResultadoDoCard[] = [];

  for (const id of idsDistintos(ids)) {
    const card = UUID.test(id) ? await buscarOportunidadePorId(db, contexto, id) : null;
    if (!card) {
      resultados.push({ id, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      continue;
    }
    if (card.etapaId !== ETAPA_ENTRADA_DE_LEADS) {
      resultados.push({ id, ok: false, codigo: 'CADENCIA_SO_EM_ENTRADA' });
      continue;
    }
    if (await cardTemToquesDeCadencia(db, contexto, id)) {
      resultados.push({ id, ok: false, codigo: 'CADENCIA_JA_INICIADA' });
      continue;
    }
    try {
      await iniciarCadencia(db, contexto, id, { version: card.version, atorId: contexto.usuarioId, atorTipo: 'usuario', agora });
      resultados.push({ id, ok: true });
    } catch (erro) {
      if (!(erro instanceof ErroConflitoDeVersaoDaCadencia)) throw erro;
      resultados.push({ id, ok: false, codigo: 'CONFLITO_DE_VERSAO' });
    }
  }

  return resumir(resultados);
}

export { resumir as resumirLote };
