// T-113 (fase3-etl-supabase, US-074): orquestrador do ETL — roda as etapas
// de T-109 a T-112 na ordem (empresas → usuários → leads → campanhas/envios
// → mensagens/configurações), todas dentro da MESMA transação aberta por
// `executarEtl` (T-108). Isso é o que entrega AC-267 (cada etapa já é
// idempotente por conta própria — rodar tudo de novo só soma `ignoradas`),
// AC-268 (a mesma transação é desfeita ao final em modo simulação, então
// nenhuma etapa grava nada de verdade) e AC-270 (uma etapa que falha no
// meio derruba a transação inteira — nada das etapas anteriores, dentro
// desta execução, fica gravado).
//
// AC-269: o relatório junta o resultado de cada etapa numa linha por
// entidade (`lidas`, `criadas`, `ignoradas`, `emRevisao`) e `linhaRelatorio`
// confere a conta (`lidas = criadas + ignoradas + emRevisao`) antes de
// aceitar a linha — um erro de contagem em qualquer etapa aparece aqui como
// `ErroRelatorioInconsistente`, não como um número bonito mas errado.
//
// T-126 (fase3-etl-decisoes, US-089): `linhasDecisao` (lidas de volta pelo
// script via `lerCsvDecisoes`, T-124) é casada com os leads que esta
// execução colocaria em revisão (`etapaDireta(lead.situacao) === null`,
// AC-259) e validada aqui com a tabela `etapas` e os motivos de perda ativos
// do banco (nunca fixos no código), e o instante `agora` da execução (regra
// de próxima ação vencida, igual ao Sheets). Uma linha de decisão para um
// `idExterno` fora dessa fila é listada em `decisoesForaDaFila` e não cria
// nada. A fila de revisão desta execução sai em `csvFilaRevisao` (AC-307),
// no mesmo formato que a operação devolve em `--decisoes` (ASM-101).
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { executarEtl, type ContextoExecucao, type TransacaoEtl } from '../comum';
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
import {
  migrarEmpresas,
  migrarUsuarios,
  type EmpresaLegado,
  type UsuarioLegado,
} from './identidade';
import {
  etapaDireta,
  migrarLeads,
  type DecisaoRevisao,
  type ItemRevisao,
  type LeadLegado,
} from './leads';
import { migrarCampanhas, type CampanhaLegado, type EnvioLegado } from './campanhas';
import {
  migrarConfiguracoes,
  migrarMensagens,
  type ConfiguracaoLegado,
  type MensagemLegado,
} from './mensagens-config';

/** Tudo que o orquestrador precisa da origem para rodar as seis etapas. */
export interface DadosOrigemEtl {
  empresas: EmpresaLegado[];
  usuarios: UsuarioLegado[];
  leads: LeadLegado[];
  /** Decisões no formato simples (compatibilidade — só serve etapas sem exigência). */
  decisoesRevisao?: DecisaoRevisao[];
  /** Planilha de decisões comum (T-124), lida de volta pelo script via `lerCsvDecisoes` (AC-315). */
  linhasDecisao?: LinhaDecisaoBruta[];
  campanhas: CampanhaLegado[];
  envios: EnvioLegado[];
  mensagens: MensagemLegado[];
  configuracoes: ConfiguracaoLegado[];
}

export interface LinhaRelatorio {
  entidade: string;
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
}

/** Conta das decisões aplicadas nesta execução (AC-317). */
export interface ContagemDecisoes {
  aplicadas: number;
  ignoradas: number;
  recusadas: number;
}

export interface RelatorioEtl {
  simulacao: boolean;
  linhas: LinhaRelatorio[];
  /** Itens da fila de revisão manual desta execução (AC-259, AC-260). */
  revisao: ItemRevisao[];
  /** Planilha da fila de revisão (AC-307), no mesmo formato que `--decisoes` espera de volta. */
  csvFilaRevisao: string;
  /** Decisões aplicadas/ignoradas/recusadas nesta execução (AC-317). */
  decisoes: ContagemDecisoes;
  /** Linhas da planilha de decisões para um `idExterno` que não está na fila — nada foi criado para elas. */
  decisoesForaDaFila: LinhaDecisaoBruta[];
}

/** O relatório não fechou a conta (`lidas != criadas + ignoradas + emRevisao`) para uma entidade (AC-269). */
export class ErroRelatorioInconsistente extends Error {
  constructor(linha: LinhaRelatorio) {
    super(
      `Relatório não confere para "${linha.entidade}": lidas=${linha.lidas}, ` +
        `criadas=${linha.criadas}, ignoradas=${linha.ignoradas}, emRevisao=${linha.emRevisao}.`
    );
    this.name = 'ErroRelatorioInconsistente';
  }
}

