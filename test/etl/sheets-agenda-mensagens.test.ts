// Testes de T-119 (fase3-etl-sheets, US-079/US-080): CSV da aba `Agenda`
// (src/etl/sheets/agenda-mensagens.ts) e vínculo de mensagens de WhatsApp
// aos leads pelo telefone. `lerAgenda`/`gerarCsvAgenda` são puros (testados
// sem banco); `vincularMensagensPorTelefone` precisa de Postgres real (mesmo
// harness de T-020/T-108/T-110/T-118) porque prova o `UPDATE` de
// `whatsapp_mensagens.lead_id` e a ausência de vínculo em empate/zero leads.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import {
  gerarCsvAgenda,
  lerAgenda,
  vincularMensagensPorTelefone,
} from '../../src/etl/sheets/agenda-mensagens';
import { empresas, leads, whatsappMensagens } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-119: lerAgenda — lê a aba Agenda por posição (@spec:AC-286)', () => {
  test('ignora o cabeçalho e lê id, data, título e hora de cada linha', () => {
    const linhas = [
      ['id', 'data', 'titulo', 'hora'],
      ['1', '20/10/2026', 'Reunião com Dr. Felipe', '14:00'],
      ['2', '21/10/2026', 'Follow-up', '09:30'],
    ];

    expect(lerAgenda(linhas)).toEqual([
      { id: '1', data: '20/10/2026', titulo: 'Reunião com Dr. Felipe', hora: '14:00' },
      { id: '2', data: '21/10/2026', titulo: 'Follow-up', hora: '09:30' },
    ]);
  });

  test('linha sem id é ignorada', () => {
    const linhas = [
      ['id', 'data', 'titulo', 'hora'],
      ['', '20/10/2026', '', ''],
      ['3', '22/10/2026', 'Consulta', '10:00'],
    ];

    expect(lerAgenda(linhas)).toEqual([{ id: '3', data: '22/10/2026', titulo: 'Consulta', hora: '10:00' }]);
  });

  test('aba vazia (só cabeçalho) devolve lista vazia', () => {
    expect(lerAgenda([['id', 'data', 'titulo', 'hora']])).toEqual([]);
  });
});

describe('T-119: gerarCsvAgenda — todas as linhas saem em CSV (@spec:AC-286)', () => {
  test('gera uma linha de CSV por evento, com cabeçalho', () => {
    const csv = gerarCsvAgenda([
      { id: '1', data: '20/10/2026', titulo: 'Reunião com Dr. Felipe', hora: '14:00' },
      { id: '2', data: '21/10/2026', titulo: 'Follow-up', hora: '09:30' },
    ]);

    expect(csv).toBe(
      'id,data,titulo,hora\n1,20/10/2026,Reunião com Dr. Felipe,14:00\n2,21/10/2026,Follow-up,09:30\n'
    );
  });

  test('campo com vírgula ou aspas é escapado', () => {
    const csv = gerarCsvAgenda([{ id: '1', data: '20/10/2026', titulo: 'Reunião, "urgente"', hora: '14:00' }]);
    expect(csv).toBe('id,data,titulo,hora\n1,20/10/2026,"Reunião, ""urgente""",14:00\n');
  });

  test('sem eventos, só o cabeçalho sai — e nada é criado no CRM (função nunca chama o banco)', () => {
    expect(gerarCsvAgenda([])).toBe('id,data,titulo,hora\n');
  });
});

