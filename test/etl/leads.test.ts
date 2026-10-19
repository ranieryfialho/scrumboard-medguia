// Testes de T-110 (fase3-etl-supabase, US-070): migração de leads como lead
// + card (src/etl/supabase/leads.ts). Contra Postgres real (mesmo harness de
// T-020/T-108/T-109) porque precisamos provar etapa, motivo, evento
// `migrado_de` e `migracao_registros` exatamente como a migração deveria
// gravá-los — um mock não prova isso.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import {
  ETAPA_ENTRADA_DE_LEADS,
  ETAPA_PERDIDO,
  MOTIVO_DESQUALIFICADO_MIGRACAO,
  migrarLeads,
  type LeadLegado,
} from '../../src/etl/supabase/leads';
import { migrarEmpresas } from '../../src/etl/supabase/identidade';
import {
  empresas,
  leads,
  migracaoRegistros,
  motivosPerda,
  oportunidadeEventos,
  oportunidades,
} from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-110: migração de leads contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'supabase-legado', simulacao: false };

  const empresaA = { id: '10000000-0000-0000-0000-000000000001', nome: 'Clínica A', slug: 'clinica-a' };

  function lead(parcial: Partial<LeadLegado> & { id: string }): LeadLegado {
    return {
      empresaId: empresaA.id,
      nome: 'Lead ' + parcial.id,
      email: null,
      situacao: null,
      origem: null,
      observacoes: null,
      whatsapp: null,
      ...parcial,
    };
  }

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
    await executarEtl(db, contexto, (tx, ctx) => migrarEmpresas(tx, ctx, [empresaA]));
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

  test('lead com situação "Novos Leads" vira lead e card em "Entrada de leads", com nome/email/origem/observações preservados (@spec:AC-256)', async () => {
    const legado = lead({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      nome: 'Maria Silva',
      email: 'maria@exemplo.com',
      situacao: 'Novos Leads',
      origem: 'Facebook',
      observacoes: 'Interessada no plano premium',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, emRevisao: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, legado.id));
    expect(novoLead).toMatchObject({
      nome: 'Maria Silva',
      email: 'maria@exemplo.com',
      origem: 'Facebook',
      dados: { observacoes: 'Interessada no plano premium' },
    });

    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_ENTRADA_DE_LEADS);
  });

  test('lead sem situação também vira card em "Entrada de leads" (@spec:AC-256)', async () => {
    const legado = lead({ id: 'aaaaaaaa-0000-0000-0000-000000000002', situacao: null });

    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, legado.id));
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_ENTRADA_DE_LEADS);
  });

  test('leads "Desqualificado" ficam em "Perdido" com o motivo "Desqualificado (migração)", que existe como motivo de sistema (@spec:AC-257)', async () => {
    const legados = [
      lead({ id: 'bbbbbbbb-0000-0000-0000-000000000001', situacao: 'Desqualificado' }),
      lead({ id: 'bbbbbbbb-0000-0000-0000-000000000002', situacao: 'Desqualificado' }),
      lead({ id: 'bbbbbbbb-0000-0000-0000-000000000003', situacao: 'Desqualificado' }),
    ];

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, legados));
    expect(resultado).toMatchObject({ lidas: 3, criadas: 3, ignoradas: 0, emRevisao: 0 });

    const [motivo] = await db
      .select()
      .from(motivosPerda)
      .where(eq(motivosPerda.nome, MOTIVO_DESQUALIFICADO_MIGRACAO));
    expect(motivo).toMatchObject({ nome: MOTIVO_DESQUALIFICADO_MIGRACAO, eSistemico: true, ativo: true });

    for (const legado of legados) {
      const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, legado.id));
      const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
      expect(card.etapaId).toBe(ETAPA_PERDIDO);
      expect(card.motivoPerdaId).toBe(motivo.id);
    }
  });

  test('rodar de novo sobre os mesmos "Desqualificado" não duplica o motivo sistêmico', async () => {
    const legado = lead({ id: 'bbbbbbbb-0000-0000-0000-000000000004', situacao: 'Desqualificado' });
    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));

    const outroLegado = lead({ id: 'bbbbbbbb-0000-0000-0000-000000000005', situacao: 'Desqualificado' });
    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [outroLegado]));

    const motivos = await db
      .select()
      .from(motivosPerda)
      .where(eq(motivosPerda.nome, MOTIVO_DESQUALIFICADO_MIGRACAO));
    expect(motivos).toHaveLength(1);
  });

  test('cada card migrado guarda o evento `migrado_de` e o registro de migração liga o id do legado ao id novo (@spec:AC-258)', async () => {
    const legado = lead({ id: 'cccccccc-0000-0000-0000-000000000001', situacao: 'Novos Leads' });

    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, legado.id));

    const [evento] = await db
      .select()
      .from(oportunidadeEventos)
      .where(eq(oportunidadeEventos.oportunidadeId, (await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id)))[0].id));
    expect(evento).toMatchObject({
      tipo: 'migrado_de',
      atorTipo: 'migracao',
      payload: { origem: contexto.origem, idExterno: legado.id },
    });

    const [registro] = await db
      .select()
      .from(migracaoRegistros)
      .where(and(eq(migracaoRegistros.origem, contexto.origem), eq(migracaoRegistros.idExterno, legado.id)));
    expect(registro).toMatchObject({ entidade: 'lead', idDestino: novoLead.id });
  });

  test('situação "Em contato" ou desconhecida não migra nem é descartada em silêncio — vai para a fila de revisão com o motivo (@spec:AC-259)', async () => {
    const emContato = lead({ id: 'dddddddd-0000-0000-0000-000000000001', situacao: 'Em contato' });
    const desconhecida = lead({ id: 'dddddddd-0000-0000-0000-000000000002', situacao: 'Situação Esquisita' });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarLeads(tx, ctx, [emContato, desconhecida])
    );

    expect(resultado.criadas).toBe(0);
    expect(resultado.emRevisao).toBe(2);
    expect(resultado.revisao).toHaveLength(2);
    expect(resultado.revisao.every((item) => item.tipo === 'situacao_sem_etapa')).toBe(true);
    expect(resultado.revisao.map((item) => item.idExterno).sort()).toEqual(
      [emContato.id, desconhecida.id].sort()
    );

    const leadsCriados = await db
      .select()
      .from(leads)
      .where(eq(leads.idExterno, emContato.id));
    expect(leadsCriados).toHaveLength(0);
  });

  test('decisão da operação cria o lead e o card na etapa escolhida, e o lead sai da fila sem duplicar (@spec:AC-272)', async () => {
    const emContato = lead({ id: 'eeeeeeee-0000-0000-0000-000000000001', situacao: 'Em contato' });

    const primeiraExecucao = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [emContato]));
    expect(primeiraExecucao.emRevisao).toBe(1);
    expect(primeiraExecucao.criadas).toBe(0);

    const ETAPA_QUALIFICANDO = 5;
    const segundaExecucao = await executarEtl(db, contexto, (tx, ctx) =>
      migrarLeads(tx, ctx, [emContato], [{ idExterno: emContato.id, etapaId: ETAPA_QUALIFICANDO }])
    );

    expect(segundaExecucao).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, emRevisao: 0 });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, emContato.id));
    expect(novoLead).toBeDefined();
    const [card] = await db.select().from(oportunidades).where(eq(oportunidades.leadId, novoLead.id));
    expect(card.etapaId).toBe(ETAPA_QUALIFICANDO);

    // sem duplicar numa terceira execução, e sem reaparecer na fila
    const terceiraExecucao = await executarEtl(db, contexto, (tx, ctx) =>
      migrarLeads(tx, ctx, [emContato], [{ idExterno: emContato.id, etapaId: ETAPA_QUALIFICANDO }])
    );
    expect(terceiraExecucao).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1, emRevisao: 0 });

    const leadsFinal = await db.select().from(leads).where(eq(leads.idExterno, emContato.id));
    expect(leadsFinal).toHaveLength(1);
  });

  test('WhatsApp inválido não bloqueia a migração — lead migra sem telefone e entra na fila de revisão (@spec:AC-260)', async () => {
    const comWhatsappInvalido = lead({
      id: 'ffffffff-0000-0000-0000-000000000001',
      situacao: 'Novos Leads',
      whatsapp: 'não é um número',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [comWhatsappInvalido]));

    expect(resultado.criadas).toBe(1);
    expect(resultado.revisao).toHaveLength(1);
    expect(resultado.revisao[0]).toMatchObject({
      idExterno: comWhatsappInvalido.id,
      tipo: 'whatsapp_invalido',
    });

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, comWhatsappInvalido.id));
    expect(novoLead.telefoneE164).toBeNull();
  });

  test('WhatsApp válido fica no formato internacional com DDI (@spec:AC-260)', async () => {
    const comWhatsappValido = lead({
      id: 'ffffffff-0000-0000-0000-000000000002',
      situacao: 'Novos Leads',
      whatsapp: '(11) 98765-4321',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [comWhatsappValido]));

    expect(resultado.criadas).toBe(1);
    expect(resultado.revisao).toHaveLength(0);

    const [novoLead] = await db.select().from(leads).where(eq(leads.idExterno, comWhatsappValido.id));
    expect(novoLead.telefoneE164).toBe('5511987654321');
  });

  test('rodar de novo sobre o mesmo lead não duplica — fica ignorado', async () => {
    const legado = lead({ id: '99999999-0000-0000-0000-000000000001', situacao: 'Novos Leads' });

    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [legado]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1, emRevisao: 0 });
    const linhas = await db.select().from(leads).where(eq(leads.idExterno, legado.id));
    expect(linhas).toHaveLength(1);
  });
});
