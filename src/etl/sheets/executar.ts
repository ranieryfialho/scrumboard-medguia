// T-120 (fase3-etl-sheets, US-081): orquestrador do ETL do Sheets — junta
// T-114 a T-119 (leitura por aba, dedupe entre abas, status→etapa, import de
// lead+card, agenda e vínculo de mensagens) numa única transação, pelo mesmo
// contrato de `comum.ts` usado por `fase3-etl-supabase` (T-108).
//
// AC-289: cada etapa já é idempotente por conta própria (`migracao_registros`
// em T-118, `lead_id is null` em T-119) — rodar tudo de novo sobre as mesmas
// planilhas apenas soma `ignoradas`.
// AC-290: em simulação, `executarEtl` roda a função inteira e desfaz a
// transação ao final (nenhuma escrita sobrevive) — o relatório sai igual ao
// de uma execução real.
// AC-292: o relatório por aba confere `linhasLidas = criadas + fundidas +
// ignoradas + emRevisao`. `fundidas` conta as ocorrências do mesmo lead
// (ASM-090) que perderam a deduplicação entre abas (T-116) para outra aba —
// a ocorrência vencedora é que de fato vira lead/card ou vai para revisão.
// `ignoradas` soma o que a leitura já descartou (lead de teste/linha em
// branco, T-114) com o que já tinha sido migrado numa execução anterior.
//
// T-125 (fase3-etl-decisoes, US-087): `linhasDecisao` (lidas de volta pelo
// script via `lerCsvDecisoes`, T-124) é casada por `metaId` com os leads que
// esta execução colocaria em revisão, e validada aqui com a tabela `etapas`
// e os motivos de perda ativos do banco (nunca fixos no código — AC-312 a
// AC-314) e o instante `agora` da execução (AC-313). Uma linha de decisão
// para um `metaId` fora da fila é listada em `decisoesForaDaFila` e não cria
// nada (AC-314). A fila de revisão desta execução (já líquida das decisões
// aplicadas) sai em `csvFilaRevisao` (AC-307), no mesmo formato que a
// operação devolve em `--decisoes`.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buscarIdDestino, executarEtl, type ContextoExecucao, type TransacaoEtl } from '../comum';
import {
  gerarCsvFilaRevisao,
  linhasDecisaoForaDaFila,
  validarDecisao,
  type EtapaValidacao,
  type ItemFilaRevisao,
  type LinhaDecisaoBruta,
  type MotivoPerdaValidacao,
  type ResultadoValidacao,
} from '../decisoes';
import { motivosPerda, pipelineEtapas } from '../../db/schema';
import { lerAba, type ChaveAbaConhecida, type LeadBruto } from './leitor';
import { deduplicarLeads, type ConflitoDedupe, type LeadComOrigem, type OrigemLead } from './dedupe';
import { mapearStatusParaEtapa } from './status';
import { importarLeadsSheets, type ItemRevisaoLead, type LeadParaImportar } from './leads';
import {
  gerarCsvAgenda,
  lerAgenda,
  vincularMensagensPorTelefone,
  type ResultadoVinculoMensagens,
} from './agenda-mensagens';

/** Uma aba a ler, identificada pela mesma chave `planilha/aba` de `leitor.ts`. */
export interface AbaParaLer {
  chave: ChaveAbaConhecida;
  linhas: string[][];
}

export interface LinhaRelatorioAba {
  aba: string;
  linhasLidas: number;
  criadas: number;
  /** Ocorrências deste lead nesta aba que perderam a deduplicação para outra aba (AC-275/AC-292). */
  fundidas: number;
  ignoradas: number;
  emRevisao: number;
}

/** Conta das decisões aplicadas nesta execução (AC-317). */
export interface ContagemDecisoes {
  aplicadas: number;
  ignoradas: number;
  recusadas: number;
}

export interface RelatorioEtlSheets {
  simulacao: boolean;
  linhas: LinhaRelatorioAba[];
  /** Conflitos de status resolvidos na deduplicação (AC-276), reportados mesmo já decididos. */
  conflitos: ConflitoDedupe[];
  /** Fila de revisão manual desta execução, já líquida das decisões aplicadas (AC-282, AC-283). */
  revisao: ItemRevisaoLead[];
  /** Planilha da fila de revisão (AC-307), no mesmo formato que `--decisoes` espera de volta. */
  csvFilaRevisao: string;
  /** Decisões aplicadas/ignoradas/recusadas nesta execução (AC-317). */
  decisoes: ContagemDecisoes;
  /** Linhas da planilha de decisões para um `metaId` que não está na fila (AC-314) — nada foi criado para elas. */
  decisoesForaDaFila: LinhaDecisaoBruta[];
  /** CSV da aba `Agenda` (AC-286) — nada daqui é gravado no banco. */
  csvAgenda: string;
  vinculoMensagens: ResultadoVinculoMensagens;
}

