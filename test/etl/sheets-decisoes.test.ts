// Testes de T-125 (fase3-etl-decisoes, US-087): o ETL do Sheets aplica as
// decisões da planilha (T-124) aos leads que cairiam em revisão — cria
// lead/card pela etapa decidida (AC-309), grava a próxima ação de um
// "Recontato" decidido como "Follow de longo prazo" (AC-310), registra
// `ignorar` sem criar nada (AC-311), gera a planilha da fila de revisão
// (AC-307) e fecha a conta do relatório com as decisões aplicadas/ignoradas/
// recusadas (AC-317). Contra Postgres real (mesmo harness de T-108/T-118/
// T-120) porque precisamos provar o card, o evento `migrado_de` e
// `migracao_registros` exatamente como a migração deveria gravá-los.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { lerCsvDecisoes, type LinhaDecisaoBruta } from '../../src/etl/decisoes';
import type { ContextoExecucao } from '../../src/etl/comum';
import { executarMigracaoSheets, type AbaParaLer } from '../../src/etl/sheets/executar';
import { ETAPA_FOLLOW_DE_LONGO_PRAZO, ETAPA_REUNIAO_AGENDADA } from '../../src/etl/sheets/status';
import {
  empresas,
  leads,
  oportunidadeEventos,
  oportunidades,
  whatsappMensagens,
} from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const AGORA = new Date('2026-10-21T12:00:00-03:00');

function cabecalho(): string[] {
  return ['id', 'full name', 'phone_number', 'email', 'lead_status', 'data_alteracao'];
}

function linha(parcial: {
  id: string;
  nome?: string;
  telefone?: string;
  email?: string;
  status?: string;
}): string[] {
  return [
    parcial.id,
    parcial.nome ?? 'Dr. Fulano',
    parcial.telefone ?? '',
    parcial.email ?? '',
    parcial.status ?? 'Novos Leads',
    '',
  ];
}

function aba(linhas: ReturnType<typeof linha>[]): AbaParaLer {
  return { chave: 'sheet3/Página1', linhas: [cabecalho(), ...linhas] };
}

function agendaVazia(): string[][] {
  return [['id', 'data', 'titulo', 'hora']];
}

function linhaDecisao(parcial: Partial<LinhaDecisaoBruta> & { idOrigem: string }): LinhaDecisaoBruta {
  return { etapa: '', proximaAcao: '', valor: '', motivoPerda: '', ignorar: '', ...parcial };
}

