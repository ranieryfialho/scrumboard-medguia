// T-281 (fase3-ingestao-continua, US-090, AC-730): o ETL do Sheets roda com o papel limitado `crm_app` (o do worker), que o
// isolamento por empresa barra se o ETL não informar a empresa. Contra Postgres real; os outros testes do ETL usam o dono das
// tabelas (`crm_migrator`), que o isolamento não barra, e por isso nunca pegaram isto.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import { executarMigracaoSheets, type AbaParaLer } from '../../src/etl/sheets/executar';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-281: ETL do Sheets como crm_app', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  const EMPRESA = '90000000-0000-0000-0000-000000000281';
  const sql = (texto: string) => {
    const r = pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const cab = ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'data_alteracao', 'is_organic'];
  const linha = (id: string, nome: string, telefone: string, status: string): string[] => [id, nome, 'Cardiologia', telefone, '', status, '', ''];
  const abas: AbaParaLer[] = [
    {
      chave: 'sheet1/Página1',
      linhas: [cab, linha('l:1', 'Dra. Ana', '11999990001', 'Sem interesse'), linha('l:2', 'Dr. Bruno', '11999990002', 'Novos Leads'), linha('l:3', 'Dra. Carla', '11999990003', 'Em contato')],
    },
  ];
  const agendaVazia = (): string[][] => [['id', 'data', 'titulo', 'hora']];

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    sql(`INSERT INTO empresas (id, nome, slug) VALUES ('${EMPRESA}', 'MedGuia', 'medguia-t281');
         INSERT INTO whatsapp_mensagens (empresa_id, lead_id, numero, mensagem, direcao) VALUES ('${EMPRESA}', NULL, '5511999990001', 'Olá', 'recebida');`);
    pool = new Pool({ connectionString: pg.appUrl }); // o papel do worker, sem BYPASSRLS
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('importa leads e cards, liga a mensagem sem lead e não duplica ao rodar de novo, tudo como crm_app (@spec:AC-730)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-730', simulacao: false };

    const primeira = await executarMigracaoSheets(db, contexto, EMPRESA, abas, agendaVazia());

    expect(primeira.linhas[0]).toMatchObject({ linhasLidas: 3, criadas: 2, emRevisao: 1 });
    expect(primeira.vinculoMensagens).toMatchObject({ semLead: 1, vinculadas: 1 });
    expect(sql(`SELECT count(*) FROM leads WHERE empresa_id = '${EMPRESA}'`)).toBe('2');
    expect(sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${EMPRESA}'`)).toBe('2');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE empresa_id = '${EMPRESA}' AND lead_id IS NOT NULL`)).toBe('1');

    const segunda = await executarMigracaoSheets(db, contexto, EMPRESA, abas, agendaVazia());
    expect(segunda.linhas[0]).toMatchObject({ criadas: 0 });
    expect(sql(`SELECT count(*) FROM leads WHERE empresa_id = '${EMPRESA}'`)).toBe('2');
  });
});