function linhaRelatorio(
  entidade: string,
  resultado: { lidas: number; criadas: number; ignoradas: number },
  emRevisao = 0
): LinhaRelatorio {
  const linha: LinhaRelatorio = {
    entidade,
    lidas: resultado.lidas,
    criadas: resultado.criadas,
    ignoradas: resultado.ignoradas,
    emRevisao,
  };
  if (linha.lidas !== linha.criadas + linha.ignoradas + linha.emRevisao) {
    throw new ErroRelatorioInconsistente(linha);
  }
  return linha;
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

/** Tipos de item de revisão que ainda não viraram lead/card — a fila que a planilha de decisões resolve (AC-307). */
const TIPOS_BLOQUEADOS = new Set<ItemRevisao['tipo']>(['situacao_sem_etapa', 'decisao_recusada']);

async function rodarEtapas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  dados: DadosOrigemEtl,
  agora: Date
): Promise<RelatorioEtl> {
  const idsEmpresasDestino = dados.empresas.map((empresa) => empresa.id);

  const resultadoEmpresas = await migrarEmpresas(tx, contexto, dados.empresas);
  const resultadoUsuarios = await migrarUsuarios(tx, contexto, dados.usuarios, idsEmpresasDestino);

  const linhasDecisao = dados.linhasDecisao ?? [];
  const idsNaFila = new Set(
    dados.leads.filter((lead) => etapaDireta(lead.situacao) === null).map((lead) => lead.id)
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

  const resultadoLeads = await migrarLeads(tx, contexto, dados.leads, dados.decisoesRevisao ?? [], decisoesValidadas);
  const resultadoCampanhas = await migrarCampanhas(tx, contexto, dados.campanhas, dados.envios);
  const resultadoMensagens = await migrarMensagens(tx, contexto, dados.mensagens);
  const resultadoConfiguracoes = await migrarConfiguracoes(tx, contexto, dados.configuracoes);

  const linhas: LinhaRelatorio[] = [
    linhaRelatorio('empresa', resultadoEmpresas),
    linhaRelatorio('usuario', resultadoUsuarios),
    linhaRelatorio('lead', resultadoLeads, resultadoLeads.emRevisao),
    linhaRelatorio('campanha', resultadoCampanhas.campanhas),
    linhaRelatorio('envio_campanha', resultadoCampanhas.envios),
    linhaRelatorio('mensagem_whatsapp', resultadoMensagens),
    linhaRelatorio('configuracao_empresa', resultadoConfiguracoes),
  ];

  const leadsPorId = new Map(dados.leads.map((lead) => [lead.id, lead]));
  const itensFilaRevisao: ItemFilaRevisao[] = resultadoLeads.revisao
    .filter((item) => TIPOS_BLOQUEADOS.has(item.tipo))
    .map((item) => {
      const legado = leadsPorId.get(item.idExterno);
      return {
        idOrigem: item.idExterno,
        nome: legado?.nome ?? '',
        telefone: legado?.whatsapp ?? '',
        email: legado?.email ?? '',
        statusOriginal: legado?.situacao ?? '',
        motivoRevisao: item.motivo,
      };
    });

  return {
    simulacao: contexto.simulacao,
    linhas,
    revisao: resultadoLeads.revisao,
    csvFilaRevisao: gerarCsvFilaRevisao(itensFilaRevisao),
    decisoes: {
      aplicadas: resultadoLeads.decisoesAplicadas,
      ignoradas: resultadoLeads.decisoesIgnoradas,
      recusadas: resultadoLeads.decisoesRecusadas,
    },
    decisoesForaDaFila,
  };
}

/**
 * Roda o ETL completo do Supabase legado (US-074): as seis etapas, na
 * ordem, numa única transação (AC-270) que é desfeita ao final em modo
 * simulação (AC-268) e que, em reexecução, só soma `ignoradas` porque cada
 * etapa já é idempotente (AC-267). Devolve o relatório com a conta fechada
 * por entidade (AC-269). `agora` é o instante da execução, usado para
 * recusar próxima ação vencida (T-124) — passável nos testes para não
 * depender do relógio real.
 */
export async function executarMigracaoSupabase(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  dados: DadosOrigemEtl,
  agora: Date = new Date()
): Promise<RelatorioEtl> {
  return executarEtl(db, contexto, (tx, ctx) => rodarEtapas(tx, ctx, dados, agora));
}
