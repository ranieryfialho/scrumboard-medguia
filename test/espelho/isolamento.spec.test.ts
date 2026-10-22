// T-135 (fase3-espelho-sheets, US-095): prova de AC-333 e AC-334 — a
// ingestão de leads nunca lê a aba "Espelho CRM" e uma edição manual nela
// nunca vira lead/card no CRM.
//
// A lista de abas e o range da Agenda são extraídos do próprio código-fonte
// de `src/worker/index.ts` (regex sobre `ABAS_DE_LEADS`/`AGENDA_RANGE`), não
// digitados de novo aqui — assim o teste exercita exatamente o que a
// produção lê, e não uma cópia que poderia divergir sem avisar. Contra
// Postgres real (mesmo harness de T-120/T-133) porque só rodando
// `executarMigracaoSheets` de verdade se prova que nada do espelho chega a
// virar lead/card.
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { sheets_v4 } from 'googleapis';
import { Pool } from 'pg';

import { buscarLinhasAba, type ChaveAbaConhecida } from '../../src/etl/sheets/leitor';
import { executarMigracaoSheets, type AbaParaLer } from '../../src/etl/sheets/executar';
import type { ContextoExecucao } from '../../src/etl/comum';
import { empresas, leads, oportunidades } from '../../src/db/schema';
import { NOME_ABA_ESPELHO } from '../../src/espelho/gravar';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const CAMINHO_WORKER_INDEX = path.join(process.cwd(), 'src', 'worker', 'index.ts');

interface AbaConfigurada {
  chave: ChaveAbaConhecida;
  spreadsheetIdEnv: string;
  range: string;
}

/** Lê `ABAS_DE_LEADS` e `AGENDA_RANGE` direto do código-fonte real do worker. */
function extrairListaDeAbasDoWorker(): { abas: AbaConfigurada[]; agendaRange: string } {
  const fonte = fs.readFileSync(CAMINHO_WORKER_INDEX, 'utf8');

  const agendaMatch = fonte.match(/const AGENDA_RANGE = '([^']+)';/);
  if (!agendaMatch) {
    throw new Error('AGENDA_RANGE não encontrado em src/worker/index.ts — a extração do teste ficou obsoleta.');
  }

  const blocoMatch = fonte.match(/const ABAS_DE_LEADS:[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!blocoMatch) {
    throw new Error('ABAS_DE_LEADS não encontrado em src/worker/index.ts — a extração do teste ficou obsoleta.');
  }

  const itemRegex = /\{\s*chave:\s*'([^']+)',\s*spreadsheetIdEnv:\s*'([^']+)',\s*range:\s*'([^']+)'\s*\}/g;
  const abas: AbaConfigurada[] = [];
  let item: RegExpExecArray | null;
  while ((item = itemRegex.exec(blocoMatch[1])) !== null) {
    abas.push({ chave: item[1] as ChaveAbaConhecida, spreadsheetIdEnv: item[2], range: item[3] });
  }

  return { abas, agendaRange: agendaMatch[1] };
}

/** Dublê mínimo do cliente do Sheets — só o suficiente para `buscarLinhasAba`. */
function criarClienteFake(
  dados: Map<string, string[][]>,
  chamadas: { spreadsheetId: string; range: string }[]
): sheets_v4.Sheets {
  return {
    spreadsheets: {
      values: {
        get: async ({ spreadsheetId, range }: { spreadsheetId: string; range: string }) => {
          chamadas.push({ spreadsheetId, range });
          return { data: { values: dados.get(`${spreadsheetId}::${range}`) } };
        },
      },
    },
  } as unknown as sheets_v4.Sheets;
}

const ENV_SPREADSHEET_IDS: Record<string, string> = {
  GOOGLE_SHEET_ID_1: 'planilha-1-id',
  GOOGLE_SHEET_ID_2: 'planilha-2-id',
  GOOGLE_SHEET_ID_3: 'planilha-3-id',
};

