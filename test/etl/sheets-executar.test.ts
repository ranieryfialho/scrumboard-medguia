// Testes de T-120 (fase3-etl-sheets, US-081): orquestrador do ETL do Sheets
// (src/etl/sheets/executar.ts). Contra Postgres real (mesmo harness de
// T-020/T-108/T-113/T-118/T-119) porque AC-289 (idempotência em reexecução)
// e AC-290 (rollback da simulação) só se provam com transação de verdade —
// um mock não prova rollback nem constraint única.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import {
  ErroRelatorioInconsistente,
  executarMigracaoSheets,
  type AbaParaLer,
} from '../../src/etl/sheets/executar';
import {
  empresas,
  leads,
  motivosPerda,
  oportunidadeEventos,
  oportunidades,
  whatsappMensagens,
} from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-120: orquestrador do ETL do Sheets contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '90000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-t120' };

  function cabecalhoSheet1Pagina1(): string[] {
    return ['id', 'company_name', 'full_name', 'phone_number', 'email', 'lead_status', 'data_alteracao', 'is_organic'];
  }

  function linhaSheet1Pagina1(parcial: {
    id: string;
    nome?: string;
    telefone?: string;
    email?: string;
    status?: string;
    dataAlteracao?: string;
    isOrganic?: string;
  }): string[] {
    return [
      parcial.id,
      parcial.nome ?? 'Dr. Fulano',
      'Cardiologia',
      parcial.telefone ?? '',
      parcial.email ?? '',
      parcial.status ?? 'Novos Leads',
      parcial.dataAlteracao ?? '',
      parcial.isOrganic ?? '',
    ];
  }

  function abaSheet1Pagina1(linhas: ReturnType<typeof linhaSheet1Pagina1>[]): AbaParaLer {
    return { chave: 'sheet1/Página1', linhas: [cabecalhoSheet1Pagina1(), ...linhas] };
  }

  function cabecalhoSheet3Pagina1(): string[] {
    return ['id', 'full name', 'phone_number', 'email', 'lead_status', 'data_alteracao'];
  }

  function linhaSheet3Pagina1(parcial: {
    id: string;
    nome?: string;
    telefone?: string;
    email?: string;
    status?: string;
    dataAlteracao?: string;
  }): string[] {
    return [
      parcial.id,
      parcial.nome ?? 'Dr. Fulano',
      parcial.telefone ?? '',
      parcial.email ?? '',
      parcial.status ?? 'Novos Leads',
      parcial.dataAlteracao ?? '',
    ];
  }

  function abaSheet3Pagina1(linhas: ReturnType<typeof linhaSheet3Pagina1>[]): AbaParaLer {
    return { chave: 'sheet3/Página1', linhas: [cabecalhoSheet3Pagina1(), ...linhas] };
  }

  function agendaVazia(): string[][] {
    return [['id', 'data', 'titulo', 'hora']];
  }

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

  test(
    'o relatório por aba confere lidas = criadas + fundidas + ignoradas + em revisão, mesmo com lead duplicado entre abas (@spec:AC-292)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'sheets-292', simulacao: false };
      const abas: AbaParaLer[] = [
        abaSheet1Pagina1([
          // Mesmo id da Meta em sheet1/Página1 e sheet3/Página1: funde em um
          // só lead; a vencedora é a de data_alteracao mais recente (AC-275/276).
          linhaSheet1Pagina1({ id: 'l:1', status: 'Novos Leads', dataAlteracao: '15/09/2026, 10:00:00' }),
          // Lead de teste e linha em branco: ignoradas na leitura (AC-274).
          linhaSheet1Pagina1({ id: 'l:2', isOrganic: 'true' }),
          ['', '', '', '', '', '', '', ''],
          // Status desconhecido: vai para revisão manual (AC-283).
          linhaSheet1Pagina1({ id: 'l:3', status: 'Status Nunca Visto' }),
        ]),
        abaSheet3Pagina1([
          linhaSheet3Pagina1({ id: 'l:1', status: 'Reunião agendada', dataAlteracao: '16/09/2026, 10:00:00' }),
          linhaSheet3Pagina1({ id: 'l:4', status: 'Novos Leads' }),
        ]),
      ];

      const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());

      expect(relatorio.simulacao).toBe(false);
      const abasDoRelatorio = relatorio.linhas.map((l) => l.aba);
      expect(abasDoRelatorio).toEqual(['sheet1/Página1', 'sheet3/Página1']);

      for (const linha of relatorio.linhas) {
        expect(linha.linhasLidas).toBe(linha.criadas + linha.fundidas + linha.ignoradas + linha.emRevisao);
      }

      const linhaSheet1 = relatorio.linhas.find((l) => l.aba === 'sheet1/Página1')!;
      // sheet1/Página1 tem 4 linhas de dados: l:1 (perde a dedupe para sheet3,
      // então fundida), l:2 e a linha em branco (ignoradas na leitura), l:3
      // (status desconhecido, em revisão).
      expect(linhaSheet1).toMatchObject({ linhasLidas: 4, criadas: 0, fundidas: 1, ignoradas: 2, emRevisao: 1 });

      const linhaSheet3 = relatorio.linhas.find((l) => l.aba === 'sheet3/Página1')!;
      // sheet3/Página1 tem 2 linhas: l:1 vence a dedupe (criada) e l:4 (criada).
      expect(linhaSheet3).toMatchObject({ linhasLidas: 2, criadas: 2, fundidas: 0, ignoradas: 0, emRevisao: 0 });

      expect(relatorio.conflitos).toHaveLength(1);
      expect(relatorio.conflitos[0]).toMatchObject({ metaId: 'l:1', motivoDecisao: 'data_alteracao' });

      expect(relatorio.revisao).toHaveLength(1);
      expect(relatorio.revisao[0]).toMatchObject({ metaId: 'l:3', tipo: 'status_em_revisao' });

      const totalLeads = await db.select().from(leads);
      expect(totalLeads).toHaveLength(2); // l:1 (venceu a dedupe) e l:4; l:3 ficou em revisão, não criou lead.
    }
  );

  test(
    'rodar o ETL de novo sobre as mesmas planilhas não duplica nada (@spec:AC-289)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'sheets-289', simulacao: false };
      const abas: AbaParaLer[] = [
        abaSheet1Pagina1([linhaSheet1Pagina1({ id: 'l:10', status: 'Novos Leads' })]),
        abaSheet3Pagina1([linhaSheet3Pagina1({ id: 'l:11', status: 'Fechado' })]),
      ];

      const primeira = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());
      expect(primeira.linhas.map((l) => l.criadas)).toEqual([1, 1]);

      const segunda = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());
      expect(segunda.linhas.map((l) => l.criadas)).toEqual([0, 0]);
      expect(segunda.linhas.map((l) => l.ignoradas)).toEqual([1, 1]);
      for (const linha of segunda.linhas) {
        expect(linha.linhasLidas).toBe(linha.criadas + linha.fundidas + linha.ignoradas + linha.emRevisao);
      }

      const totalLeads = await db.select().from(leads);
      const totalOportunidades = await db.select().from(oportunidades);
      const totalEventos = await db.select().from(oportunidadeEventos);
      expect(totalLeads).toHaveLength(2);
      expect(totalOportunidades).toHaveLength(2);
      expect(totalEventos).toHaveLength(2);
    }
  );

  test(
    'em modo simulação, o banco continua idêntico e o relatório diz o que seria criado, fundido, ignorado e em revisão (@spec:AC-290)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'sheets-290', simulacao: true };
      const abas: AbaParaLer[] = [
        abaSheet1Pagina1([
          linhaSheet1Pagina1({ id: 'l:20', status: 'Novos Leads', dataAlteracao: '15/09/2026, 10:00:00' }),
        ]),
        abaSheet3Pagina1([
          linhaSheet3Pagina1({ id: 'l:20', status: 'Reunião agendada', dataAlteracao: '16/09/2026, 10:00:00' }),
          linhaSheet3Pagina1({ id: 'l:21', status: 'Status Nunca Visto' }),
        ]),
      ];

      const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia());

      expect(relatorio.simulacao).toBe(true);
      const linhaSheet1 = relatorio.linhas.find((l) => l.aba === 'sheet1/Página1')!;
      expect(linhaSheet1).toMatchObject({ linhasLidas: 1, criadas: 0, fundidas: 1, ignoradas: 0, emRevisao: 0 });
      const linhaSheet3 = relatorio.linhas.find((l) => l.aba === 'sheet3/Página1')!;
      expect(linhaSheet3).toMatchObject({ linhasLidas: 2, criadas: 1, fundidas: 0, ignoradas: 0, emRevisao: 1 });

      const totalLeads = await db.select().from(leads);
      const totalOportunidades = await db.select().from(oportunidades);
      const totalEventos = await db.select().from(oportunidadeEventos);
      const totalRegistrosMigracao = await db.execute("SELECT 1 FROM migracao_registros WHERE entidade = 'lead'");
      expect(totalLeads).toHaveLength(0);
      expect(totalOportunidades).toHaveLength(0);
      expect(totalEventos).toHaveLength(0);
      expect(totalRegistrosMigracao.rows ?? totalRegistrosMigracao).toHaveLength(0);
    }
  );

  test('ErroRelatorioInconsistente existe e carrega a linha que não fechou a conta', () => {
    const erro = new ErroRelatorioInconsistente({
      aba: 'sheet1/Página1',
      linhasLidas: 5,
      criadas: 1,
      fundidas: 1,
      ignoradas: 1,
      emRevisao: 1,
    });
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toContain('sheet1/Página1');
  });
});
