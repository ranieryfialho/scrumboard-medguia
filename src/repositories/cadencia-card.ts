// T-170 (fase4-card-abas, US-113, AC-430/AC-431): a cadência de UM card — os 18
// toques da matriz (domain/cadencia/matriz.ts) mesclados com o que já existe
// em `cadencia_atividades`. O banco só gera o bloco seguinte quando o anterior
// é concluído (AC-190), então os toques futuros não têm linha: aqui eles vêm
// da matriz, como "programado". A regra de "atrasado" é a da fila do turno
// (`inicioDoTurnoDeReferencia`, cadencia.ts) — nunca uma cópia dela.
import { asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { cadenciaAtividades, usuarios } from '../db/schema';
import { blocoDe, type Dia } from '../domain/cadencia/matriz';
import type { ContextoTenant } from '../lib/auth/tenant';
import { inicioDoTurnoDeReferencia } from './cadencia';
import { comTenant } from './contexto';
import { buscarOportunidadePorId } from './oportunidades';

export const TOTAL_DE_TOQUES = 18;

export type EstadoToque = 'concluido' | 'cancelado' | 'da_vez' | 'programado';
export type SituacaoRegua = 'nao_iniciada' | 'em_andamento' | 'atrasada' | 'encerrada';

export interface ToqueDoCard {
  sequencia: number;
  dia: Dia;
  turno: 'manha' | 'tarde';
  canal: 'telefone' | 'whatsapp';
  tipo: 'ligacao' | 'mensagem' | 'breakup';
  estado: EstadoToque;
  /** `null` enquanto o toque ainda não foi gerado pelo banco. */
  atividadeId: string | null;
  resultado: 'pendente' | 'sem_resposta' | 'conectou' | 'cancelada' | null;
  realizadaEm: Date | null;
  realizadaPor: { id: string; nome: string } | null;
  observacao: string | null;
  /** Pendente liberado antes do turno de referência (mesma regra da fila de atrasados). */
  atrasado: boolean;
}

export interface CadenciaDoCard {
  oportunidade: { id: string; etapaId: number; version: number };
  iniciada: boolean;
  encerrada: boolean;
  situacao: SituacaoRegua;
  total: number;
  concluidos: number;
  conectou: number;
  semResposta: number;
  toqueDaVez: ToqueDoCard | null;
  toques: ToqueDoCard[];
}

const BLOCOS: ReadonlyArray<{ dia: Dia; turno: 'manha' | 'tarde' }> = [
  { dia: 1, turno: 'manha' },
  { dia: 1, turno: 'tarde' },
  { dia: 2, turno: 'manha' },
  { dia: 2, turno: 'tarde' },
  { dia: 3, turno: 'manha' },
  { dia: 3, turno: 'tarde' },
];

/** `null` se o card não existe ou é de outra empresa (fail-closed, AC-069). */
export async function obterCadenciaDoCard(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  agora: Date
): Promise<CadenciaDoCard | null> {
  const oportunidade = await buscarOportunidadePorId(db, contexto, oportunidadeId);
  if (!oportunidade) return null;

  const corte = inicioDoTurnoDeReferencia(agora);

  const linhas = await comTenant(db, contexto, (tx) =>
    tx
      .select({
        atividade: cadenciaAtividades,
        liberadaEm: sql<string | null>`"cadencia_atividades"."liberada_em"`,
        realizadaPorNome: usuarios.nome,
      })
      .from(cadenciaAtividades)
      .leftJoin(usuarios, eq(cadenciaAtividades.realizadaPor, usuarios.id))
      .where(eq(cadenciaAtividades.oportunidadeId, oportunidadeId))
      .orderBy(asc(cadenciaAtividades.sequencia))
  );

  const porSequencia = new Map(linhas.map((linha) => [linha.atividade.sequencia, linha]));
  const menorPendente = linhas
    .filter((linha) => linha.atividade.resultado === 'pendente')
    .map((linha) => linha.atividade.sequencia)
    .sort((a, b) => a - b)[0];

  const toques: ToqueDoCard[] = BLOCOS.flatMap(({ dia, turno }) => blocoDe(dia, turno)).map((previsto) => {
    const linha = porSequencia.get(previsto.sequencia);
    if (!linha) {
      return {
        sequencia: previsto.sequencia,
        dia: previsto.dia,
        turno: previsto.turno,
        canal: previsto.canal,
        tipo: previsto.tipo,
        estado: 'programado' as const,
        atividadeId: null,
        resultado: null,
        realizadaEm: null,
        realizadaPor: null,
        observacao: null,
        atrasado: false,
      };
    }

    const { atividade } = linha;
    const estado: EstadoToque =
      atividade.resultado === 'conectou' || atividade.resultado === 'sem_resposta'
        ? 'concluido'
        : atividade.resultado === 'cancelada'
          ? 'cancelado'
          : atividade.sequencia === menorPendente
            ? 'da_vez'
            : 'programado';

    return {
      sequencia: atividade.sequencia,
      dia: atividade.dia as Dia,
      turno: atividade.turno,
      canal: atividade.canal,
      tipo: atividade.tipo,
      estado,
      atividadeId: atividade.id,
      resultado: atividade.resultado,
      realizadaEm: atividade.realizadaEm,
      realizadaPor:
        atividade.realizadaPor && linha.realizadaPorNome
          ? { id: atividade.realizadaPor, nome: linha.realizadaPorNome }
          : null,
      observacao: atividade.observacao,
      atrasado:
        atividade.resultado === 'pendente' && linha.liberadaEm !== null && new Date(linha.liberadaEm).getTime() < corte.getTime(),
    };
  });

  const iniciada = linhas.length > 0;
  const encerrada = oportunidade.cadenciaEncerradaEm !== null;
  const conectou = toques.filter((t) => t.resultado === 'conectou').length;
  const semResposta = toques.filter((t) => t.resultado === 'sem_resposta').length;
  const situacao: SituacaoRegua = !iniciada
    ? 'nao_iniciada'
    : encerrada
      ? 'encerrada'
      : toques.some((t) => t.atrasado)
        ? 'atrasada'
        : 'em_andamento';

  return {
    oportunidade: { id: oportunidade.id, etapaId: oportunidade.etapaId, version: oportunidade.version },
    iniciada,
    encerrada,
    situacao,
    total: TOTAL_DE_TOQUES,
    concluidos: conectou + semResposta,
    conectou,
    semResposta,
    toqueDaVez: encerrada ? null : (toques.find((t) => t.estado === 'da_vez') ?? null),
    toques,
  };
}