/** O relatório não fechou a conta (`linhasLidas != criadas + fundidas + ignoradas + emRevisao`) para uma aba (AC-292). */
export class ErroRelatorioInconsistente extends Error {
  constructor(linha: LinhaRelatorioAba) {
    super(
      `Relatório não confere para a aba "${linha.aba}": linhasLidas=${linha.linhasLidas}, ` +
        `criadas=${linha.criadas}, fundidas=${linha.fundidas}, ignoradas=${linha.ignoradas}, ` +
        `emRevisao=${linha.emRevisao}.`
    );
    this.name = 'ErroRelatorioInconsistente';
  }
}

/**
 * AC-723: lead sem id da Meta (ex.: adicionado à mão no painel do legado) recebe um id calculado dos próprios dados. Sem
 * isso todos compartilham a chave vazia: a fila de revisão e as decisões não os enxergam e o controle de "já migrado"
 * só deixa o primeiro entrar. O mesmo lead dá sempre o mesmo id; linhas idênticas viram um lead só (a deduplicação os junta).
 */
export function metaIdSintetico(origem: OrigemLead, lead: LeadBruto): string {
  const base = [origem.planilha, origem.aba, lead.nome, lead.telefone, lead.email, lead.camposExtras['created_time'] ?? '']
    .map((valor) => valor.trim().toLowerCase())
    .join('|');
  return `s:${createHash('sha256').update(base).digest('hex').slice(0, 20)}`;
}

function origemDaChave(chave: ChaveAbaConhecida): OrigemLead {
  const [planilha, aba] = chave.split('/');
  return { planilha, aba };
}

function chaveDaOrigem(origem: OrigemLead): string {
  return `${origem.planilha}/${origem.aba}`;
}

function origensIguais(a: OrigemLead, b: OrigemLead): boolean {
  return a.planilha === b.planilha && a.aba === b.aba;
}

interface ContadorAba {
  linhasLidas: number;
  criadas: number;
  fundidas: number;
  ignoradas: number;
  emRevisao: number;
}

async function buscarEtapasValidacao(tx: TransacaoEtl): Promise<EtapaValidacao[]> {
  return tx
    .select({
      id: pipelineEtapas.id,
      nome: pipelineEtapas.nome,
      exigeValor: pipelineEtapas.exigeValor,
      exigeMotivo: pipelineEtapas.exigeMotivo,
      exigeProximaAcao: pipelineEtapas.exigeProximaAcao,
    })
    .from(pipelineEtapas);
}

async function buscarMotivosPerdaValidacao(tx: TransacaoEtl): Promise<MotivoPerdaValidacao[]> {
  return tx
    .select({ id: motivosPerda.id, nome: motivosPerda.nome })
    .from(motivosPerda)
    .where(eq(motivosPerda.ativo, true));
}

/** Decide, para o relatório por aba, em qual contagem a ocorrência entra — antes de decisões, depois delas (AC-317). */
function categoriaDaOcorrencia(
  decisaoStatus: LeadParaImportar['decisao'],
  jaMigrado: boolean,
  decisaoValidada: ResultadoValidacao | undefined
): 'criadas' | 'ignoradas' | 'emRevisao' {
  if (jaMigrado) return 'ignoradas';
  if (decisaoValidada) {
    if (decisaoValidada.tipo === 'ignorar') return 'ignoradas';
    if (decisaoValidada.tipo === 'etapa') return 'criadas';
    return 'emRevisao';
  }
  return decisaoStatus.tipo === 'revisao' ? 'emRevisao' : 'criadas';
}

