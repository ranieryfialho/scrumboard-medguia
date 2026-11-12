#!/usr/bin/env -S npx tsx
// Corrige a data de entrada (`criado_em`) dos leads e cards que o ETL do
// Sheets já migrou com a data da migração. Relê as quatro abas (somente
// leitura) e devolve a `created_time` real de cada lead — ver
// `src/etl/sheets/corrigir-datas.ts`.
//
// Uso:
//   npx tsx scripts/etl-sheets-corrigir-datas.ts --dry-run   # só mostra o que mudaria
//   npx tsx scripts/etl-sheets-corrigir-datas.ts             # grava
//
// Mesmas variáveis do `etl-sheets.ts`: GOOGLE_SHEET_ID_1..3, GOOGLE_CLIENT_EMAIL,
// GOOGLE_PRIVATE_KEY e DATABASE_URL do destino. Rodar sempre primeiro com
// --dry-run (a transação é desfeita ao final) e conferir os números.
import { eq } from 'drizzle-orm';

import { getDb } from '../src/db/client';
import { empresas } from '../src/db/schema';
import { corrigirDatasEntradaSheets } from '../src/etl/sheets/corrigir-datas';
import type { AbaParaLer } from '../src/etl/sheets/executar';
import {
  buscarLinhasAba,
  criarClienteSheetsSomenteLeitura,
  type ChaveAbaConhecida,
} from '../src/etl/sheets/leitor';

const EMPRESA_SLUG = 'medguia';

const ABAS_DE_LEADS: { chave: ChaveAbaConhecida; spreadsheetIdEnv: string; range: string }[] = [
  { chave: 'sheet1/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página1' },
  { chave: 'sheet1/Página2', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_1', range: 'Página2' },
  { chave: 'sheet2/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_2', range: 'Página1' },
  { chave: 'sheet3/Página1', spreadsheetIdEnv: 'GOOGLE_SHEET_ID_3', range: 'Página1' },
];

function exigirEnv(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} precisa estar configurado.`);
  return valor;
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  const sheets = criarClienteSheetsSomenteLeitura({
    email: exigirEnv('GOOGLE_CLIENT_EMAIL'),
    chavePrivada: exigirEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  });

  const abas: AbaParaLer[] = [];
  for (const aba of ABAS_DE_LEADS) {
    const linhas = await buscarLinhasAba(sheets, exigirEnv(aba.spreadsheetIdEnv), aba.range);
    abas.push({ chave: aba.chave, linhas });
  }

  const db = getDb();
  const [empresa] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.slug, EMPRESA_SLUG));
  if (!empresa) throw new Error(`Empresa "${EMPRESA_SLUG}" não encontrada no destino.`);

  const relatorio = await corrigirDatasEntradaSheets(db, { simulacao: dryRun }, empresa.id, abas);

  console.log(`\nCorreção das datas de entrada — modo ${relatorio.simulacao ? 'SIMULAÇÃO (nada foi gravado)' : 'real'}\n`);
  console.log(`Leads lidos das planilhas:            ${relatorio.lidos}`);
  console.log(`Corrigidos (data real aplicada):      ${relatorio.corrigidos}`);
  console.log(`Já com a data correta:                ${relatorio.jaCorretos}`);
  console.log(`Sem created_time válido (não mexe):   ${relatorio.semData}`);
  console.log(`Não migrados para o CRM (não mexe):   ${relatorio.naoMigrados}`);
  if (relatorio.maisAntigaDaPlanilha && relatorio.maisRecenteDaPlanilha) {
    console.log(
      `\nDatas aplicadas vão de ${relatorio.maisAntigaDaPlanilha.toISOString()} ` +
        `a ${relatorio.maisRecenteDaPlanilha.toISOString()}`
    );
  }
}

main().catch((erro) => {
  console.error('Correção das datas falhou — nada foi gravado no destino.');
  console.error(erro);
  process.exitCode = 1;
});