describe('T-135: isolamento entre a ingestão de leads e o espelho', () => {
  test('ABAS_DE_LEADS e AGENDA_RANGE do worker nunca citam a aba do espelho (@spec:AC-334)', () => {
    const { abas, agendaRange } = extrairListaDeAbasDoWorker();

    expect(abas).toHaveLength(4);
    expect(agendaRange.toLowerCase()).not.toContain('espelho');
    for (const aba of abas) {
      expect(aba.range.toLowerCase()).not.toBe(NOME_ABA_ESPELHO.toLowerCase());
      expect(aba.chave.toLowerCase()).not.toContain('espelho');
    }
  });

  describe('contra Postgres real', () => {
    let pg: PostgresEfemero;
    let db: NodePgDatabase;
    let pool: Pool;
    const empresaMedguia = {
      id: '91000000-0000-0000-0000-000000000001',
      nome: 'MedGuia',
      slug: 'medguia-t135',
    };

    beforeAll(async () => {
      pg = await subirPostgresEfemero();
      pg.aplicarMigrations();
      pool = new Pool({ connectionString: pg.migratorUrl });
      db = drizzle(pool);
      await db.insert(empresas).values(empresaMedguia);
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      pg?.parar();
    });

    test(
      'a aba "Espelho CRM" coexiste com as abas de leads, mas a ingestão nunca a lê, e uma edição manual nela nunca vira lead/card (@spec:AC-333, @spec:AC-334)',
      async () => {
        const { abas: abasConfiguradas, agendaRange } = extrairListaDeAbasDoWorker();
        const spreadsheetIdPlanilha1 = ENV_SPREADSHEET_IDS.GOOGLE_SHEET_ID_1;

        const dadosDaPlanilha = new Map<string, string[][]>();
        const chamadas: { spreadsheetId: string; range: string }[] = [];

        // Abas de leads reais: só sheet1/Página1 tem um lead genuíno; as
        // outras três ficam vazias — basta provar que a leitura delas
        // também acontece, sem exigir fixtures repetidas.
        for (const aba of abasConfiguradas) {
          const spreadsheetId = ENV_SPREADSHEET_IDS[aba.spreadsheetIdEnv];
          if (aba.chave === 'sheet1/Página1') {
            dadosDaPlanilha.set(`${spreadsheetId}::${aba.range}`, [
              ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'data_alteracao', 'is_organic'],
              [
                'meta:genuino-1',
                'Dr. Fulano Genuíno',
                'Cardiologia',
                '+5511988880000',
                'fulano@teste.com',
                'Novos Leads',
                '',
                '',
              ],
            ]);
          } else {
            dadosDaPlanilha.set(`${spreadsheetId}::${aba.range}`, []);
          }
        }
        dadosDaPlanilha.set(`${spreadsheetIdPlanilha1}::${agendaRange}`, [['id', 'data', 'titulo', 'hora']]);

        // A aba do espelho existe na mesma planilha 1, ao lado das abas de
        // leads — e alguém "editou" uma célula nela (AC-333): uma linha
        // que, se fosse lida como lead, criaria um card "Lead Fantasma do
        // Espelho". Ninguém neste teste pede essa aba ao Sheets; ela só
        // está aqui para provar que coexistir não é o mesmo que ser lida.
        dadosDaPlanilha.set(`${spreadsheetIdPlanilha1}::${NOME_ABA_ESPELHO}`, [
          [
            'nome',
            'telefone',
            'e-mail',
            'etapa',
            'responsável',
            'valor',
            'motivo de perda',
            'criado em',
            'atualizado em',
            'dia da cadência',
            'turno',
            'tentativas',
            'próxima ação',
          ],
          ['Lead Fantasma do Espelho', '+5511999998888', 'fantasma@espelho.com', 'Entrada de leads', '', '', '', '', '', '', '', '', ''],
        ]);

        const sheets = criarClienteFake(dadosDaPlanilha, chamadas);

        // Mesmo laço que `construirCiclosOrigem` (src/worker/index.ts) roda
        // no ciclo `import-sheets`: só as abas extraídas do código real,
        // nunca a aba do espelho.
        const abasLidas: AbaParaLer[] = [];
        for (const aba of abasConfiguradas) {
          const spreadsheetId = ENV_SPREADSHEET_IDS[aba.spreadsheetIdEnv];
          const linhas = await buscarLinhasAba(sheets, spreadsheetId, aba.range);
          abasLidas.push({ chave: aba.chave, linhas });
        }
        const agendaLinhas = await buscarLinhasAba(sheets, spreadsheetIdPlanilha1, agendaRange);

        // AC-334: a ingestão nunca pede a aba do espelho ao Sheets.
        expect(chamadas).not.toContainEqual(
          expect.objectContaining({ spreadsheetId: spreadsheetIdPlanilha1, range: NOME_ABA_ESPELHO })
        );
        expect(chamadas).toHaveLength(abasConfiguradas.length + 1); // 4 abas de leads + Agenda, nunca o espelho.

        const contexto: ContextoExecucao = { origem: 'import-sheets-t135', simulacao: false };
        await executarMigracaoSheets(db, contexto, empresaMedguia.id, abasLidas, agendaLinhas);

        // AC-333: a ingestão que roda depois do espelho não traz nada da
        // edição manual para o CRM — só o lead genuíno existe.
        const leadsCriados = await db.select().from(leads);
        expect(leadsCriados).toHaveLength(1);
        expect(leadsCriados[0].nome).toBe('Dr. Fulano Genuíno');
        expect(leadsCriados.some((lead) => lead.nome.includes('Fantasma'))).toBe(false);

        const cardsCriados = await db.select().from(oportunidades);
        expect(cardsCriados).toHaveLength(1);
      },
      30_000
    );
  });
});
