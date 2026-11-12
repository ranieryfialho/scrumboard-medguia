// A data de entrada do lead (`criado_em`) é a `created_time` da planilha, não a
// data da migração — é por ela que os relatórios (KPIs, ASM-069) filtram o
// período. Cobre o ETL novo (src/etl/sheets/leads.ts) e a correção dos cards já
// migrados com a data errada (src/etl/sheets/corrigir-datas.ts). Contra Postgres
// real, como os demais testes do ETL.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import { corrigirDatasEntradaSheets } from '../../src/etl/sheets/corrigir-datas';
import { ORIGEM_ETL_SHEETS, type AbaParaLer } from '../../src/etl/sheets/executar';
import { dataEntradaDoLead, importarLeadsSheets, type LeadParaImportar } from '../../src/etl/sheets/leads';
import type { LeadBruto } from '../../src/etl/sheets/leitor';
import { ETAPA_ENTRADA_DE_LEADS } from '../../src/etl/sheets/status';
import { empresas, leads, oportunidadeEventos, oportunidades } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

function leadBruto(metaId: string, camposExtras: Record<string, string> = {}): LeadBruto {
  return {
    linha: 0,
    metaId,
    nome: 'Lead ' + metaId,
    especialidade: '',
    telefone: '',
    email: '',
    situacaoBruta: '',
    camposExtras,
  };
}

describe('dataEntradaDoLead — lê o created_time da planilha em UTC', () => {
  test('ISO com fuso vira o instante UTC', () => {
    const data = dataEntradaDoLead(leadBruto('l:1', { created_time: '2026-03-10T10:00:00-03:00' }));
    expect(data?.toISOString()).toBe('2026-03-10T13:00:00.000Z');
  });

  test('aceita o cabeçalho "created time" e "data de criacao"', () => {
    expect(dataEntradaDoLead(leadBruto('l:2', { 'created time': '2026-03-10T10:00:00-03:00' }))).toBeInstanceOf(Date);
    expect(dataEntradaDoLead(leadBruto('l:3', { 'data de criacao': '10/03/2026, 10:00:00' }))?.toISOString()).toBe(
      '2026-03-10T13:00:00.000Z'
    );
  });

  test('vazio ou inválido devolve undefined (o banco usa a data da migração)', () => {
    expect(dataEntradaDoLead(leadBruto('l:4'))).toBeUndefined();
    expect(dataEntradaDoLead(leadBruto('l:5', { created_time: 'não é data' }))).toBeUndefined();
  });
});

