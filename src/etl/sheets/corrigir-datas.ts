// Correção das datas de entrada dos leads já migrados das planilhas. Antes de
// `dataEntradaDoLead` (leads.ts), o ETL não informava `criado_em` e o banco
// gravava a data da migração em `leads` e `oportunidades` — os relatórios, que
// filtram o período por `oportunidades.criado_em` (ASM-069), mostravam tudo
// nesse dia. Aqui relemos as mesmas abas, achamos o lead/card de cada linha
// por `migracao_registros` (a mesma chave do ETL) e devolvemos a data real
// (`created_time`).
//
// Só mexe em `criado_em`, e só para trás: uma data da planilha igual ou
// posterior à gravada no banco é deixada como está (rodar de novo não muda
// nada). O card corrigido é o que tem o evento `migrado_de` — um card que o
// lead tenha ganhado depois, já no CRM, não é tocado. O histórico
// (`oportunidade_eventos`) nunca é alterado: o evento `migrado_de` continua
// marcando quando a migração aconteceu.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { definirEmpresaDoEtl, executarEtl, type ContextoExecucao } from '../comum';
import { migracaoRegistros } from '../../db/schema';
import { deduplicarLeads, type LeadComOrigem } from './dedupe';
import { metaIdSintetico, ORIGEM_ETL_SHEETS, type AbaParaLer } from './executar';
import { dataEntradaDoLead, ENTIDADE_LEAD } from './leads';
import { lerAba } from './leitor';

export interface RelatorioCorrecaoDatas {
  simulacao: boolean;
  /** Leads válidos lidos das planilhas (depois da deduplicação entre abas). */
  lidos: number;
  /** Leads que ganharam a data real (lead e card). */
  corrigidos: number;
  /** Já estavam com a data da planilha (ou mais antiga): nada a fazer. */
  jaCorretos: number;
  /** A linha não tem `created_time` válido: fica com a data gravada. */
  semData: number;
  /** A linha ainda não foi migrada (ou foi ignorada/revisada): não há lead no CRM. */
  naoMigrados: number;
}

/** Intervalo das datas aplicadas — para conferir na simulação se os valores fazem sentido. */
export interface ResumoDeslocamento {
  maisAntigaDaPlanilha?: Date;
  maisRecenteDaPlanilha?: Date;
}

export async function corrigirDatasEntradaSheets(
  db: NodePgDatabase,
  contexto: Pick<ContextoExecucao, 'simulacao'>,
  empresaId: string,
  abas: AbaParaLer[]
): Promise<RelatorioCorrecaoDatas & ResumoDeslocamento> {
  const ctx: ContextoExecucao = { origem: ORIGEM_ETL_SHEETS, simulacao: contexto.simulacao };

  return executarEtl(db, ctx, async (tx) => {
    await definirEmpresaDoEtl(tx, empresaId);

    // Mesma montagem de `rodarEtapas`: leitura por aba, id sintético quando a
    // linha não tem id da Meta e deduplicação entre abas.
    const entradas: LeadComOrigem[] = [];
    for (const aba of abas) {
      const [planilha, nomeAba] = aba.chave.split('/');
      const origem = { planilha, aba: nomeAba };
      for (const lead of lerAba(aba.chave, aba.linhas).leads) {
        entradas.push({ origem, lead: lead.metaId.trim() ? lead : { ...lead, metaId: metaIdSintetico(origem, lead) } });
      }
    }
    const { leads: deduplicados } = deduplicarLeads(entradas);

    const registros = await tx
      .select({ idExterno: migracaoRegistros.idExterno, idDestino: migracaoRegistros.idDestino })
      .from(migracaoRegistros)
      .where(and(eq(migracaoRegistros.origem, ORIGEM_ETL_SHEETS), eq(migracaoRegistros.entidade, ENTIDADE_LEAD)));
    const leadIdPorMetaId = new Map(registros.map((registro) => [registro.idExterno, registro.idDestino]));

    const relatorio: RelatorioCorrecaoDatas & ResumoDeslocamento = {
      simulacao: contexto.simulacao,
      lidos: deduplicados.length,
      corrigidos: 0,
      jaCorretos: 0,
      semData: 0,
      naoMigrados: 0,
    };

    for (const { lead } of deduplicados) {
      const leadId = leadIdPorMetaId.get(lead.metaId);
      if (!leadId) {
        relatorio.naoMigrados += 1;
        continue;
      }

      const dataEntrada = dataEntradaDoLead(lead);
      if (!dataEntrada) {
        relatorio.semData += 1;
        continue;
      }

      const instante = dataEntrada.toISOString();
      const atualizados = await tx.execute(sql`
        UPDATE leads SET criado_em = ${instante}::timestamptz
        WHERE id = ${leadId}::uuid AND criado_em > ${instante}::timestamptz
        RETURNING id
      `);
      const cards = await tx.execute(sql`
        UPDATE oportunidades SET criado_em = ${instante}::timestamptz
        WHERE lead_id = ${leadId}::uuid
          AND criado_em > ${instante}::timestamptz
          AND id IN (
            SELECT oportunidade_id FROM oportunidade_eventos WHERE tipo = 'migrado_de'
          )
        RETURNING id
      `);

      if (atualizados.rows.length > 0 || cards.rows.length > 0) {
        relatorio.corrigidos += 1;
        if (!relatorio.maisAntigaDaPlanilha || dataEntrada < relatorio.maisAntigaDaPlanilha) {
          relatorio.maisAntigaDaPlanilha = dataEntrada;
        }
        if (!relatorio.maisRecenteDaPlanilha || dataEntrada > relatorio.maisRecenteDaPlanilha) {
          relatorio.maisRecenteDaPlanilha = dataEntrada;
        }
      } else {
        relatorio.jaCorretos += 1;
      }
    }

    return relatorio;
  });
}
