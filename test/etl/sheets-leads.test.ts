// Testes de T-118 (fase3-etl-sheets, US-078): importação de leads deduplicados
// das planilhas como lead + card, com origem comercial e evento `migrado_de`
// (src/etl/sheets/leads.ts). Contra Postgres real (mesmo harness de
// T-020/T-108/T-110) porque precisamos provar origem, payload do evento e
// `migracao_registros` exatamente como a migração deveria gravá-los — um
// mock não prova isso.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import { ETAPA_ENTRADA_DE_LEADS, ETAPA_PERDIDO } from '../../src/etl/sheets/status';
import {
  extrairDadosFormulario,
  importarLeadsSheets,
  obterOrigemComercial,
  type LeadParaImportar,
} from '../../src/etl/sheets/leads';
import type { LeadBruto } from '../../src/etl/sheets/leitor';
import { empresas, leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

function leadBruto(parcial: Partial<LeadBruto> & { metaId: string }): LeadBruto {
  return {
    linha: 0,
    nome: 'Lead ' + parcial.metaId,
    especialidade: '',
    telefone: '',
    email: '',
    situacaoBruta: '',
    camposExtras: {},
    ...parcial,
  };
}

describe('T-118: obterOrigemComercial — a origem vem da planilha/aba (@spec:AC-285)', () => {
  test('sheet1/Página1 e sheet3/Página1 são "BM MedGuia"', () => {
    expect(obterOrigemComercial({ planilha: 'sheet1', aba: 'Página1' })).toBe('BM MedGuia');
    expect(obterOrigemComercial({ planilha: 'sheet3', aba: 'Página1' })).toBe('BM MedGuia');
  });

  test('sheet1/Página2 e sheet2/Página1 são "BM Dr. Felipe"', () => {
    expect(obterOrigemComercial({ planilha: 'sheet1', aba: 'Página2' })).toBe('BM Dr. Felipe');
    expect(obterOrigemComercial({ planilha: 'sheet2', aba: 'Página1' })).toBe('BM Dr. Felipe');
  });

  test('planilha/aba fora do mapa não inventa origem', () => {
    expect(obterOrigemComercial({ planilha: 'sheet9', aba: 'Página9' })).toBeUndefined();
  });
});

describe('T-118: extrairDadosFormulario — respostas do formulário e observações (@spec:AC-284)', () => {
  test('especialidade, CRM, anúncio, campanha, formulário, plataforma e observações são extraídos', () => {
    const lead = leadBruto({
      metaId: 'l:1',
      especialidade: 'Cardiologia',
      camposExtras: {
        'qual_o_numero_do_seu_crm?': '123456-SP',
        'ad_name': 'Anúncio Outubro',
        'campaign_name': 'Campanha Q4',
        'form_name': 'Formulário Clínicas',
        'platform': 'Instagram',
        'observacoes': 'Quer atendimento à noite',
      },
    });

    const dados = extrairDadosFormulario(lead);

    expect(dados).toEqual({
      especialidade: 'Cardiologia',
      crm: '123456-SP',
      anuncio: 'Anúncio Outubro',
      campanha: 'Campanha Q4',
      formulario: 'Formulário Clínicas',
      plataforma: 'Instagram',
      observacoes: 'Quer atendimento à noite',
    });
  });

  test('coluna ausente não aparece no resultado (sem valor inventado)', () => {
    const lead = leadBruto({ metaId: 'l:2' });
    const dados = extrairDadosFormulario(lead);
    expect(dados).toEqual({ especialidade: undefined });
  });

  test('com decisão "Contrato (Ganho)", a dataFechamento entra já normalizada (AC-280)', () => {
    const lead = leadBruto({ metaId: 'l:3' });
    const dados = extrairDadosFormulario(lead, {
      tipo: 'etapa',
      etapaId: 15,
      dataFechamento: '15/09/2026, 18:06:12',
    });
    expect(dados.dataFechamento).toBe('2026-09-15T21:06:12.000Z');
  });
});

describe('T-118: importarLeadsSheets contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'sheets', simulacao: false };
  const empresaMedguia = { id: '20000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia' };
  const outraEmpresa = { id: '20000000-0000-0000-0000-000000000002', nome: 'Outra', slug: 'outra' };

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
    await db.insert(empresas).values([empresaMedguia, outraEmpresa]);
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

  test('lead da aba sheet1/Página1 vira lead + card com origem "BM MedGuia", dados do formulário e evento migrado_de (@spec:AC-284, @spec:AC-285)', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({
        metaId: 'l:1001',
        nome: 'Maria Silva',
        especialidade: 'Dermatologia',
        email: 'maria@exemplo.com',
        camposExtras: { observacoes: 'Quer resposta rápida' },
      }),
      origem: { planilha: 'sheet1', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS },
    };

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada])
    );

    expect(resultado).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, emRevisao: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:1001'));
    expect(novoLead).toMatchObject({
      empresaId: empresaMedguia.id,
      nome: 'Maria Silva',
      email: 'maria@exemplo.com',
      origem: 'BM MedGuia',
      dados: { especialidade: 'Dermatologia', observacoes: 'Quer resposta rápida' },
    });

    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card).toMatchObject({ empresaId: empresaMedguia.id, etapaId: ETAPA_ENTRADA_DE_LEADS });

    const [evento] = await db
      .select()
      .from(oportunidadeEventos)
      .where(eq(oportunidadeEventos.oportunidadeId, card.id));
    expect(evento).toMatchObject({
      empresaId: empresaMedguia.id,
      tipo: 'migrado_de',
      payload: { planilha: 'sheet1', aba: 'Página1', idExterno: 'l:1001' },
    });
  });

  test('lead da aba sheet2/Página1 fica com origem "BM Dr. Felipe" (@spec:AC-285)', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({ metaId: 'l:1002' }),
      origem: { planilha: 'sheet2', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS },
    };

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:1002'));
    expect(novoLead.origem).toBe('BM Dr. Felipe');
  });

  test('lead com decisão de revisão não cria lead nem card (@spec:AC-282, @spec:AC-283)', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({ metaId: 'l:1003' }),
      origem: { planilha: 'sheet1', aba: 'Página1' },
      decisao: { tipo: 'revisao', motivo: 'status desconhecido: "Em contato"' },
    };

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada])
    );

    expect(resultado).toMatchObject({
      lidas: 1,
      criadas: 0,
      ignoradas: 0,
      emRevisao: 1,
      revisao: [{ metaId: 'l:1003', tipo: 'status_em_revisao', motivo: 'status desconhecido: "Em contato"' }],
    });

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, 'l:1003'));
    expect(encontrados).toHaveLength(0);
  });

  test('lead "Desqualificado" ganha motivo de perda sistêmico ligado ao card (@spec:AC-281)', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({ metaId: 'l:1004' }),
      origem: { planilha: 'sheet1', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_PERDIDO, motivoPerdaNome: 'Desqualificado (migração)' },
    };

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada]));

    const [motivo] = await db
      .select()
      .from(motivosPerda)
      .where(eq(motivosPerda.nome, 'Desqualificado (migração)'));
    expect(motivo).toMatchObject({ eSistemico: true, ativo: true });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:1004'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.motivoPerdaId).toBe(motivo.id);
  });

  test('tudo criado por este ETL pertence à empresa dona das planilhas, nunca a outra (@spec:AC-293)', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({ metaId: 'l:1005' }),
      origem: { planilha: 'sheet3', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS },
    };

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, 'l:1005'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    const [evento] = await db
      .select()
      .from(oportunidadeEventos)
      .where(eq(oportunidadeEventos.oportunidadeId, card.id));

    expect(novoLead.empresaId).toBe(empresaMedguia.id);
    expect(card.empresaId).toBe(empresaMedguia.id);
    expect(evento.empresaId).toBe(empresaMedguia.id);
    expect(novoLead.empresaId).not.toBe(outraEmpresa.id);
  });

  test('rodar de novo sobre o mesmo metaId não duplica lead nem card', async () => {
    const entrada: LeadParaImportar = {
      lead: leadBruto({ metaId: 'l:1006' }),
      origem: { planilha: 'sheet1', aba: 'Página1' },
      decisao: { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS },
    };

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsSheets(tx, ctx, empresaMedguia.id, [entrada])
    );

    expect(resultado).toMatchObject({ criadas: 0, ignoradas: 1 });

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, 'l:1006'));
    expect(encontrados).toHaveLength(1);
  });
});
