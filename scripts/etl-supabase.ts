#!/usr/bin/env -S npx tsx
// T-113 (fase3-etl-supabase, US-074): comando de linha de comando do ETL.
// Lê a origem Supabase legada (conexão direta somente leitura, ASM-087) e o
// destino (`DATABASE_URL`, mesmo client de `src/db/client.ts`), roda o
// orquestrador de `src/etl/supabase/executar.ts` dentro de uma única
// transação e imprime o relatório.
//
// Uso:
//   npx tsx scripts/etl-supabase.ts [--dry-run] [--fila-revisao <arquivo.csv>]
//     [--decisoes <arquivo.csv>]
//
// --dry-run       roda em modo simulação (AC-268): nada é gravado no destino.
// --fila-revisao  caminho onde salvar a planilha da fila de revisão (AC-307)
//                 desta execução — a operação preenche e devolve em --decisoes.
// --decisoes      planilha de decisões preenchida pela operação (AC-315),
//                 lida com `lerCsvDecisoes` (T-124, UTF-8 com BOM) — substitui
//                 o antigo arquivo JSON (ASM-105).
//
// As tabelas legadas (`empresas`, `leads`, `campanhas`, `envios_campanha`,
// `whatsapp_mensagens`, `empresa_configuracoes`) e os usuários (Supabase
// Auth, papel em `raw_user_meta_data`) estão documentados em RFC-001 §3 e
// TDD-001 — este script só lê, nunca grava na origem (`conectarOrigem` abre
// a conexão com `default_transaction_read_only=on`).
import { getDb } from '../src/db/client';
import type { ContextoExecucao } from '../src/etl/comum';
import { lerCsvDecisoes, type LinhaDecisaoBruta } from '../src/etl/decisoes';
import { conectarOrigem, encerrarOrigem, lerUsuarios } from '../src/etl/supabase/origem';
import {
  lerCampanhas,
  lerConfiguracoes,
  lerEmpresas,
  lerEnvios,
  lerLeads,
  lerMensagens,
} from '../src/etl/supabase/leitura-origem';
import {
  executarMigracaoSupabase,
  type DadosOrigemEtl,
  type RelatorioEtl,
} from '../src/etl/supabase/executar';

import fs from 'node:fs';
import type { Pool } from 'pg';

const ORIGEM_ETL = 'supabase-legado-crm';

interface Argumentos {
  dryRun: boolean;
  caminhoFilaRevisao: string | undefined;
  caminhoDecisoes: string | undefined;
}

function lerArgumentos(argv: string[]): Argumentos {
  const dryRun = argv.includes('--dry-run');
  const indiceFilaRevisao = argv.indexOf('--fila-revisao');
  const caminhoFilaRevisao = indiceFilaRevisao >= 0 ? argv[indiceFilaRevisao + 1] : undefined;
  const indiceDecisoes = argv.indexOf('--decisoes');
  const caminhoDecisoes = indiceDecisoes >= 0 ? argv[indiceDecisoes + 1] : undefined;
  return { dryRun, caminhoFilaRevisao, caminhoDecisoes };
}

/** Lê a planilha de decisões devolvida pela operação (AC-315), se informada. */
function lerLinhasDecisao(caminho: string | undefined): LinhaDecisaoBruta[] {
  if (!caminho) return [];
  const texto = fs.readFileSync(caminho, 'utf8');
  return lerCsvDecisoes(texto);
}

async function lerDadosOrigem(pool: Pool, linhasDecisao: LinhaDecisaoBruta[]): Promise<DadosOrigemEtl> {
  return {
    empresas: await lerEmpresas(pool),
    usuarios: await lerUsuarios(pool),
    leads: await lerLeads(pool),
    linhasDecisao,
    campanhas: await lerCampanhas(pool),
    envios: await lerEnvios(pool),
    mensagens: await lerMensagens(pool),
    configuracoes: await lerConfiguracoes(pool),
  };
}

function imprimirRelatorio(relatorio: RelatorioEtl): void {
  console.log(`\nETL Supabase legado — modo ${relatorio.simulacao ? 'SIMULAÇÃO (nada foi gravado)' : 'real'}\n`);
  console.log('entidade'.padEnd(22), 'lidas'.padStart(8), 'criadas'.padStart(8), 'ignoradas'.padStart(10), 'em revisão'.padStart(11));
  for (const linha of relatorio.linhas) {
    console.log(
      linha.entidade.padEnd(22),
      String(linha.lidas).padStart(8),
      String(linha.criadas).padStart(8),
      String(linha.ignoradas).padStart(10),
      String(linha.emRevisao).padStart(11)
    );
  }
  if (relatorio.revisao.length > 0) {
    console.log(`\nFila de revisão manual (${relatorio.revisao.length} item(ns)):`);
    for (const item of relatorio.revisao) {
      console.log(`  - ${item.idExterno} [${item.tipo}]: ${item.motivo}`);
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
}

async function main(): Promise<void> {
  const { dryRun, caminhoFilaRevisao, caminhoDecisoes } = lerArgumentos(process.argv.slice(2));
  const linhasDecisao = lerLinhasDecisao(caminhoDecisoes);

  const poolOrigem = conectarOrigem();
  try {
    const dados = await lerDadosOrigem(poolOrigem, linhasDecisao);
    const db = getDb();
    const contexto: ContextoExecucao = { origem: ORIGEM_ETL, simulacao: dryRun };

    const relatorio = await executarMigracaoSupabase(db, contexto, dados);
    imprimirRelatorio(relatorio);

    if (caminhoFilaRevisao) {
      fs.writeFileSync(caminhoFilaRevisao, relatorio.csvFilaRevisao, 'utf8');
      console.log(`Planilha da fila de revisão salva em ${caminhoFilaRevisao}`);
    }
  } finally {
    await encerrarOrigem(poolOrigem);
  }
}

main().catch((erro) => {
  console.error('ETL Supabase legado falhou — nada desta execução foi gravado no destino.');
  console.error(erro);
  process.exitCode = 1;
});
