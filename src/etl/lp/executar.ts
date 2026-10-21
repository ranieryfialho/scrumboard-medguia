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
//
// T-126 (fase3-etl-decisoes, US-089): `linhasDecisao` (lidas de volta pelo
// script via `lerCsvDecisoes`, T-124) é casada por `idLp` com os cadastros
// cujo status cairia em revisão (`mapearStatusParaEtapa(...).tipo ===
// 'revisao'`, o mesmo cálculo puro que `importarLeadsLp` faz internamente) e
// validada aqui com a tabela `etapas` e os motivos de perda ativos do banco
// (nunca fixos no código), e o instante `agora` da execução. Uma linha de
// decisão para um `idLp` fora dessa fila é listada em `decisoesForaDaFila` e
// não cria nada. A fila de revisão desta execução sai em `csvFilaRevisao`
// (AC-307), no mesmo formato que a operação devolve em `--decisoes`
// (ASM-101) — `pessoa_existente` (dedupe, AC-300) continua fora do escopo
// da planilha comum e só se resolve pelo formato simples `decisoes`
// (`DecisoesLp`), como já era (fora de escopo: mesclar a pessoa duplicada).
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
import { mapearStatusParaEtapa } from '../sheets/status';
import { importarLeadsLp, type DecisoesLp, type ItemRevisaoLp } from './leads';
import type { CadastroLpBruto } from './origem';

/** Conta das decisões aplicadas nesta execução (AC-317). */
export interface ContagemDecisoes {
  aplicadas: number;
  ignoradas: number;
  recusadas: number;
}

export interface RelatorioEtlLp {
  simulacao: boolean;
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  /** Fila de revisão manual desta execução (AC-300, AC-301). */
  revisao: ItemRevisaoLp[];
  /** Planilha da fila de revisão (AC-307), no mesmo formato que `--decisoes` espera de volta. */
  csvFilaRevisao: string;
  /** Decisões aplicadas/ignoradas/recusadas nesta execução (AC-317). */
  decisoes: ContagemDecisoes;
  /** Linhas da planilha de decisões para um `idLp` que não está na fila — nada foi criado para elas. */
  decisoesForaDaFila: LinhaDecisaoBruta[];
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
const TIPOS_BLOQUEADOS = new Set<ItemRevisaoLp['tipo']>(['status_em_revisao', 'decisao_recusada']);

async function rodarEtapas(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  totalOrigem: number,
  decisoes: DecisoesLp,
  linhasDecisaoCsv: LinhaDecisaoBruta[],
  agora: Date
): Promise<RelatorioEtlLp> {
  const idsNaFila = new Set(
    cadastros
      .filter(
        (cadastro) =>
          mapearStatusParaEtapa(cadastro.status ?? '', { dataFechamento: cadastro.data_fechamento ?? undefined })
            .tipo === 'revisao'
      )
      .map((cadastro) => String(cadastro.id))
  );
  const decisoesForaDaFila = linhasDecisaoForaDaFila(idsNaFila, linhasDecisaoCsv);

  const etapasValidacao = await buscarEtapasValidacao(tx);
  const motivosPerdaValidacao = await buscarMotivosPerdaValidacao(tx);
  const decisoesValidadas = new Map<string, ResultadoValidacao>();
  for (const linha of linhasDecisaoCsv) {
    if (!idsNaFila.has(linha.idOrigem)) continue;
    decisoesValidadas.set(
      linha.idOrigem,
      validarDecisao(linha, { etapas: etapasValidacao, motivosPerda: motivosPerdaValidacao, agora })
    );
  }

  const resultado = await importarLeadsLp(tx, contexto, empresaId, cadastros, decisoes, decisoesValidadas);

  const cadastrosPorId = new Map(cadastros.map((cadastro) => [String(cadastro.id), cadastro]));
  const itensFilaRevisao: ItemFilaRevisao[] = resultado.revisao
    .filter((item) => TIPOS_BLOQUEADOS.has(item.tipo))
    .map((item) => {
      const cadastro = cadastrosPorId.get(item.idLp);
      return {
        idOrigem: item.idLp,
        nome: cadastro?.name ?? '',
        telefone: cadastro?.whatsapp ?? '',
        email: cadastro?.email ?? '',
        statusOriginal: cadastro?.status ?? '',
        motivoRevisao: item.motivo,
      };
    });

  const relatorio: RelatorioEtlLp = {
    simulacao: contexto.simulacao,
    lidas: resultado.lidas,
    criadas: resultado.criadas,
    ignoradas: resultado.ignoradas,
    emRevisao: resultado.emRevisao,
    revisao: resultado.revisao,
    csvFilaRevisao: gerarCsvFilaRevisao(itensFilaRevisao),
    decisoes: {
      aplicadas: resultado.decisoesAplicadas,
      ignoradas: resultado.decisoesIgnoradas,
      recusadas: resultado.decisoesRecusadas,
    },
    decisoesForaDaFila,
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
 * nada aqui lê a LP de novo. `agora` é o instante da execução, usado para
 * recusar próxima ação vencida (T-124) — passável nos testes para não
 * depender do relógio real.
 */
export async function executarMigracaoLp(
  db: NodePgDatabase,
  contexto: ContextoExecucao,
  empresaId: string,
  cadastros: CadastroLpBruto[],
  totalOrigem: number,
  decisoes: DecisoesLp = {},
  linhasDecisaoCsv: LinhaDecisaoBruta[] = [],
  agora: Date = new Date()
): Promise<RelatorioEtlLp> {
  return executarEtl(db, contexto, (tx, ctx) =>
    rodarEtapas(tx, ctx, empresaId, cadastros, totalOrigem, decisoes, linhasDecisaoCsv, agora)
  );
}
