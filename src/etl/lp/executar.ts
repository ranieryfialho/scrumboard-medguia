// T-123 (fase3-etl-lp, US-085): orquestrador e contrato de relatório do ETL
// da LP — junta T-121 (leitura somente leitura) e T-122 (importação de
// lead+card) dentro da MESMA transação de `executarEtl` (`comum.ts`).
//
// AC-299: este arquivo nunca lê nem recebe `password_hash` — `CadastroLpBruto`
// (T-121) já exclui a coluna, então não há como ela aparecer no relatório ou
// no log, nem em simulação.
// AC-302: `importarLeadsLp` já é idempotente por `migracao_registros`
// (origem `contexto.origem`) — rodar de novo sobre os mesmos cadastros só
// soma `ignoradas`.
// AC-303: em simulação, `executarEtl` roda a função inteira — para que o
// relatório diga o que seria criado/ignorado/em revisão — mas desfaz a
// transação ao final, então o destino sai idêntico a como entrou.
// AC-304: o relatório fecha a conta (`lidas = criadas + ignoradas +
// emRevisao`) e confere `lidas` com `totalOrigem`, o total de linhas da
// tabela na LP (header `Content-Range`, lido por T-121) — diverge só quando
// a origem ganhou/perdeu linhas entre a leitura e a chamada.
// AC-305: toda a importação roda dentro da transação aberta por
// `executarEtl` — uma falha no meio (ex.: FK de `etapa_id` inválida vinda de
// uma decisão) derruba a transação inteira; nada desta execução sobrevive.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { executarEtl, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { importarLeadsLp, type DecisoesLp, type ItemRevisaoLp } from './leads';
import type { CadastroLpBruto } from './origem';

export interface RelatorioEtlLp {
  simulacao: boolean;
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  /** Fila de revisão manual desta execução (AC-300, AC-301). */
  revisao: ItemRevisaoLp[];
}

/** O relatório não fechou a conta (`lidas != criadas + ignoradas + emRevisao`) (AC-304). */
export class ErroRelatorioInconsistente extends Error {
  constructor(relatorio: { lidas: number; criadas: number; ignoradas: number; emRevisao: number }) {
    super(
      `Relatório do ETL da LP não confere: lidas=${relatorio.lidas}, criadas=${relatorio.criadas}, ` +
        `ignoradas=${relatorio.ignoradas}, emRevisao=${relatorio.emRevisao}.`
    );
    this.name = 'ErroRelatorioInconsistente';
  }
}

/** `lidas` não bate com o total de linhas da tabela na LP (AC-304). */
export class ErroContagemDivergenteDaOrigem extends Error {
  constructor(lidas: number, totalOrigem: number) {
    super(`Lidas (${lidas}) não bate com o total de linhas da LP (${totalOrigem}).`);
    this.name = 'ErroContagemDivergenteDaOrigem';
  }
}

async function rodarEtapas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  totalOrigem: number,
  decisoes: DecisoesLp
): Promise<RelatorioEtlLp> {
  const resultado = await importarLeadsLp(tx, contexto, empresaId, cadastros, decisoes);

  const relatorio: RelatorioEtlLp = {
    simulacao: contexto.simulacao,
    lidas: resultado.lidas,
    criadas: resultado.criadas,
    ignoradas: resultado.ignoradas,
    emRevisao: resultado.emRevisao,
    revisao: resultado.revisao,
  };

  if (relatorio.lidas !== relatorio.criadas + relatorio.ignoradas + relatorio.emRevisao) {
    throw new ErroRelatorioInconsistente(relatorio);
  }
  if (relatorio.lidas !== totalOrigem) {
    throw new ErroContagemDivergenteDaOrigem(relatorio.lidas, totalOrigem);
  }

  return relatorio;
}

/**
 * Roda o ETL completo da LP (US-085): importa os cadastros já lidos de
 * `origem.ts` como lead + card, numa única transação (AC-305, via
 * `executarEtl`) que é desfeita ao final em modo simulação (AC-303).
 * `totalOrigem` é o total de linhas da tabela na LP (devolvido por
 * `lerTodosCadastros`), usado só para a conferência do relatório (AC-304) —
 * nada aqui lê a LP de novo.
 */
export async function executarMigracaoLp(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  totalOrigem: number,
  decisoes: DecisoesLp = {}
): Promise<RelatorioEtlLp> {
  return executarEtl(db, contexto, (tx, ctx) =>
    rodarEtapas(tx, ctx, empresaId, cadastros, totalOrigem, decisoes)
  );
}
