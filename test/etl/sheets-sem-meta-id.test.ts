// T-275 (fase3-etl-sheets, US-075, AC-723): leads sem id da Meta (adicionados à mão no painel do legado) recebem um id
// estável. Contra Postgres real, no mesmo molde de T-120: a constraint única de `migracao_registros` e a idempotência só
// se provam com transação de verdade.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import { executarMigracaoSheets, metaIdSintetico, type AbaParaLer } from '../../src/etl/sheets/executar';
import { empresas, leads, oportunidadeEventos, oportunidades, whatsappMensagens } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-275: leads sem id da Meta no ETL do Sheets', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '90000000-0000-0000-0000-000000000275', nome: 'MedGuia', slug: 'medguia-t275' };
  const cabecalho = ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'data_alteracao', 'is_organic'];
  const linha = (nome: string, telefone: string, status: string): string[] => ['', nome, 'Cardiologia', telefone, '', status, '', ''];
  const aba = (linhas: string[][]): AbaParaLer => ({ chave: 'sheet1/Página1', linhas: [cabecalho, ...linhas] });
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

  test('cada lead sem id vira um lead ou um item da fila, com id próprio, e rodar de novo não duplica nada (@spec:AC-723)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-723', simulacao: false };
    const abas = [
      aba([
        linha('Dra. Ana', '11999990001', 'Sem interesse'),
        linha('Dr. Bruno', '11999990002', 'Sem interesse'),
        linha('Dra. Carla', '11999990003', 'Em contato'),
        linha('Dr. Davi', '11999990004', 'Em contato'),
      ]),
    ];

    const primeira = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());

    // antes da correção, os 4 dividiam a chave vazia: só o primeiro entrava e a fila perdia os demais
    expect(await db.select().from(leads)).toHaveLength(2);
    expect(primeira.linhas[0]).toMatchObject({ linhasLidas: 4, criadas: 2, emRevisao: 2 });
    const idsDaFila = primeira.revisao.map((item) => item.metaId);
    expect(idsDaFila).toHaveLength(2);
    expect(new Set(idsDaFila).size).toBe(2);
    expect(idsDaFila.every((id) => id.startsWith('s:') && id.length > 3)).toBe(true);

    const segunda = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());
    expect(await db.select().from(leads)).toHaveLength(2); // nada duplicado
    expect(segunda.revisao.map((item) => item.metaId).sort()).toEqual([...idsDaFila].sort()); // mesmos ids em toda execução
  });

  test('o id sintético é estável, depende dos dados do lead e ignora maiúsculas e espaços @spec:AC-723', () => {
    const origem = { planilha: 'sheet1', aba: 'sheet1/Página1' };
    const lead = { linha: 0, metaId: '', nome: 'Dra. Ana', especialidade: '', telefone: '5511999990001', email: 'ana@x.com', situacaoBruta: '', camposExtras: {} };

    expect(metaIdSintetico(origem, lead)).toBe(metaIdSintetico(origem, { ...lead, nome: '  DRA. ANA ' }));
    expect(metaIdSintetico(origem, lead)).not.toBe(metaIdSintetico(origem, { ...lead, telefone: '5511999990002' }));
    expect(metaIdSintetico(origem, lead)).not.toBe(metaIdSintetico({ ...origem, aba: 'sheet3/Página1' }, lead));
  });
});