async function rodarEtapas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  abas: AbaParaLer[],
  agendaLinhas: string[][],
  linhasDecisao: LinhaDecisaoBruta[],
  agora: Date
): Promise<RelatorioEtlSheets> {
  const leituras = abas.map((aba) => ({
    origem: origemDaChave(aba.chave),
    resultado: lerAba(aba.chave, aba.linhas),
  }));

  const contadores = new Map<string, ContadorAba>();
  for (const { origem, resultado } of leituras) {
    contadores.set(chaveDaOrigem(origem), {
      linhasLidas: resultado.linhasLidas,
      criadas: 0,
      fundidas: 0,
      ignoradas: resultado.ignoradas.length,
      emRevisao: 0,
    });
  }

  const entradas: LeadComOrigem[] = [];
  for (const { origem, resultado } of leituras) {
    for (const lead of resultado.leads) {
      entradas.push({ origem, lead: lead.metaId.trim() ? lead : { ...lead, metaId: metaIdSintetico(origem, lead) } });
    }
  }

  const { leads: deduplicados, conflitos } = deduplicarLeads(entradas);

  // Entre as ocorrências do mesmo lead (AC-275), só a vencedora conta como
  // criada/em revisão nesta aba — as demais perderam a deduplicação e
  // contam como "fundidas" na aba de onde vieram (AC-292).
  for (const deduplicado of deduplicados) {
    let vencedoraEncontrada = false;
    for (const origemOcorrencia of deduplicado.origens) {
      if (!vencedoraEncontrada && origensIguais(origemOcorrencia, deduplicado.origem)) {
        vencedoraEncontrada = true;
        continue;
      }
      contadores.get(chaveDaOrigem(origemOcorrencia))!.fundidas += 1;
    }
  }

  const entradasParaImportar: LeadParaImportar[] = deduplicados.map((deduplicado) => {
    const decisao = mapearStatusParaEtapa(deduplicado.lead.situacaoBruta, {
      dataFechamento: deduplicado.lead.camposExtras['data_fechamento'],
      dataProximaAcao: deduplicado.lead.camposExtras['data_proxima_acao'],
    });
    return { lead: deduplicado.lead, origem: deduplicado.origem, decisao };
  });

  // Fila desta execução (AC-307): leads que, sem decisão, cairiam em revisão
  // — é contra esta fila que a planilha de decisões é casada (AC-309) e
  // reportada (AC-314, linhas para um id fora da fila).
  const idsNaFila = new Set(
    entradasParaImportar.filter((entrada) => entrada.decisao.tipo === 'revisao').map((entrada) => entrada.lead.metaId)
  );
  const decisoesForaDaFila = linhasDecisaoForaDaFila(idsNaFila, linhasDecisao);

  const etapasValidacao = await buscarEtapasValidacao(tx);
  const motivosPerdaValidacao = await buscarMotivosPerdaValidacao(tx);
  const decisoesValidadas = new Map<string, ResultadoValidacao>();
  for (const linha of linhasDecisao) {
    if (!idsNaFila.has(linha.idOrigem)) continue;
    decisoesValidadas.set(
      linha.idOrigem,
      validarDecisao(linha, { etapas: etapasValidacao, motivosPerda: motivosPerdaValidacao, agora })
    );
  }

  for (const entrada of entradasParaImportar) {
    const contador = contadores.get(chaveDaOrigem(entrada.origem))!;
    const jaMigrado = await buscarIdDestino(tx, contexto.origem, entrada.lead.metaId);
    const decisaoValidada = decisoesValidadas.get(entrada.lead.metaId);
    contador[categoriaDaOcorrencia(entrada.decisao, Boolean(jaMigrado), decisaoValidada)] += 1;
  }

  const resultadoImportacao = await importarLeadsSheets(
    tx,
    contexto,
    empresaId,
    entradasParaImportar,
    decisoesValidadas
  );

  const linhas: LinhaRelatorioAba[] = Array.from(contadores.entries()).map(([aba, contador]) => {
    const linha: LinhaRelatorioAba = { aba, ...contador };
    if (linha.linhasLidas !== linha.criadas + linha.fundidas + linha.ignoradas + linha.emRevisao) {
      throw new ErroRelatorioInconsistente(linha);
    }
    return linha;
  });

  const csvAgenda = gerarCsvAgenda(lerAgenda(agendaLinhas));
  const vinculoMensagens = await vincularMensagensPorTelefone(tx, empresaId);

  const itensFilaRevisao: ItemFilaRevisao[] = resultadoImportacao.revisao.map((item) => ({
    idOrigem: item.metaId,
    nome: item.nome,
    telefone: item.telefone,
    email: item.email,
    statusOriginal: item.statusOriginal,
    motivoRevisao: item.motivo,
  }));

  return {
    simulacao: contexto.simulacao,
    linhas,
    conflitos,
    revisao: resultadoImportacao.revisao,
    csvFilaRevisao: gerarCsvFilaRevisao(itensFilaRevisao),
    decisoes: {
      aplicadas: resultadoImportacao.decisoesAplicadas,
      ignoradas: resultadoImportacao.decisoesIgnoradas,
      recusadas: resultadoImportacao.decisoesRecusadas,
    },
    decisoesForaDaFila,
    csvAgenda,
    vinculoMensagens,
  };
}

/**
 * Roda o ETL completo do Sheets (US-081): lê as abas já baixadas, deduplica
 * entre elas, traduz status, importa lead+card e vincula mensagens — tudo
 * numa única transação (AC-270, via `executarEtl`) que é desfeita ao final
 * em modo simulação (AC-290). Nenhuma chamada daqui escreve na planilha
 * (AC-291 é responsabilidade de `leitor.ts`/`agenda-mensagens.ts`, que só
 * expõem leitura).
 *
 * `linhasDecisao` (T-125, já lidas de volta pelo script via `lerCsvDecisoes`)
 * resolve os leads que esta execução colocaria em revisão (AC-309 a AC-311);
 * `agora` é o instante da execução, usado para recusar próxima ação vencida
 * (AC-313) — passável nos testes para não depender do relógio real.
 */
export async function executarMigracaoSheets(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  empresaId: string,
  abas: AbaParaLer[],
  agendaLinhas: string[][],
  linhasDecisao: LinhaDecisaoBruta[] = [],
  agora: Date = new Date()
): Promise<RelatorioEtlSheets> {
  return executarEtl(db, contexto, (tx, ctx) =>
    rodarEtapas(tx, ctx, empresaId, abas, agendaLinhas, linhasDecisao, agora)
  );
}
