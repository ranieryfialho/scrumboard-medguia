// Testes de T-126 (fase3-etl-decisoes, US-089): os ETLs do Supabase e da LP
// aceitam a mesma planilha de decisões comum (T-124), igual ao Sheets
// (T-125) — a simulação gera a fila de revisão (AC-307), uma decisão de
// etapa com próxima ação futura cria o card em vez de derrubar a transação
// (AC-315, AC-316), e o relatório fecha a conta com as decisões aplicadas,
// ignoradas e recusadas (AC-317). Contra Postgres real (mesmo harness de
// T-108/T-110/T-113/T-122/T-123/T-125) porque precisamos provar o card, o
// evento `migrado_de` e `migracao_registros` exatamente como a migração
// deveria gravá-los — um mock não prova isso.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { lerCsvDecisoes, type LinhaDecisaoBruta } from '../../src/etl/decisoes';
import type { ContextoExecucao } from '../../src/etl/comum';
import { executarMigracaoSupabase, type DadosOrigemEtl } from '../../src/etl/supabase/executar';
import type { LeadLegado } from '../../src/etl/supabase/leads';
import { executarMigracaoLp } from '../../src/etl/lp/executar';
import type { CadastroLpBruto } from '../../src/etl/lp/origem';
import { ETAPA_FOLLOW_DE_LONGO_PRAZO, ETAPA_TESTE_TRIAL } from '../../src/etl/sheets/status';
import { empresas, leads, oportunidadeEventos, oportunidades } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const AGORA = new Date('2026-10-21T12:00:00-03:00');

function linhaDecisao(parcial: Partial<LinhaDecisaoBruta> & { idOrigem: string }): LinhaDecisaoBruta {
  return { etapa: '', proximaAcao: '', valor: '', motivoPerda: '', ignorar: '', ...parcial };
}

function dadosSupabaseMinimos(leadsLegado: LeadLegado[]): DadosOrigemEtl {
  return {
    empresas: [],
    usuarios: [],
    leads: leadsLegado,
    campanhas: [],
    envios: [],
    mensagens: [],
    configuracoes: [],
  };
}

function leadLegado(empresaId: string, parcial: Partial<LeadLegado> & { id: string }): LeadLegado {
  return {
    empresaId,
    nome: 'Lead ' + parcial.id,
    email: null,
    situacao: null,
    origem: null,
    observacoes: null,
    whatsapp: null,
    ...parcial,
  };
}

function cadastroLp(parcial: Partial<CadastroLpBruto> & { id: number | string }): CadastroLpBruto {
  return {
    name: 'Cadastro ' + parcial.id,
    email: null,
    whatsapp: null,
    especialidade: null,
    crm: null,
    anuncio: null,
    status: null,
    observacoes: null,
    created_at: null,
    data_alteracao: null,
    data_fechamento: null,
    termos_aceitos: null,
    progresso_video: null,
    ...parcial,
  };
}