describe('T-119: vincularMensagensPorTelefone contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'sheets', simulacao: false };
  const empresaMedguia = { id: '21000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-t119' };

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(whatsappMensagens);
    await db.delete(leads);
    await db.delete(empresas);
    await db.insert(empresas).values([empresaMedguia]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(whatsappMensagens);
    await db.delete(leads);
  });

  test('mensagem sem lead é vinculada quando existe um único lead com o telefone (@spec:AC-287)', async () => {
    const [lead] = await db
      .insert(leads)
      .values({ empresaId: empresaMedguia.id, nome: 'Maria Silva', telefoneE164: '+5511999990001' })
      .returning();

    const [mensagem] = await db
      .insert(whatsappMensagens)
      .values({
        empresaId: empresaMedguia.id,
        leadId: null,
        numero: '+5511999990001',
        mensagem: 'Olá, tudo bem?',
        direcao: 'recebida',
      })
      .returning();

    const resultado = await executarEtl(db, contexto, (tx) =>
      vincularMensagensPorTelefone(tx, empresaMedguia.id)
    );

    expect(resultado).toMatchObject({ semLead: 1, vinculadas: 1, semLeadParaTelefone: 0, telefoneAmbiguo: 0 });

    const [atualizada] = await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.id, mensagem.id));
    expect(atualizada.leadId).toBe(lead.id);
  });

  test('telefone sem nenhum lead continua sem vínculo e é contado (@spec:AC-288)', async () => {
    await db.insert(whatsappMensagens).values({
      empresaId: empresaMedguia.id,
      leadId: null,
      numero: '+5511999990002',
      mensagem: 'Oi',
      direcao: 'recebida',
    });

    const resultado = await executarEtl(db, contexto, (tx) =>
      vincularMensagensPorTelefone(tx, empresaMedguia.id)
    );

    expect(resultado).toMatchObject({ semLead: 1, vinculadas: 0, semLeadParaTelefone: 1, telefoneAmbiguo: 0 });

    const [mensagem] = await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.numero, '+5511999990002'));
    expect(mensagem.leadId).toBeNull();
  });

  test('telefone com mais de um lead continua sem vínculo e é contado separadamente (@spec:AC-288)', async () => {
    await db
      .insert(leads)
      .values([
        { empresaId: empresaMedguia.id, nome: 'Lead A', telefoneE164: '+5511999990003' },
        { empresaId: empresaMedguia.id, nome: 'Lead B', telefoneE164: '+5511999990003' },
      ]);

    await db.insert(whatsappMensagens).values({
      empresaId: empresaMedguia.id,
      leadId: null,
      numero: '+5511999990003',
      mensagem: 'Oi',
      direcao: 'recebida',
    });

    const resultado = await executarEtl(db, contexto, (tx) =>
      vincularMensagensPorTelefone(tx, empresaMedguia.id)
    );

    expect(resultado).toMatchObject({ semLead: 1, vinculadas: 0, semLeadParaTelefone: 0, telefoneAmbiguo: 1 });

    const [mensagem] = await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.numero, '+5511999990003'));
    expect(mensagem.leadId).toBeNull();
  });

  test('mensagem que já tem lead não entra na busca (idempotente em reexecução)', async () => {
    const [leadExistente] = await db
      .insert(leads)
      .values({ empresaId: empresaMedguia.id, nome: 'Lead já vinculado', telefoneE164: '+5511999990004' })
      .returning();
    const [outroLead] = await db
      .insert(leads)
      .values({ empresaId: empresaMedguia.id, nome: 'Outro lead, mesmo telefone depois', telefoneE164: '+5511999990004' })
      .returning();

    await db.insert(whatsappMensagens).values({
      empresaId: empresaMedguia.id,
      leadId: leadExistente.id,
      numero: '+5511999990004',
      mensagem: 'Já vinculada antes',
      direcao: 'recebida',
    });

    const resultado = await executarEtl(db, contexto, (tx) =>
      vincularMensagensPorTelefone(tx, empresaMedguia.id)
    );

    expect(resultado).toMatchObject({ semLead: 0, vinculadas: 0, semLeadParaTelefone: 0, telefoneAmbiguo: 0 });

    const [mensagem] = await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.numero, '+5511999990004'));
    expect(mensagem.leadId).toBe(leadExistente.id);
    expect(mensagem.leadId).not.toBe(outroLead.id);
  });
});
