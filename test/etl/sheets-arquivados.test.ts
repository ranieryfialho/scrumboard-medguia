// T-276 (fase3-etl-sheets, US-077, AC-724): arquivado sem telefone ou com o telefone de um lead que não está arquivado não
// migra; o "Arquivado" perde o desempate sem data para qualquer outro status. Contra Postgres real, no molde de T-120.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import { executarMigracaoSheets, type AbaParaLer } from '../../src/etl/sheets/executar';
import { empresas, leads, oportunidadeEventos, oportunidades, whatsappMensagens } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-276: arquivados no ETL do Sheets', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '90000000-0000-0000-0000-000000000276', nome: 'MedGuia', slug: 'medguia-t276' };
  const cab1 = ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'data_alteracao', 'is_organic'];
  const l1 = (id: string, nome: string, telefone: string, status: string): string[] => [id, nome, 'Cardiologia', telefone, '', status, '', ''];
  const cab3 = ['id', 'full name', 'phone_number', 'email', 'lead_status', 'data_alteracao'];
  const l3 = (id: string, nome: string, telefone: string, status: string): string[] => [id, nome, telefone, '', status, ''];
  const agendaVazia = (): string[][] => [['id', 'data', 'titulo', 'hora']];

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(whatsappMensagens);
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.delete(empresas);
    await db.insert(empresas).values(empresaMedguia);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(whatsappMensagens);
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.execute("DELETE FROM migracao_registros WHERE entidade = 'lead'");
  });

  test('pula o arquivado sem telefone e o que repete o telefone de um lead ativo, e mantém os demais (@spec:AC-724)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-724', simulacao: false };
    const abas: AbaParaLer[] = [
      {
        chave: 'sheet1/Página1',
        linhas: [
          cab1,
          l1('l:a1', 'Dra. Ana', '11999990001', 'Arquivado'), // telefone próprio: entra em Perdido
          l1('l:a2', 'Dr. Bruno', '', 'Arquivado'), // sem telefone: não migra
          l1('l:a3', 'Dra. Carla', '11999990002', 'Arquivado'), // repete o telefone de l:b1: não migra
          l1('l:b1', 'Dr. Davi', '11999990002', 'Sem interesse'), // lead que não está arquivado: migra
          l1('l:c1', 'Dra. Eva', '11999990003', 'Arquivado'), // perde o desempate para a cópia da sheet3
        ],
      },
      { chave: 'sheet3/Página1', linhas: [cab3, l3('l:c1', 'Dra. Eva', '11999990003', 'Sem interesse')] },
    ];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());

    expect(relatorio.arquivadosPulados).toEqual({ semTelefone: 1, duplicadosDeLeadAtivo: 1 });
    const sheet1 = relatorio.linhas.find((linha) => linha.aba === 'sheet1/Página1')!;
    expect(sheet1).toMatchObject({ linhasLidas: 5, criadas: 2, fundidas: 1, ignoradas: 2, emRevisao: 0 });
    const sheet3 = relatorio.linhas.find((linha) => linha.aba === 'sheet3/Página1')!;
    expect(sheet3).toMatchObject({ linhasLidas: 1, criadas: 1, fundidas: 0, ignoradas: 0, emRevisao: 0 });

    // o conflito de l:c1 foi decidido para "Sem interesse", e não para "Arquivado"
    expect(relatorio.conflitos).toHaveLength(1);
    expect(relatorio.conflitos[0]).toMatchObject({ metaId: 'l:c1', situacaoVencedora: 'Sem interesse' });

    // l:a1 (arquivado com telefone próprio), l:b1 e l:c1
    expect(await db.select().from(leads)).toHaveLength(3);
  });
});