describe('T-126: ETLs do Supabase e da LP aplicam a planilha de decisões comum, contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '92000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-t126' };

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
    await db.insert(empresas).values(empresaMedguia);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.execute("DELETE FROM migracao_registros WHERE entidade IN ('lead', 'lead_ignorado')");
  });

  describe('Supabase', () => {
    test('a simulação gera a planilha da fila de revisão com os leads que ficariam em revisão (@spec:AC-307)', async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-dec-307', simulacao: true };
      const dados = dadosSupabaseMinimos([
        leadLegado(empresaMedguia.id, { id: 'sb:300', nome: 'Dra. Carla', situacao: 'Em contato' }),
      ]);

      const relatorio = await executarMigracaoSupabase(db, contexto, dados, AGORA);

      const linhasFila = lerCsvDecisoes(relatorio.csvFilaRevisao);
      expect(linhasFila).toHaveLength(1);
      expect(linhasFila[0].idOrigem).toBe('sb:300');
      expect(linhasFila[0].etapa).toBe('');
      expect(relatorio.csvFilaRevisao).toContain('situação sem etapa automática');
    });

    test('decisão de "Follow de longo prazo" com próxima ação futura cria o card em vez de derrubar a transação (@spec:AC-315)', async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-dec-315', simulacao: false };
      const dados = dadosSupabaseMinimos([
        leadLegado(empresaMedguia.id, { id: 'sb:301', situacao: 'Em contato' }),
      ]);
      dados.linhasDecisao = [
        linhaDecisao({ idOrigem: 'sb:301', etapa: 'Follow de longo prazo', proximaAcao: '10/11/2026 14:00' }),
      ];

      const relatorio = await executarMigracaoSupabase(db, contexto, dados, AGORA);

      expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 0, recusadas: 0 });
      const leadLinha = relatorio.linhas.find((l) => l.entidade === 'lead');
      expect(leadLinha).toMatchObject({ criadas: 1, emRevisao: 0 });

      const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'sb:301'));
      expect(novoLead).toBeDefined();
      const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
      expect(card.etapaId).toBe(ETAPA_FOLLOW_DE_LONGO_PRAZO);
      expect(card.proximaAcaoEm?.toISOString()).toBe('2026-11-10T17:00:00.000Z');
    });

    test('o relatório do Supabase mostra decisões aplicadas, ignoradas e recusadas, e a conta fecha (@spec:AC-317)', async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-dec-317', simulacao: false };
      const dados = dadosSupabaseMinimos([
        leadLegado(empresaMedguia.id, { id: 'sb:305', situacao: 'Em contato' }), // decisão aplicada
        leadLegado(empresaMedguia.id, { id: 'sb:306', situacao: 'Em contato' }), // decisão ignorar
        leadLegado(empresaMedguia.id, { id: 'sb:307', situacao: 'Em contato' }), // decisão recusada (etapa desconhecida)
      ]);
      dados.linhasDecisao = [
        linhaDecisao({ idOrigem: 'sb:305', etapa: 'Reunião agendada' }),
        linhaDecisao({ idOrigem: 'sb:306', ignorar: 'sim' }),
        linhaDecisao({ idOrigem: 'sb:307', etapa: 'Etapa que não existe' }),
        linhaDecisao({ idOrigem: 'sb:fantasma', etapa: 'Reunião agendada' }),
      ];

      const relatorio = await executarMigracaoSupabase(db, contexto, dados, AGORA);

      expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 1, recusadas: 1 });
      expect(relatorio.decisoesForaDaFila).toHaveLength(1);
      expect(relatorio.decisoesForaDaFila[0].idOrigem).toBe('sb:fantasma');

      for (const linha of relatorio.linhas) {
        expect(linha.lidas).toBe(linha.criadas + linha.ignoradas + linha.emRevisao);
      }

      const leadLinha = relatorio.linhas.find((l) => l.entidade === 'lead')!;
      expect(leadLinha).toMatchObject({ lidas: 3, criadas: 1, ignoradas: 1, emRevisao: 1 });
      expect(relatorio.revisao).toEqual([
        expect.objectContaining({ idExterno: 'sb:307', tipo: 'decisao_recusada' }),
      ]);
    });
  });

  describe('LP', () => {
    test('a simulação gera a planilha da fila de revisão com os cadastros que ficariam em revisão (@spec:AC-307)', async () => {
      const contexto: ContextoExecucao = { origem: 'lp-dec-307', simulacao: true };
      const cadastros = [cadastroLp({ id: 400, name: 'Dra. Ana', status: 'Aguardando Ativação' })];

      const relatorio = await executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length, {}, [], AGORA);

      const linhasFila = lerCsvDecisoes(relatorio.csvFilaRevisao);
      expect(linhasFila).toHaveLength(1);
      expect(linhasFila[0].idOrigem).toBe('400');
      expect(relatorio.csvFilaRevisao).toContain('Aguardando Ativação sem data de próxima ação');
    });

    test('"Teste (Trial)" decidido com próxima ação futura cria o card, e outro marcado ignorar não cria nada (@spec:AC-316)', async () => {
      const contexto: ContextoExecucao = { origem: 'lp-dec-316', simulacao: false };
      const cadastros = [
        cadastroLp({ id: 401, name: 'Dr. Pedro', status: 'Aguardando Ativação' }),
        cadastroLp({ id: 402, name: 'Dra. Ignorada', status: 'Aguardando Ativação' }),
      ];
      const decisoesCsv = [
        linhaDecisao({ idOrigem: '401', etapa: 'Teste (Trial)', proximaAcao: '10/11/2026 14:00' }),
        linhaDecisao({ idOrigem: '402', ignorar: 'sim' }),
      ];

      const relatorio = await executarMigracaoLp(
        db,
        contexto,
        empresaMedguia.id,
        cadastros,
        cadastros.length,
        {},
        decisoesCsv,
        AGORA
      );

      expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 1, recusadas: 0 });
      expect(relatorio).toMatchObject({ lidas: 2, criadas: 1, ignoradas: 1, emRevisao: 0 });

      const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, '401'));
      expect(novoLead).toBeDefined();
      const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
      expect(card.etapaId).toBe(ETAPA_TESTE_TRIAL);
      expect(card.proximaAcaoEm?.toISOString()).toBe('2026-11-10T17:00:00.000Z');

      const leadIgnorado = await db.select().from(leads).where(eq(leads.idExterno, '402'));
      expect(leadIgnorado).toHaveLength(0);
    });

    test('o relatório da LP mostra decisões aplicadas, ignoradas e recusadas, e a conta fecha (@spec:AC-317)', async () => {
      const contexto: ContextoExecucao = { origem: 'lp-dec-317', simulacao: false };
      const cadastros = [
        cadastroLp({ id: 501, status: 'Aguardando Ativação' }), // decisão aplicada
        cadastroLp({ id: 502, status: 'Aguardando Ativação' }), // decisão ignorar
        cadastroLp({ id: 503, status: 'Recontato' }), // decisão recusada (sem próxima ação)
      ];
      const decisoesCsv = [
        linhaDecisao({ idOrigem: '501', etapa: 'Teste (Trial)', proximaAcao: '10/11/2026 14:00' }),
        linhaDecisao({ idOrigem: '502', ignorar: 'sim' }),
        linhaDecisao({ idOrigem: '503', etapa: 'Follow de longo prazo' }),
        linhaDecisao({ idOrigem: 'lp:fantasma', etapa: 'Teste (Trial)' }),
      ];

      const relatorio = await executarMigracaoLp(
        db,
        contexto,
        empresaMedguia.id,
        cadastros,
        cadastros.length,
        {},
        decisoesCsv,
        AGORA
      );

      expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 1, recusadas: 1 });
      expect(relatorio).toMatchObject({ lidas: 3, criadas: 1, ignoradas: 1, emRevisao: 1 });
      expect(relatorio.revisao).toEqual([
        expect.objectContaining({
          idLp: '503',
          tipo: 'decisao_recusada',
          motivo: expect.stringContaining('próxima ação'),
        }),
      ]);
      expect(relatorio.decisoesForaDaFila).toHaveLength(1);
      expect(relatorio.decisoesForaDaFila[0].idOrigem).toBe('lp:fantasma');
    });
  });
});
