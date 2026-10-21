#!/usr/bin/env -S npx tsx
// T-120 (fase3-etl-sheets, US-081): comando de linha de comando do ETL do
// Sheets. Baixa as quatro abas de leads e a aba `Agenda` com o cliente
// somente leitura de `src/etl/sheets/leitor.ts` (ASM-094, AC-291 — nenhuma
// chamada de escrita existe nesse cliente), roda o orquestrador de
// `src/etl/sheets/executar.ts` dentro de uma única transação e imprime o
// relatório. A aba `Agenda` só sai em CSV (AC-286, ASM-092); este script
// grava esse CSV em disco, nunca na planilha.
//
// Uso:
//   npx tsx scripts/etl-sheets.ts [--dry-run] [--csv-agenda <arquivo.csv>]
//     [--fila-revisao <arquivo.csv>] [--decisoes <arquivo.csv>]
//
// --dry-run       roda em modo simulação (AC-290): nada é gravado no destino.
// --csv-agenda    caminho onde salvar o CSV da aba Agenda (padrão: agenda.csv).
// --fila-revisao  caminho onde salvar a planilha da fila de revisão (AC-307)
//                 desta execução — a operação preenche e devolve em --decisoes.
// --decisoes      planilha de decisões preenchida pela operação (AC-309 a
//                 AC-311); lida com `lerCsvDecisoes` (T-124, UTF-8 com BOM).
//
// As planilhas (`GOOGLE_SHEET_ID_1`, `GOOGLE_SHEET_ID_2`, `GOOGLE_SHEET_ID_3`)
// e a conta de serviço (`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`) são as
// mesmas do legado (`src/app/api/sheets/route.ts`, `src/app/api/agenda/route.ts`).
// Todo lead migrado pertence à empresa `medguia` (AC-293).
import fs from 'node:fs';

import { eq } from 'drizzle-orm';

import { getDb } from '../src/db/client';
import { empresas } from '../src/db/schema';
import type { ContextoExecucao } from '../src/etl/comum';
import { lerCsvDecisoes, type LinhaDecisaoBruta } from '../src/etl/decisoes';
import {
  buscarLinhasAba,
  criarClienteSheetsSomenteLeitura,
  type ChaveAbaConhecida,
  type CredenciaisContaDeServico,
} from '../src/etl/sheets/leitor';
import {
  executarMigracaoSheets,
  type AbaParaLer,
  type RelatorioEtlSheets,
} from '../src/etl/sheets/executar';

const ORIGEM_ETL = 'sheets-legado-crm';
const EMPRESA_SLUG = 'medguia';
const AGENDA_RANGE = 'Agenda!A:D';

/** Planilha/aba de origem de cada uma das quatro abas de leads (AC-273). */
const ABAS_DE_LEADS: { chave: ChaveAbaConhecida; spreadsheetIdEnv: string; range: string }[] = [
  { chave: 'sheet1/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página1' },
  { chave: 'sheet1/Página2', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página2' },
  { chave: 'sheet2/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_2', range: 'Página1' },
  { chave: 'sheet3/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_3', range: 'Página1' },
];

interface Argumentos {
  dryRun: boolean;
  caminhoCsvAgenda: string;
  caminhoFilaRevisao?: string;
  caminhoDecisoes?: string;
}

function lerArgumentos(argv: string[]): Argumentos {
  const dryRun = argv.includes('--dry-run');
  const indiceCsv = argv.indexOf('--csv-agenda');
  const caminhoCsvAgenda = indiceCsv >= 0 ? argv[indiceCsv + 1] : 'agenda.csv';
  const indiceFilaRevisao = argv.indexOf('--fila-revisao');
  const caminhoFilaRevisao = indiceFilaRevisao >= 0 ? argv[indiceFilaRevisao + 1] : undefined;
  const indiceDecisoes = argv.indexOf('--decisoes');
  const caminhoDecisoes = indiceDecisoes >= 0 ? argv[indiceDecisoes + 1] : undefined;
  return { dryRun, caminhoCsvAgenda, caminhoFilaRevisao, caminhoDecisoes };
}

/** Lê a planilha de decisões devolvida pela operação (AC-309 a AC-311), se informada. */
function lerLinhasDecisao(caminho: string | undefined): LinhaDecisaoBruta[] {
  if (!caminho) return [];
  const texto = fs.readFileSync(caminho, 'utf8');
  return lerCsvDecisoes(texto);
}

function lerCredenciais(): CredenciaisContaDeServico {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const chavePrivada = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !chavePrivada) {
    throw new Error('GOOGLE_CLIENT_EMAIL e GOOGLE_PRIVATE_KEY precisam estar configurados.');
  }
  return { email, chavePrivada };
}

function idDaPlanilha(variavelEnv: string): string {
  const valor = process.env[variavelEnv];
  if (!valor) {
    throw new Error(`${variavelEnv} precisa estar configurado.`);
  }
  return valor;
}

