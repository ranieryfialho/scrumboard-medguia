// Testes de T-112 (fase3-etl-supabase, US-072/US-073): migração de
// mensagens de WhatsApp e configurações de empresa
// (src/etl/supabase/mensagens-config.ts). Contra Postgres real (mesmo
// harness de T-108/T-109/T-110/T-111) porque precisamos provar vínculo,
// conversão de valor e idempotência exatamente como a migração deveria
// gravá-los — um mock não prova isso.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import {
  migrarConfiguracoes,
  migrarMensagens,
  type ConfiguracaoLegado,
  type MensagemLegado,
} from '../../src/etl/supabase/mensagens-config';
import { migrarEmpresas } from '../../src/etl/supabase/identidade';
import { migrarLeads, type LeadLegado } from '../../src/etl/supabase/leads';
import {
  empresaConfiguracoes,
  empresas,
  leads,
  migracaoRegistros,
  oportunidadeEventos,
  oportunidades,
  whatsappMensagens,
} from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-112: migração de mensagens de WhatsApp e configurações contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'supabase-legado', simulacao: false };

  const empresaA = { id: '10000000-0000-0000-0000-000000000001', nome: 'Clínica A', slug: 'clinica-a' };

  function mensagem(parcial: Partial<MensagemLegado> & { id: string }): MensagemLegado {
    return {
      empresaId: empresaA.id,
      leadId: null,
      numero: '5511999990000',
      mensagem: 'Olá',
      direcao: 'recebida',
      status: 'entregue',
      evolutionMessageId: null,
      lidaEm: null,
      criadoEm: new Date('2026-01-10T12:00:00Z'),
      ...parcial,
    };
  }

  function configuracao(parcial: Partial<ConfiguracaoLegado> & { id: string }): ConfiguracaoLegado {
    return {
      empresaId: empresaA.id,
      chave: 'evolution_instance_name',
      valor: 'instancia-legado',
      ...parcial,
    };
  }

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
    await db.delete(whatsappMensagens);
    await db.delete(empresaConfiguracoes);
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
    await db.delete(whatsappMensagens);
    await db.delete(empresaConfiguracoes);
    await db.execute(
      "DELETE FROM migracao_registros WHERE entidade IN ('mensagem_whatsapp', 'configuracao_empresa')"
    );
  });

  test('mensagens migram com direção, número, texto, status e horário originais (@spec:AC-263)', async () => {
    const legada = mensagem({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      numero: '5511988887777',
      mensagem: 'Oi, tudo bem?',
      direcao: 'enviada',
      status: 'lida',
      evolutionMessageId: 'evo-123',
      criadoEm: new Date('2025-06-15T09:30:00Z'),
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarMensagens(tx, ctx, [legada]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, semVinculo: 1 });

    const [destino] = await db
      .select()
      .from(whatsappMensagens)
      .where(eq(whatsappMensagens.id, legada.id));

    expect(destino).toMatchObject({
      numero: legada.numero,
      mensagem: legada.mensagem,
      direcao: 'enviada',
      status: 'lida',
      evolutionMessageId: 'evo-123',
    });
    expect(destino.criadoEm.toISOString()).toBe(legada.criadoEm.toISOString());

    const [registro] = await db
      .select()
      .from(migracaoRegistros)
      .where(
        and(eq(migracaoRegistros.origem, contexto.origem), eq(migracaoRegistros.idExterno, legada.id))
      );
    expect(registro).toMatchObject({ entidade: 'mensagem_whatsapp', idDestino: legada.id });
  });

  test('mensagem com lead migrado vincula ao lead novo', async () => {
    const leadLegado = lead({ id: 'bbbbbbbb-0000-0000-0000-000000000001', situacao: 'Novos Leads' });
    await executarEtl(db, contexto, (tx, ctx) => migrarLeads(tx, ctx, [leadLegado]));

    const [leadDestino] = await db.select().from(leads).where(eq(leads.idExterno, leadLegado.id));

    const legada = mensagem({
      id: 'cccccccc-0000-0000-0000-000000000001',
      leadId: leadLegado.id,
    });

    await executarEtl(db, contexto, (tx, ctx) => migrarMensagens(tx, ctx, [legada]));

    const [destino] = await db
      .select()
      .from(whatsappMensagens)
      .where(eq(whatsappMensagens.id, legada.id));

    expect(destino.leadId).toBe(leadDestino.id);
  });

  test('mensagem sem lead_id ou com lead_id inexistente migra sem vínculo e é contada no relatório (@spec:AC-264)', async () => {
    const semLeadId = mensagem({ id: 'dddddddd-0000-0000-0000-000000000001', leadId: null });
    const comLeadInexistente = mensagem({
      id: 'dddddddd-0000-0000-0000-000000000002',
      leadId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) =>
      migrarMensagens(tx, ctx, [semLeadId, comLeadInexistente])
    );

    expect(resultado).toMatchObject({ lidas: 2, criadas: 2, ignoradas: 0, semVinculo: 2 });

    const destino = await db
      .select()
      .from(whatsappMensagens)
      .where(eq(whatsappMensagens.empresaId, empresaA.id));

    for (const linha of destino) {
      expect(linha.leadId).toBeNull();
    }
  });

  test('rodar de novo sobre as mesmas mensagens não duplica nada', async () => {
    const legada = mensagem({ id: 'eeeeeeee-0000-0000-0000-000000000001' });

    await executarEtl(db, contexto, (tx, ctx) => migrarMensagens(tx, ctx, [legada]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarMensagens(tx, ctx, [legada]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1, semVinculo: 0 });

    const destino = await db
      .select()
      .from(whatsappMensagens)
      .where(eq(whatsappMensagens.id, legada.id));
    expect(destino).toHaveLength(1);
  });

  test('configurações migram para a mesma empresa, mesma chave, com o valor convertido para jsonb (@spec:AC-265)', async () => {
    const legada = configuracao({
      id: 'aaaaaaaa-1111-0000-0000-000000000001',
      chave: 'planilha_leads_id',
      valor: 'planilha-abc-123',
    });

    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarConfiguracoes(tx, ctx, [legada]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0 });

    const [destino] = await db
      .select()
      .from(empresaConfiguracoes)
      .where(eq(empresaConfiguracoes.id, legada.id));

    expect(destino).toMatchObject({
      empresaId: empresaA.id,
      chave: 'planilha_leads_id',
      valor: 'planilha-abc-123',
    });
  });

  test('rodar de novo sobre a mesma configuração não duplica nada', async () => {
    const legada = configuracao({ id: 'bbbbbbbb-1111-0000-0000-000000000001' });

    await executarEtl(db, contexto, (tx, ctx) => migrarConfiguracoes(tx, ctx, [legada]));
    const resultado = await executarEtl(db, contexto, (tx, ctx) => migrarConfiguracoes(tx, ctx, [legada]));

    expect(resultado).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 1 });

    const destino = await db
      .select()
      .from(empresaConfiguracoes)
      .where(eq(empresaConfiguracoes.id, legada.id));
    expect(destino).toHaveLength(1);
  });
});
