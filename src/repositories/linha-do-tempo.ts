// T-157 (fase4-pipeline-telas, US-109): repositório da "Linha de Tempo de
// Atividades" do detalhe do card (AC-408) — lê `oportunidade_eventos`
// (mesma tabela de anotacoes.ts/pipeline-lista.ts), do mais novo ao mais
// antigo, traduzindo cada `tipo` de evento (transicao_etapa, anotacao,
// cadencia_iniciada, atividade_concluida, cadencia_esgotada,
// cadencia_dia_avancado, conexao_whatsapp — os únicos gravados pelas
// funções SQL e por `registrarAnotacao`, T-156) num texto legível. Mesmo
// padrão `comTenant` (T-040): a oportunidade de outro tenant é tratada pela
// rota (404, fail-closed) antes de chamar este repositório.
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { oportunidadeEventos, pipelineEtapas, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const POR_PAGINA = 20;

export interface FiltroLinhaDoTempo {
  /** Tipo bruto do evento (`transicao_etapa`, `anotacao`, …); ausente ou vazio = "Todos". */
  tipo?: string;
  pagina?: number;
}

export interface ItemLinhaDoTempo {
  id: string;
  tipo: string;
  texto: string;
  autorNome: string;
  ocorridoEm: Date;
}

export interface PaginaLinhaDoTempo {
  itens: ItemLinhaDoTempo[];
  totalInteracoes: number;
  pagina: number;
  porPagina: number;
}

function normalizarPagina(valor: number | undefined): number {
  if (!Number.isInteger(valor) || (valor as number) < 1) return 1;
  return valor as number;
}

/** Traduz o `tipo` + `payload` do evento num texto legível para a linha do tempo. */
function textoDoEvento(
  tipo: string,
  payload: unknown,
  etapaOrigemNome: string | null,
  etapaDestinoNome: string | null
): string {
  const dados = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  switch (tipo) {
    case 'anotacao':
      return typeof dados.texto === 'string' ? dados.texto : '';
    case 'transicao_etapa':
      return etapaOrigemNome
        ? `Mudou da etapa "${etapaOrigemNome}" para "${etapaDestinoNome}"`
        : `Entrou na etapa "${etapaDestinoNome}"`;
    case 'cadencia_iniciada':
      return 'Cadência de 18 toques iniciada';
    case 'atividade_concluida':
      return typeof dados.resultado === 'string'
        ? `Toque de cadência concluído (${dados.resultado})`
        : 'Toque de cadência concluído';
    case 'cadencia_esgotada':
      return 'Cadência esgotada sem resposta';
    case 'cadencia_dia_avancado':
      return 'Dia da cadência avançado';
    case 'conexao_whatsapp':
      return 'Mensagem recebida via WhatsApp';
    case 'reatribuicao': {
      // T-177 (AC-452): de/para gravados com o nome da época, para o histórico não mudar se alguém for renomeado.
      const para = typeof dados.paraNome === 'string' ? dados.paraNome : 'outra pessoa';
      return typeof dados.deNome === 'string'
        ? `Responsável alterado: de "${dados.deNome}" para "${para}"`
        : `Responsável definido: "${para}"`;
    }
    default:
      return tipo;
  }
}

function nomeDoAutor(atorTipo: string, autorNome: string | null): string {
  if (atorTipo === 'sistema') return 'Sistema';
  if (atorTipo === 'migracao') return 'Migração';
  return autorNome ?? 'Usuário removido';
}

/**
 * AC-408: lista os eventos do card do mais novo ao mais antigo, com tipo,
 * texto, autor e data, mais a contagem total de interações (independente
 * do filtro de tipo, como no protótipo).
 */
export async function listarLinhaDoTempo(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  filtro: FiltroLinhaDoTempo = {}
): Promise<PaginaLinhaDoTempo> {
  const pagina = normalizarPagina(filtro.pagina);
  const porPagina = POR_PAGINA;

  return comTenant(db, contexto, async (tx) => {
    const etapaOrigem = alias(pipelineEtapas, 'etapa_origem_linha_do_tempo');
    const etapaDestino = alias(pipelineEtapas, 'etapa_destino_linha_do_tempo');

    const condicaoBase: SQL = eq(oportunidadeEventos.oportunidadeId, oportunidadeId);
    const condicao = filtro.tipo ? and(condicaoBase, eq(oportunidadeEventos.tipo, filtro.tipo)) : condicaoBase;

    const [{ total: totalInteracoes }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(oportunidadeEventos)
      .where(condicaoBase);

    const linhas = await tx
      .select({
        id: oportunidadeEventos.id,
        tipo: oportunidadeEventos.tipo,
        payload: oportunidadeEventos.payload,
        atorTipo: oportunidadeEventos.atorTipo,
        autorNome: usuarios.nome,
        ocorridoEm: oportunidadeEventos.ocorridoEm,
        etapaOrigemNome: etapaOrigem.nome,
        etapaDestinoNome: etapaDestino.nome,
      })
      .from(oportunidadeEventos)
      .leftJoin(usuarios, eq(usuarios.id, oportunidadeEventos.atorId))
      .leftJoin(etapaOrigem, eq(etapaOrigem.id, oportunidadeEventos.etapaOrigemId))
      .leftJoin(etapaDestino, eq(etapaDestino.id, oportunidadeEventos.etapaDestinoId))
      .where(condicao)
      .orderBy(desc(oportunidadeEventos.ocorridoEm))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina);

    const itens: ItemLinhaDoTempo[] = linhas.map((linha) => ({
      id: linha.id,
      tipo: linha.tipo,
      texto: textoDoEvento(linha.tipo, linha.payload, linha.etapaOrigemNome ?? null, linha.etapaDestinoNome ?? null),
      autorNome: nomeDoAutor(linha.atorTipo, linha.autorNome ?? null),
      ocorridoEm: linha.ocorridoEm,
    }));

    return { itens, totalInteracoes: Number(totalInteracoes), pagina, porPagina };
  });
}