async function buscarEmpresaMedguia(db: ReturnType<typeof getDb>): Promise<string> {
  const [empresa] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.slug, EMPRESA_SLUG));
  if (!empresa) {
    throw new Error(`Empresa "${EMPRESA_SLUG}" não encontrada no destino.`);
  }
  return empresa.id;
}

function imprimirRelatorio(relatorio: RelatorioEtlSheets): void {
  console.log(`\nETL Sheets legado — modo ${relatorio.simulacao ? 'SIMULAÇÃO (nada foi gravado)' : 'real'}\n`);
  console.log(
    'aba'.padEnd(20),
    'lidas'.padStart(8),
    'criadas'.padStart(8),
    'fundidas'.padStart(9),
    'ignoradas'.padStart(10),
    'em revisão'.padStart(11)
  );
  for (const linha of relatorio.linhas) {
    console.log(
      linha.aba.padEnd(20),
      String(linha.linhasLidas).padStart(8),
      String(linha.criadas).padStart(8),
      String(linha.fundidas).padStart(9),
      String(linha.ignoradas).padStart(10),
      String(linha.emRevisao).padStart(11)
    );
  }

  if (relatorio.conflitos.length > 0) {
    console.log(`\nConflitos de status resolvidos na deduplicação (${relatorio.conflitos.length}):`);
    for (const conflito of relatorio.conflitos) {
      console.log(`  - ${conflito.metaId}: [${conflito.situacoes.join(', ')}] -> "${conflito.situacaoVencedora}" (${conflito.motivoDecisao})`);
    }
  }

  if (relatorio.revisao.length > 0) {
    console.log(`\nFila de revisão manual (${relatorio.revisao.length} item(ns)):`);
    for (const item of relatorio.revisao) {
      console.log(`  - ${item.metaId} [${item.tipo}]: ${item.motivo}`);
    }
  }

  console.log(
    `\nDecisões — aplicadas: ${relatorio.decisoes.aplicadas}, ` +
      `ignoradas: ${relatorio.decisoes.ignoradas}, recusadas: ${relatorio.decisoes.recusadas}`
  );

  if (relatorio.decisoesForaDaFila.length > 0) {
    console.log(`\nDecisões para um id que não está na fila (${relatorio.decisoesForaDaFila.length}), nada foi criado:`);
    for (const linha of relatorio.decisoesForaDaFila) {
      console.log(`  - ${linha.idOrigem}`);
    }
  }

  console.log(
    `\nMensagens de WhatsApp sem lead: ${relatorio.vinculoMensagens.semLead}, ` +
      `vinculadas: ${relatorio.vinculoMensagens.vinculadas}, ` +
      `sem lead para o telefone: ${relatorio.vinculoMensagens.semLeadParaTelefone}, ` +
      `telefone ambíguo: ${relatorio.vinculoMensagens.telefoneAmbiguo}`
  );
}

async function main(): Promise<void> {
  const { dryRun, caminhoCsvAgenda, caminhoFilaRevisao, caminhoDecisoes } = lerArgumentos(process.argv.slice(2));
  const linhasDecisao = lerLinhasDecisao(caminhoDecisoes);
  const credenciais = lerCredenciais();
  const sheets = criarClienteSheetsSomenteLeitura(credenciais);

  const abas: AbaParaLer[] = [];
  for (const abaConfigurada of ABAS_DE_LEADS) {
    const spreadsheetId = idDaPlanilha(abaConfigurada.spreadsheetIdEnv);
    const linhas = await buscarLinhasAba(sheets, spreadsheetId, abaConfigurada.range);
    abas.push({ chave: abaConfigurada.chave, linhas });
  }

  const agendaLinhas = await buscarLinhasAba(sheets, idDaPlanilha('GOOGLE_SHEET_ID_1'), AGENDA_RANGE);

  const db = getDb();
  const empresaId = await buscarEmpresaMedguia(db);
  const contexto: ContextoExecucao = { origem: ORIGEM_ETL, simulacao: dryRun };

  const relatorio = await executarMigracaoSheets(db, contexto, empresaId, abas, agendaLinhas, linhasDecisao);
  imprimirRelatorio(relatorio);

  fs.writeFileSync(caminhoCsvAgenda, relatorio.csvAgenda, 'utf8');
  console.log(`\nCSV da Agenda salvo em ${caminhoCsvAgenda}`);

  if (caminhoFilaRevisao) {
    fs.writeFileSync(caminhoFilaRevisao, relatorio.csvFilaRevisao, 'utf8');
    console.log(`Planilha da fila de revisão salva em ${caminhoFilaRevisao}`);
  }
}

main().catch((erro) => {
  console.error('ETL Sheets legado falhou — nada desta execução foi gravado no destino.');
  console.error(erro);
  process.exitCode = 1;
});