describe('T-125: ETL do Sheets aplica as decisões, contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '91000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-t125' };

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
    await db.execute("DELETE FROM migracao_registros WHERE entidade IN ('lead', 'lead_ignorado')");
  });

  test('a simulação gera a planilha da fila de revisão com os leads que ficariam em revisão (@spec:AC-307)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-307', simulacao: true };
    const abas: AbaParaLer[] = [
      aba([linha({ id: 'l:300', nome: 'Dra. Carla', telefone: '11999990000', email: 'carla@exemplo.com', status: 'Recontato' })]),
    ];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), [], AGORA);

    const linhasFila = lerCsvDecisoes(relatorio.csvFilaRevisao);
    expect(linhasFila).toHaveLength(1);
    expect(linhasFila[0].idOrigem).toBe('l:300');
    expect(linhasFila[0].etapa).toBe('');
    expect(linhasFila[0].ignorar).toBe('');
    expect(relatorio.csvFilaRevisao).toContain('Recontato sem data de próxima ação');
  });

  test('decisão de etapa (por nome) cria o lead e o card do Sheets, igual a uma migração automática (@spec:AC-309)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-309', simulacao: false };
    const abas: AbaParaLer[] = [
      aba([linha({ id: 'l:301', nome: 'Dr. João', telefone: '11999991111', email: 'joao@exemplo.com', status: 'Em contato' })]),
    ];
    const decisoes: LinhaDecisaoBruta[] = [linhaDecisao({ idOrigem: 'l:301', etapa: 'Reunião agendada' })];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);

    expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 0, recusadas: 0 });
    expect(relatorio.revisao).toHaveLength(0);

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:301'));
    expect(novoLead).toMatchObject({ empresaId: empresaMedguia.id, nome: 'Dr. João', origem: 'BM MedGuia' });

    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card).toMatchObject({ etapaId: ETAPA_REUNIAO_AGENDADA });

    const [evento] = await db
      .select()
      .from(oportunidadeEventos)
      .where(eq(oportunidadeEventos.oportunidadeId, card.id));
    expect(evento).toMatchObject({
      tipo: 'migrado_de',
      payload: { planilha: 'sheet3', aba: 'Página1', idExterno: 'l:301' },
    });

    // Uma terceira execução (mesma planilha + mesma decisão) não duplica nada
    // — o lead já migrado é só contado como `ignoradas` por idempotência
    // (AC-267), não como uma nova decisão "ignorar" (AC-309, AC-311).
    const terceira = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);
    expect(terceira.decisoes).toEqual({ aplicadas: 0, ignoradas: 0, recusadas: 0 });
    expect(terceira.linhas[0].ignoradas).toBe(1);
    const leadsEncontrados = await db.select().from(leads).where(eq(leads.idExterno, 'l:301'));
    expect(leadsEncontrados).toHaveLength(1);
  });

  test('decisão de etapa pelo número também resolve a revisão (@spec:AC-309)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-309-numero', simulacao: false };
    const abas: AbaParaLer[] = [aba([linha({ id: 'l:302', status: 'Em contato' })])];
    const decisoes: LinhaDecisaoBruta[] = [linhaDecisao({ idOrigem: 'l:302', etapa: String(ETAPA_REUNIAO_AGENDADA) })];

    await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:302'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_REUNIAO_AGENDADA);
  });

  test('"Recontato" decidido como "Follow de longo prazo" ganha a próxima ação, no horário de Brasília (@spec:AC-310)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-310', simulacao: false };
    const abas: AbaParaLer[] = [aba([linha({ id: 'l:303', status: 'Recontato' })])];
    const decisoes: LinhaDecisaoBruta[] = [
      linhaDecisao({ idOrigem: 'l:303', etapa: 'Follow de longo prazo', proximaAcao: '10/11/2026 14:00' }),
    ];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);
    expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 0, recusadas: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:303'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_FOLLOW_DE_LONGO_PRAZO);
    expect(card.proximaAcaoEm?.toISOString()).toBe('2026-11-10T17:00:00.000Z');
  });

  test('"ignorar" tira o lead da fila sem criar nada, e não volta a aparecer numa execução seguinte (@spec:AC-311)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-311', simulacao: false };
    const abas: AbaParaLer[] = [aba([linha({ id: 'l:304', status: 'Em contato' })])];
    const decisoes: LinhaDecisaoBruta[] = [linhaDecisao({ idOrigem: 'l:304', ignorar: 'sim' })];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);
    expect(relatorio.decisoes).toEqual({ aplicadas: 0, ignoradas: 1, recusadas: 0 });
    expect(relatorio.revisao).toHaveLength(0);

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, 'l:304'));
    expect(encontrados).toHaveLength(0);

    // Execução seguinte: sem a decisão (já resolvida) o lead não volta para a fila nem é recriado.
    const segunda = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), [], AGORA);
    expect(segunda.revisao).toHaveLength(0);
    const encontradosDepois = await db.select().from(leads).where(eq(leads.idExterno, 'l:304'));
    expect(encontradosDepois).toHaveLength(0);
  });

  test('o relatório mostra decisões aplicadas, ignoradas e recusadas, e a conta fecha (@spec:AC-317)', async () => {
    const contexto: ContextoExecucao = { origem: 'sheets-dec-317', simulacao: false };
    const abas: AbaParaLer[] = [
      aba([
        linha({ id: 'l:305', status: 'Em contato' }), // decisão aplicada
        linha({ id: 'l:306', status: 'Em contato' }), // decisão ignorar
        linha({ id: 'l:307', status: 'Recontato' }), // decisão recusada (falta próxima ação)
      ]),
    ];
    const decisoes: LinhaDecisaoBruta[] = [
      linhaDecisao({ idOrigem: 'l:305', etapa: 'Reunião agendada' }),
      linhaDecisao({ idOrigem: 'l:306', ignorar: 'sim' }),
      linhaDecisao({ idOrigem: 'l:307', etapa: 'Follow de longo prazo' }),
      linhaDecisao({ idOrigem: 'l:fantasma', etapa: 'Reunião agendada' }),
    ];

    const relatorio = await executarMigracaoSheets(db, contexto, empresaMedguia.id, abas, agendaVazia(), decisoes, AGORA);

    expect(relatorio.decisoes).toEqual({ aplicadas: 1, ignoradas: 1, recusadas: 1 });
    expect(relatorio.revisao).toEqual([
      expect.objectContaining({
        metaId: 'l:307',
        tipo: 'decisao_recusada',
        motivo: expect.stringContaining('próxima ação'),
      }),
    ]);
    expect(relatorio.decisoesForaDaFila).toHaveLength(1);
    expect(relatorio.decisoesForaDaFila[0].idOrigem).toBe('l:fantasma');

    for (const linhaRelatorio of relatorio.linhas) {
      expect(linhaRelatorio.linhasLidas).toBe(
        linhaRelatorio.criadas + linhaRelatorio.fundidas + linhaRelatorio.ignoradas + linhaRelatorio.emRevisao
      );
    }

    const leadsCriados = await db.select().from(leads);
    expect(leadsCriados).toHaveLength(1);
    expect(leadsCriados[0].idExterno).toBe('l:305');
  });
});