describe('data de entrada dos leads migrados contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: ORIGEM_ETL_SHEETS, simulacao: false };
  const empresa = { id: '20000000-0000-0000-0000-0000000000a1', nome: 'MedGuia', slug: 'medguia' };

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.delete(empresas);
    await db.insert(empresas).values(empresa);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.execute("DELETE FROM migracao_registros WHERE entidade = 'lead'");
  });

  function importar(lead: LeadBruto) {
    const entrada: LeadParaImportar = {
      lead,
      origem: { planilha: 'sheet1', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS },
    };
    return executarEtl(db, contexto, (tx, ctx) => importarLeadsSheets(tx, ctx, empresa.id, [entrada]));
  }

  async function lerLeadECard(metaId: string) {
    const [lead] = await db.select().from(leads).where(eq(leads.idExterno, metaId));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, lead.id));
    const [evento] = await db.select().from(oportunidadeEventos).where(eq(oportunidadeEventos.oportunidadeId, card.id));
    return { lead, card, evento };
  }

  test('o ETL grava lead e card com a created_time da planilha', async () => {
    await importar(leadBruto('l:2001', { created_time: '2026-03-10T10:00:00-03:00' }));

    const { lead, card, evento } = await lerLeadECard('l:2001');
    expect(lead.criadoEm.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(card.criadoEm.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    // o evento continua marcando quando a migração aconteceu
    expect(evento.ocorridoEm.getTime()).toBeGreaterThan(card.criadoEm.getTime());
  });

  test('sem created_time válido o lead fica com a data da migração', async () => {
    const antes = Date.now();
    await importar(leadBruto('l:2002'));

    const { lead, card } = await lerLeadECard('l:2002');
    expect(lead.criadoEm.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    expect(card.criadoEm.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
  });

  describe('correção dos cards já migrados', () => {
    const CABECALHO = ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'created_time'];

    function aba(linhas: string[][]): AbaParaLer[] {
      return [{ chave: 'sheet1/Página1', linhas: [CABECALHO, ...linhas] }];
    }

    function linha(id: string, createdTime: string): string[] {
      return [id, 'Lead ' + id, 'Cardiologia', '', 'x@exemplo.com', '', createdTime];
    }

    test('devolve a data real ao lead e ao card, sem mexer no histórico', async () => {
      await importar(leadBruto('l:3001')); // como o ETL antigo: sem created_time, grava a data da migração
      const antes = await lerLeadECard('l:3001');

      const relatorio = await corrigirDatasEntradaSheets(
        db,
        { simulacao: false },
        empresa.id,
        aba([linha('l:3001', '2026-02-01T09:30:00-03:00')])
      );

      expect(relatorio).toMatchObject({ lidos: 1, corrigidos: 1, jaCorretos: 0, semData: 0, naoMigrados: 0 });
      const depois = await lerLeadECard('l:3001');
      expect(depois.lead.criadoEm.toISOString()).toBe('2026-02-01T12:30:00.000Z');
      expect(depois.card.criadoEm.toISOString()).toBe('2026-02-01T12:30:00.000Z');
      expect(depois.evento.ocorridoEm.toISOString()).toBe(antes.evento.ocorridoEm.toISOString());
    });

    test('rodar de novo não muda nada', async () => {
      await importar(leadBruto('l:3002'));
      const abas = aba([linha('l:3002', '2026-02-01T09:30:00-03:00')]);
      await corrigirDatasEntradaSheets(db, { simulacao: false }, empresa.id, abas);

      const segunda = await corrigirDatasEntradaSheets(db, { simulacao: false }, empresa.id, abas);
      expect(segunda).toMatchObject({ corrigidos: 0, jaCorretos: 1 });
    });

    test('simulação conta o que mudaria, mas não grava', async () => {
      await importar(leadBruto('l:3003'));
      const antes = await lerLeadECard('l:3003');

      const relatorio = await corrigirDatasEntradaSheets(
        db,
        { simulacao: true },
        empresa.id,
        aba([linha('l:3003', '2026-02-01T09:30:00-03:00')])
      );

      expect(relatorio).toMatchObject({ simulacao: true, corrigidos: 1 });
      const depois = await lerLeadECard('l:3003');
      expect(depois.lead.criadoEm.toISOString()).toBe(antes.lead.criadoEm.toISOString());
      expect(depois.card.criadoEm.toISOString()).toBe(antes.card.criadoEm.toISOString());
    });

    test('data da planilha posterior à gravada não é aplicada (só corrige para trás)', async () => {
      await importar(leadBruto('l:3004'));
      const antes = await lerLeadECard('l:3004');

      const relatorio = await corrigirDatasEntradaSheets(
        db,
        { simulacao: false },
        empresa.id,
        aba([linha('l:3004', '2099-01-01T00:00:00-03:00')])
      );

      expect(relatorio).toMatchObject({ corrigidos: 0, jaCorretos: 1 });
      const depois = await lerLeadECard('l:3004');
      expect(depois.lead.criadoEm.toISOString()).toBe(antes.lead.criadoEm.toISOString());
    });

    test('linha sem data válida ou ainda não migrada é contada e deixada como está', async () => {
      await importar(leadBruto('l:3005'));

      const relatorio = await corrigirDatasEntradaSheets(
        db,
        { simulacao: false },
        empresa.id,
        aba([linha('l:3005', ''), linha('l:3006', '2026-02-01T09:30:00-03:00')])
      );

      expect(relatorio).toMatchObject({ lidos: 2, corrigidos: 0, semData: 1, naoMigrados: 1 });
    });

    test('um card criado depois no CRM (sem evento migrado_de) não é tocado', async () => {
      await importar(leadBruto('l:3007'));
      const { lead, card } = await lerLeadECard('l:3007');
      const [outroCard] = await db
        .insert(oportunidades)
        .values({ empresaId: empresa.id, leadId: lead.id, etapaId: ETAPA_ENTRADA_DE_LEADS })
        .returning();

      await corrigirDatasEntradaSheets(
        db,
        { simulacao: false },
        empresa.id,
        aba([linha('l:3007', '2026-02-01T09:30:00-03:00')])
      );

      const [aposOutro] = await db.select().from(oportunidades).where(eq(oportunidades.id, outroCard.id));
      const [aposCard] = await db.select().from(oportunidades).where(eq(oportunidades.id, card.id));
      expect(aposOutro.criadoEm.toISOString()).toBe(outroCard.criadoEm.toISOString());
      expect(aposCard.criadoEm.toISOString()).toBe('2026-02-01T12:30:00.000Z');
    });
  });
});
