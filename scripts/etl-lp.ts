#!/usr/bin/env -S npx tsx
// T-123 (fase3-etl-lp, US-085): comando de linha de comando do ETL da LP.
// Lê a tabela `leads` da LP com o cliente somente leitura de
// `src/etl/lp/origem.ts` (ASM-095, AC-306 — nenhuma chamada de escrita
// existe nesse cliente) e roda o orquestrador de `src/etl/lp/executar.ts`
// dentro de uma única transação no destino, imprimindo o relatório.
//
// Uso:
//   npx tsx scripts/etl-lp.ts [--dry-run] [--decisoes <arquivo.json>]
//
// --dry-run    roda em modo simulação (AC-303): nada é gravado no destino.
// --decisoes   arquivo JSON com as decisões da fila de revisão (AC-301),
//              formato: { "<idLp>": { "etapaId": 1 } | { "ignorar": true } }.
//
// `SUPABASE_LP_URL` e `SUPABASE_LP_SERVICE_KEY` (a chave de serviço da LP,
// ASM-095) nunca aparecem no relatório nem no log (AC-299, AC-306) — os
// erros de `origem.ts` já mascaram a chave com `mascarar`.
import fs from 'node:fs';

import { eq } from 'drizzle-orm';

import { getDb } from '../src/db/client';
import { empresas } from '../src/db/schema';
import type { ContextoExecucao } from '../src/etl/comum';
import { lerTodosCadastros } from '../src/etl/lp/origem';
import type { DecisoesLp } from '../src/etl/lp/leads';
import { executarMigracaoLp, type RelatorioEtlLp } from '../src/etl/lp/executar';

const ORIGEM_ETL = 'supabase-lp';
const EMPRESA_SLUG = 'medguia';

interface Argumentos {
  dryRun: boolean;
  caminhoDecisoes: string | undefined;
}

function lerArgumentos(argv: string[]): Argumentos {
  const dryRun = argv.includes('--dry-run');
  const indiceDecisoes = argv.indexOf('--decisoes');
  const caminhoDecisoes = indiceDecisoes >= 0 ? argv[indiceDecisoes + 1] : undefined;
  return { dryRun, caminhoDecisoes };
}

function lerDecisoes(caminho: string | undefined): DecisoesLp {
  if (!caminho) return {};
  const conteudo = fs.readFileSync(caminho, 'utf8');
  return JSON.parse(conteudo) as DecisoesLp;
}

async function buscarEmpresaMedguia(db: ReturnType<typeof getDb>): Promise<string> {
  const [empresa] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.slug, EMPRESA_SLUG));
  if (!empresa) {
    throw new Error(`Empresa "${EMPRESA_SLUG}" não encontrada no destino.`);
  }
  return empresa.id;
}

function imprimirRelatorio(relatorio: RelatorioEtlLp): void {
  console.log(`\nETL LP (landing page) — modo ${relatorio.simulacao ? 'SIMULAÇÃO (nada foi gravado)' : 'real'}\n`);
  console.log(
    'lidas'.padStart(8),
    'criadas'.padStart(8),
    'ignoradas'.padStart(10),
    'em revisão'.padStart(11)
  );
  console.log(
    String(relatorio.lidas).padStart(8),
    String(relatorio.criadas).padStart(8),
    String(relatorio.ignoradas).padStart(10),
    String(relatorio.emRevisao).padStart(11)
  );

  if (relatorio.revisao.length > 0) {
    console.log(`\nFila de revisão manual (${relatorio.revisao.length} item(ns)):`);
    for (const item of relatorio.revisao) {
      console.log(`  - ${item.idLp} [${item.tipo}]: ${item.motivo}`);
    }
  }
}

async function main(): Promise<void> {
  const { dryRun, caminhoDecisoes } = lerArgumentos(process.argv.slice(2));
  const decisoes = lerDecisoes(caminhoDecisoes);

  const { cadastros, total } = await lerTodosCadastros();

  const db = getDb();
  const empresaId = await buscarEmpresaMedguia(db);
  const contexto: ContextoExecucao = { origem: ORIGEM_ETL, simulacao: dryRun };

  const relatorio = await executarMigracaoLp(db, contexto, empresaId, cadastros, total, decisoes);
  imprimirRelatorio(relatorio);
}

main().catch((erro) => {
  console.error('ETL da LP falhou — nada desta execução foi gravado no destino.');
  console.error(erro);
  process.exitCode = 1;
});
