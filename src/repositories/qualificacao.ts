// fase6-qualificacao-comercial (US-198, AC-831): a qualificação do card. Lê e grava a última avaliação (uma linha por oportunidade em
// `oportunidade_qualificacao`); a nota e a faixa são sempre calculadas aqui pelo domínio, nunca vindas do corpo da requisição.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  CHAVES_DOS_CRITERIOS,
  calcularQualificacao,
  RESPOSTAS_VAZIAS,
  type ChaveDoBloqueio,
  type ChaveDoEstagio,
  type EntradaDaQualificacao,
  type FaixaDeQualificacao,
  type RespostasDaQualificacao,
} from '../domain/qualificacao/qualificacao';
import { oportunidadeQualificacao, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export interface QualificacaoDoCard {
  respostas: RespostasDaQualificacao;
  bloqueios: ChaveDoBloqueio[];
  estagio: ChaveDoEstagio | null;
  score: number;
  faixa: FaixaDeQualificacao | null;
  /** Quem avaliou por último e quando; `null` quando o card nunca foi avaliado. */
  avaliadoPor: string | null;
  atualizadoEm: string | null;
}

export const QUALIFICACAO_VAZIA: QualificacaoDoCard = {
  respostas: { ...RESPOSTAS_VAZIAS },
  bloqueios: [],
  estagio: null,
  score: 0,
  faixa: null,
  avaliadoPor: null,
  atualizadoEm: null,
};

type Linha = typeof oportunidadeQualificacao.$inferSelect;

function daLinha(linha: Linha, avaliadoPor: string | null): QualificacaoDoCard {
  const respostas = { ...RESPOSTAS_VAZIAS };
  for (const chave of CHAVES_DOS_CRITERIOS) respostas[chave] = linha[chave];
  return {
    respostas,
    bloqueios: linha.bloqueios as ChaveDoBloqueio[],
    estagio: linha.estagio as ChaveDoEstagio | null,
    score: linha.score,
    faixa: linha.faixa as FaixaDeQualificacao | null,
    avaliadoPor,
    atualizadoEm: linha.atualizadoEm.toISOString(),
  };
}

/** AC-831/AC-832: a última avaliação do card (tudo vazio e faixa `null` quando ninguém avaliou ainda). */
export async function lerQualificacao(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<QualificacaoDoCard> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ q: oportunidadeQualificacao, quem: usuarios.nome })
      .from(oportunidadeQualificacao)
      .leftJoin(usuarios, eq(usuarios.id, oportunidadeQualificacao.atualizadoPor))
      .where(and(eq(oportunidadeQualificacao.oportunidadeId, oportunidadeId), eq(oportunidadeQualificacao.empresaId, contexto.empresaId)))
      .limit(1);
    return linha ? daLinha(linha.q, linha.quem) : { ...QUALIFICACAO_VAZIA };
  });
}

/** AC-831: calcula nota e faixa pelo domínio e grava (substitui a avaliação anterior); devolve o que ficou gravado. */
export async function gravarQualificacao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  entrada: EntradaDaQualificacao
): Promise<QualificacaoDoCard> {
  const { score, faixa } = calcularQualificacao(entrada);
  const valores = {
    empresaId: contexto.empresaId,
    ...entrada.respostas,
    bloqueios: entrada.bloqueios,
    estagio: entrada.estagio,
    score,
    faixa,
    atualizadoEm: sql`now()`,
    atualizadoPor: contexto.usuarioId,
  };
  await comTenant(db, contexto, async (tx) => {
    await tx
      .insert(oportunidadeQualificacao)
      .values({ oportunidadeId, ...valores })
      .onConflictDoUpdate({ target: oportunidadeQualificacao.oportunidadeId, set: valores });
  });
  return lerQualificacao(db, contexto, oportunidadeId);
}

/** AC-834: nota e faixa de vários cards de uma vez (o funil). Card sem avaliação, ou avaliação ainda "não iniciada", fica de fora. */
export async function lerResumosDeQualificacao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeIds: string[]
): Promise<Map<string, { faixa: FaixaDeQualificacao; score: number }>> {
  if (oportunidadeIds.length === 0) return new Map();
  const linhas = await comTenant(db, contexto, async (tx) =>
    tx
      .select({ id: oportunidadeQualificacao.oportunidadeId, faixa: oportunidadeQualificacao.faixa, score: oportunidadeQualificacao.score })
      .from(oportunidadeQualificacao)
      .where(and(eq(oportunidadeQualificacao.empresaId, contexto.empresaId), inArray(oportunidadeQualificacao.oportunidadeId, oportunidadeIds)))
  );
  const mapa = new Map<string, { faixa: FaixaDeQualificacao; score: number }>();
  for (const l of linhas) if (l.faixa) mapa.set(l.id, { faixa: l.faixa as FaixaDeQualificacao, score: l.score });
  return mapa;
}
