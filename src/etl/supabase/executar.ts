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
import { executarEtl, type ContextoExecucao, type TransacaoEtl } from '../comum';
import {
  migrarEmpresas,
  migrarUsuarios,
  type EmpresaLegado,
  type UsuarioLegado,
} from './identidade';
import {
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

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Tudo que o orquestrador precisa da origem para rodar as seis etapas. */
export interface DadosOrigemEtl {
  empresas: EmpresaLegado[];
  usuarios: UsuarioLegado[];
  leads: LeadLegado[];
  /** Decisões da operação para leads que ficaram na fila de revisão em execuções anteriores (AC-272). */
  decisoesRevisao?: DecisaoRevisao[];
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

export interface RelatorioEtl {
  simulacao: boolean;
  linhas: LinhaRelatorio[];
  /** Itens da fila de revisão manual desta execução (AC-259, AC-260). */
  revisao: ItemRevisao[];
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

async function rodarEtapas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  dados: DadosOrigemEtl
): Promise<RelatorioEtl> {
  const idsEmpresasDestino = dados.empresas.map((empresa) => empresa.id);

  const resultadoEmpresas = await migrarEmpresas(tx, contexto, dados.empresas);
  const resultadoUsuarios = await migrarUsuarios(tx, contexto, dados.usuarios, idsEmpresasDestino);
  const resultadoLeads = await migrarLeads(tx, contexto, dados.leads, dados.decisoesRevisao ?? []);
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

  return { simulacao: contexto.simulacao, linhas, revisao: resultadoLeads.revisao };
}

/**
 * Roda o ETL completo do Supabase legado (US-074): as seis etapas, na
 * ordem, numa única transação (AC-270) que é desfeita ao final em modo
 * simulação (AC-268) e que, em reexecução, só soma `ignoradas` porque cada
 * etapa já é idempotente (AC-267). Devolve o relatório com a conta fechada
 * por entidade (AC-269).
 */
export async function executarMigracaoSupabase(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  dados: DadosOrigemEtl
): Promise<RelatorioEtl> {
  return executarEtl(db, contexto, (tx, ctx) => rodarEtapas(tx, ctx, dados));
}
