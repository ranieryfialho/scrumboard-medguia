// Testes de T-122 (fase3-etl-lp, US-082/US-083/US-084): importação dos
// cadastros da LP como lead + card (src/etl/lp/leads.ts). Contra Postgres
// real (mesmo harness de T-108/T-110/T-118) porque precisamos provar
// dedupe, dados do lead, evento `migrado_de` e `migracao_registros`
// exatamente como a migração deveria gravá-los — um mock não prova isso.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import { ETAPA_ENTRADA_DE_LEADS, ETAPA_PERDIDO, ETAPA_REUNIAO_AGENDADA } from '../../src/etl/sheets/status';
import {
  extrairDadosCadastro,
  importarLeadsLp,
  ORIGEM_COMERCIAL_LP,
} from '../../src/etl/lp/leads';
import type { CadastroLpBruto } from '../../src/etl/lp/origem';
import { empresas, leads, migracaoRegistros, oportunidadeEventos, oportunidades } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

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

describe('T-122: extrairDadosCadastro — dados do cadastro preservados (@spec:AC-298)', () => {
  test('CRM, especialidade, anúncio, aceite dos termos, progresso do vídeo e datas (instante correto)', () => {
    const cadastro = cadastroLp({
      id: 1,
      crm: '123456-SP',
      especialidade: 'Cardiologia',
      anuncio: 'Anúncio Outubro',
      observacoes: 'Quer atendimento à noite',
      termos_aceitos: true,
      progresso_video: 80,
      created_at: '2026-09-10T12:00:00-03:00',
      data_alteracao: '15/09/2026, 18:06:12',
      data_fechamento: '2026-09-20T09:00:00Z',
    });

    const dados = extrairDadosCadastro(cadastro);

    expect(dados).toEqual({
      crm: '123456-SP',
      especialidade: 'Cardiologia',
      anuncio: 'Anúncio Outubro',
      observacoes: 'Quer atendimento à noite',
      termosAceitos: true,
      progressoVideo: 80,
      dataCadastro: '2026-09-10T15:00:00.000Z',
      dataAlteracao: '2026-09-15T21:06:12.000Z',
      dataFechamento: '2026-09-20T09:00:00.000Z',
    });
  });

  test('coluna ausente não aparece no resultado (sem valor inventado)', () => {
    const dados = extrairDadosCadastro(cadastroLp({ id: 2 }));
    expect(dados).toEqual({});
  });
});

