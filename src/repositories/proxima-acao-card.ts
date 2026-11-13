// Próxima ação dos cards: junta o que o CRM já sabe (reunião, toque da cadência, data combinada) e deixa a regra
// em `domain/pipeline/proxima-acao.ts`. Trabalha em lote (uma consulta por tipo de dado, não uma por card) para servir
// o funil inteiro; o detalhe de um card usa o mesmo caminho com uma lista de um item.
// Só consulta o que a etapa precisa: reunião nas etapas 8/9, cadência nas etapas 1 a 7.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { cadenciaAtividades, reunioes } from '../db/schema';
import { blocoDe, type Dia, type ToqueDaMatriz } from '../domain/cadencia/matriz';
import {
  calcularProximaAcao,
  ETAPA_NO_SHOW,
  ETAPA_REUNIAO_AGENDADA,
  type ProximaAcao,
  type ReuniaoParaProximaAcao,
  type ToqueParaProximaAcao,
} from '../domain/pipeline/proxima-acao';
import type { ContextoTenant } from '../lib/auth/tenant';
import { aguardandoVigente } from './cadencia';
import { comTenant } from './contexto';
import type { Oportunidade } from './oportunidades';

const ETAPA_MAXIMA_DE_CADENCIA = 7;

/** A posição de cada toque (dia, turno, tipo) vem sempre da matriz fixa, como na aba Cadência. */
const MATRIZ: ReadonlyMap<number, ToqueDaMatriz> = new Map(
  ([1, 2, 3] as Dia[]).flatMap((dia) => (['manha', 'tarde'] as const).flatMap((turno) => blocoDe(dia, turno))).map((toque) => [toque.sequencia, toque])
);

type CardParaProximaAcao = Pick<Oportunidade, 'id' | 'etapaId' | 'proximaAcaoEm' | 'cadenciaEncerradaEm'>;

async function reunioesMaisRecentes(db: NodePgDatabase, contexto: ContextoTenant, ids: string[]): Promise<Map<string, ReuniaoParaProximaAcao>> {
  const mapa = new Map<string, ReuniaoParaProximaAcao>();
  if (ids.length === 0) return mapa;
  const linhas = await comTenant(db, contexto, (tx) =>
    tx
      .select({ oportunidadeId: reunioes.oportunidadeId, agendadaPara: reunioes.agendadaPara, meetUrl: reunioes.meetUrl, encerradaEm: reunioes.encerradaEm, noShow: reunioes.noShow })
      .from(reunioes)
      .where(and(inArray(reunioes.oportunidadeId, ids), eq(reunioes.empresaId, contexto.empresaId)))
      .orderBy(desc(reunioes.agendadaPara))
  );
  // Ordenado da mais nova para a mais antiga: a primeira de cada card é a que vale.
  for (const linha of linhas) if (!mapa.has(linha.oportunidadeId)) mapa.set(linha.oportunidadeId, linha);
  return mapa;
}

async function toquesDaVez(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  cards: CardParaProximaAcao[],
  agora: Date
): Promise<{ iniciadas: Set<string>; daVez: Map<string, ToqueParaProximaAcao> }> {
  const iniciadas = new Set<string>();
  const daVez = new Map<string, ToqueParaProximaAcao>();
  if (cards.length === 0) return { iniciadas, daVez };

  const linhas = await comTenant(db, contexto, (tx) =>
    tx
      .select({
        oportunidadeId: cadenciaAtividades.oportunidadeId,
        sequencia: cadenciaAtividades.sequencia,
        resultado: cadenciaAtividades.resultado,
        // `liberada_em` não está no schema do Drizzle (só as consultas cruas a leem), como em cadencia-card.ts.
        liberadaEm: sql<string | Date | null>`"cadencia_atividades"."liberada_em"`,
        aguardandoAte: cadenciaAtividades.aguardandoAte,
      })
      .from(cadenciaAtividades)
      .where(and(inArray(cadenciaAtividades.oportunidadeId, cards.map((c) => c.id)), eq(cadenciaAtividades.empresaId, contexto.empresaId)))
      .orderBy(asc(cadenciaAtividades.sequencia))
  );

  const encerrada = new Set(cards.filter((c) => c.cadenciaEncerradaEm !== null).map((c) => c.id));
  for (const linha of linhas) {
    iniciadas.add(linha.oportunidadeId);
    // O toque da vez é o menor pendente (as linhas chegam por sequência); cadência encerrada não tem toque da vez.
    if (linha.resultado !== 'pendente' || daVez.has(linha.oportunidadeId) || encerrada.has(linha.oportunidadeId)) continue;
    const posicao = MATRIZ.get(linha.sequencia);
    if (!posicao) continue;
    const aguardando = aguardandoVigente({ aguardandoAte: linha.aguardandoAte, resultado: linha.resultado }, agora);
    daVez.set(linha.oportunidadeId, {
      dia: posicao.dia,
      turno: posicao.turno,
      tipo: posicao.tipo,
      liberadaEm: linha.liberadaEm ? new Date(linha.liberadaEm) : null,
      aguardandoAte: aguardando ? new Date(aguardando) : null,
    });
  }
  return { iniciadas, daVez };
}

/** A próxima ação de cada card da lista, por id. Cards de uma mesma empresa (o `contexto` filtra tudo por tenant). */
export async function obterProximasAcoesDosCards(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  cards: CardParaProximaAcao[],
  agora: Date
): Promise<Map<string, ProximaAcao>> {
  const comReuniao = cards.filter((c) => c.etapaId === ETAPA_REUNIAO_AGENDADA || c.etapaId === ETAPA_NO_SHOW);
  const comCadencia = cards.filter((c) => c.etapaId <= ETAPA_MAXIMA_DE_CADENCIA);

  const [reuniaoDe, cadencia] = await Promise.all([
    reunioesMaisRecentes(db, contexto, comReuniao.map((c) => c.id)),
    toquesDaVez(db, contexto, comCadencia, agora),
  ]);

  return new Map(
    cards.map((card) => [
      card.id,
      calcularProximaAcao({
        etapaId: card.etapaId,
        agora,
        proximaAcaoEm: card.proximaAcaoEm ? new Date(card.proximaAcaoEm) : null,
        reuniao: reuniaoDe.get(card.id) ?? null,
        toqueDaVez: cadencia.daVez.get(card.id) ?? null,
        cadenciaIniciada: cadencia.iniciadas.has(card.id),
      }),
    ])
  );
}

export async function obterProximaAcaoDoCard(db: NodePgDatabase, contexto: ContextoTenant, oportunidade: Oportunidade, agora: Date): Promise<ProximaAcao> {
  const mapa = await obterProximasAcoesDosCards(db, contexto, [oportunidade], agora);
  return mapa.get(oportunidade.id) as ProximaAcao;
}