describe('T-122: importarLeadsLp contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'supabase-lp', simulacao: false };
  const empresaMedguia = { id: '30000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-lp' };

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
    await db.insert(empresas).values([empresaMedguia]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.execute("DELETE FROM migracao_registros");
  });

  test('cadastro "Novos Leads" vira lead + card em "Entrada de leads", com origem "LP - Aula" (@spec:AC-294)', async () => {
    const cadastro = cadastroLp({
      id: 101,
      name: 'Maria Silva',
      email: 'maria@exemplo.com',
      status: 'Novos Leads',
      observacoes: 'Quer resposta rápida',
      created_at: '2026-09-10T12:00:00-03:00',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );

    expect(resultado).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, emRevisao: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, '101'));
    expect(novoLead).toMatchObject({
      empresaId: empresaMedguia.id,
      nome: 'Maria Silva',
      email: 'maria@exemplo.com',
      origem: ORIGEM_COMERCIAL_LP,
      dados: { observacoes: 'Quer resposta rápida', dataCadastro: '2026-09-10T15:00:00.000Z' },
    });

    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card).toMatchObject({ empresaId: empresaMedguia.id, etapaId: ETAPA_ENTRADA_DE_LEADS });
  });

  test('cadastro sem status também vai para "Entrada de leads" (@spec:AC-294)', async () => {
    const cadastro = cadastroLp({ id: 102, status: null });

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, '102'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_ENTRADA_DE_LEADS);
  });

  test('"Reunião Agendada" e "Sem interesse" seguem o mesmo mapa do Sheets (@spec:AC-295)', async () => {
    const reuniao = cadastroLp({ id: 201, status: 'Reunião Agendada' });
    const semInteresse = cadastroLp({ id: 202, status: 'Sem interesse' });

    await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [reuniao, semInteresse])
    );

    const [leadReuniao] = await db.select().from(leads).where(eq(leads.idExterno, '201'));
    const [cardReuniao] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, leadReuniao.id));
    expect(cardReuniao.etapaId).toBe(ETAPA_REUNIAO_AGENDADA);

    const [leadSemInteresse] = await db.select().from(leads).where(eq(leads.idExterno, '202'));
    const [cardSemInteresse] = await db
      .select()
      .from(oportunidades)
      .where(eq(oportunidades.leadId, leadSemInteresse.id));
    expect(cardSemInteresse.etapaId).toBe(ETAPA_PERDIDO);
    expect(cardSemInteresse.motivoPerdaId).not.toBeNull();
  });

  test('"Recontato" e "Aguardando Ativação" sem data de próxima ação, e status desconhecido, vão para revisão sem criar card (@spec:AC-295)', async () => {
    const recontato = cadastroLp({ id: 203, status: 'Recontato' });
    const aguardandoAtivacao = cadastroLp({ id: 204, status: 'Aguardando Ativação' });
    const desconhecido = cadastroLp({ id: 205, status: 'Em contato' });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [recontato, aguardandoAtivacao, desconhecido])
    );

    expect(resultado).toMatchObject({ lidas: 3, criadas: 0, ignoradas: 0, emRevisao: 3 });
    expect(resultado.revisao).toEqual([
      { idLp: '203', tipo: 'status_em_revisao', motivo: 'Recontato sem data de próxima ação' },
      { idLp: '204', tipo: 'status_em_revisao', motivo: 'Aguardando Ativação sem data de próxima ação' },
      { idLp: '205', tipo: 'status_em_revisao', motivo: 'status desconhecido: "Em contato"' },
    ]);

    const encontrados = await db
      .select()
      .from(leads)
      .where(eq(leads.idExterno, '203'));
    expect(encontrados).toHaveLength(0);
  });

  test('telefone válido com e sem código de país fica em E.164; inválido migra sem telefone e vai para revisão (@spec:AC-296)', async () => {
    const comDdi = cadastroLp({ id: 301, whatsapp: '+5585999999999' });
    const semDdi = cadastroLp({ id: 302, whatsapp: '(85) 98888-8888' });
    const invalido = cadastroLp({ id: 303, whatsapp: '123' });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [comDdi, semDdi, invalido])
    );

    expect(resultado.criadas).toBe(3);
    expect(resultado.revisao).toEqual([
      { idLp: '303', tipo: 'telefone_invalido', motivo: 'WhatsApp não vira telefone válido: "123"' },
    ]);

    const [leadComDdi] = await db.select().from(leads).where(eq(leads.idExterno, '301'));
    expect(leadComDdi.telefoneE164).toBe('+5585999999999');

    const [leadSemDdi] = await db.select().from(leads).where(eq(leads.idExterno, '302'));
    expect(leadSemDdi.telefoneE164).toBe('+5585988888888');

    const [leadInvalido] = await db.select().from(leads).where(eq(leads.idExterno, '303'));
    expect(leadInvalido.telefoneE164).toBeNull();
  });

  test('cada card migrado guarda de onde veio: evento migrado_de e migracao_registros ligam o id da LP ao id novo (@spec:AC-297)', async () => {
    const cadastro = cadastroLp({ id: 401, status: 'Novos Leads' });

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, '401'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    const [evento] = await db
      .select()
      .from(oportunidadeEventos)
      .where(eq(oportunidadeEventos.oportunidadeId, card.id));

    expect(evento).toMatchObject({
      tipo: 'migrado_de',
      payload: { origem: 'supabase-lp', idExterno: '401' },
    });

    const [registro] = await db
      .select()
      .from(migracaoRegistros)
      .where(eq(migracaoRegistros.idExterno, '401'));
    expect(registro).toMatchObject({ origem: 'supabase-lp', entidade: 'lead', idDestino: novoLead.id });
  });

  test('pessoa já existente por e-mail (sem diferenciar maiúsculas) não cria nem altera o lead — vai para revisão (@spec:AC-300)', async () => {
    const [leadExistente] = await db
      .insert(leads)
      .values({ empresaId: empresaMedguia.id, nome: 'Já Existe', email: 'JOAO@exemplo.com' })
      .returning();

    const cadastro = cadastroLp({ id: 501, name: 'João Novo', email: 'joao@exemplo.com', status: 'Novos Leads' });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );

    expect(resultado).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 0, emRevisao: 1 });
    expect(resultado.revisao).toEqual([
      {
        idLp: '501',
        tipo: 'pessoa_existente',
        motivo: `já existe um lead com o mesmo e-mail ou telefone: ${leadExistente.id}`,
        leadExistenteId: leadExistente.id,
      },
    ]);

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, '501'));
    expect(encontrados).toHaveLength(0);

    const [leadIntacto] = await db.select().from(leads).where(eq(leads.id, leadExistente.id));
    expect(leadIntacto.nome).toBe('Já Existe');
  });

  test('pessoa já existente por telefone E.164 também vai para revisão, sem criar nem mesclar (@spec:AC-300)', async () => {
    const [leadExistente] = await db
      .insert(leads)
      .values({ empresaId: empresaMedguia.id, nome: 'Já Existe', telefoneE164: '+5585999999999' })
      .returning();

    const cadastro = cadastroLp({ id: 502, whatsapp: '(85) 99999-9999', status: 'Novos Leads' });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );

    expect(resultado).toMatchObject({ criadas: 0, emRevisao: 1 });
    expect(resultado.revisao[0]).toMatchObject({ tipo: 'pessoa_existente', leadExistenteId: leadExistente.id });

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, '502'));
    expect(encontrados).toHaveLength(0);
  });

  test('decisão com etapaId resolve o item da revisão criando lead e card nessa etapa (@spec:AC-301)', async () => {
    const cadastro = cadastroLp({ id: 601, status: 'Em contato' });

    const primeira = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );
    expect(primeira).toMatchObject({ criadas: 0, emRevisao: 1 });

    const segunda = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro], { '601': { etapaId: ETAPA_REUNIAO_AGENDADA } })
    );
    expect(segunda).toMatchObject({ criadas: 1, emRevisao: 0, ignoradas: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, '601'));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_REUNIAO_AGENDADA);

    const terceira = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro], { '601': { etapaId: ETAPA_REUNIAO_AGENDADA } })
    );
    expect(terceira).toMatchObject({ criadas: 0, ignoradas: 1 });
    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, '601'));
    expect(encontrados).toHaveLength(1);
  });

  test('decisão "ignorar" não cria nada e o cadastro sai da fila de revisão sem duplicar na terceira execução (@spec:AC-301)', async () => {
    const cadastro = cadastroLp({ id: 602, status: 'Em contato' });

    const primeira = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );
    expect(primeira).toMatchObject({ criadas: 0, emRevisao: 1 });

    const segunda = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro], { '602': { ignorar: true } })
    );
    expect(segunda).toMatchObject({ criadas: 0, ignoradas: 1, emRevisao: 0 });

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, '602'));
    expect(encontrados).toHaveLength(0);

    const terceira = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro], { '602': { ignorar: true } })
    );
    expect(terceira).toMatchObject({ criadas: 0, ignoradas: 1, emRevisao: 0 });

    const encontradosDeNovo = await db.select().from(leads).where(eq(leads.idExterno, '602'));
    expect(encontradosDeNovo).toHaveLength(0);
  });

  test('rodar de novo sobre o mesmo idLp não duplica lead nem card', async () => {
    const cadastro = cadastroLp({ id: 701, status: 'Novos Leads' });

    await executarEtl(db, contexto, (tx, ctx) => importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      importarLeadsLp(tx, ctx, empresaMedguia.id, [cadastro])
    );

    expect(resultado).toMatchObject({ criadas: 0, ignoradas: 1 });

    const encontrados = await db.select().from(leads).where(eq(leads.idExterno, '701'));
    expect(encontrados).toHaveLength(1);
  });
});
