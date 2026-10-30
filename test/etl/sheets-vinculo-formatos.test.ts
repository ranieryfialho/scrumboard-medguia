// T-277 (fase3-etl-sheets, US-080, AC-725): o vínculo de mensagens por telefone ignora o `+` e o nono dígito. Contra Postgres
// real, no mesmo molde de T-119.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { executarEtl, type ContextoExecucao } from '../../src/etl/comum';
import { chaveDeTelefone, vincularMensagensPorTelefone } from '../../src/etl/sheets/agenda-mensagens';
import { empresas, leads, whatsappMensagens } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-277: vínculo de mensagens por telefone em formatos diferentes', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const contexto: ContextoExecucao = { origem: 'sheets-725', simulacao: false };
  const empresaMedguia = { id: '21000000-0000-0000-0000-000000000277', nome: 'MedGuia', slug: 'medguia-t277' };

  const novoLead = async (nome: string, telefoneE164: string) =>
    (await db.insert(leads).values({ empresaId: empresaMedguia.id, nome, telefoneE164 }).returning())[0];
  const novaMensagem = async (numero: string) =>
    (await db.insert(whatsappMensagens).values({ empresaId: empresaMedguia.id, leadId: null, numero, mensagem: 'Olá', direcao: 'recebida' }).returning())[0];
  const vincular = () => executarEtl(db, contexto, (tx) => vincularMensagensPorTelefone(tx, empresaMedguia.id));
  const leadDa = async (mensagemId: string) => (await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.id, mensagemId)))[0].leadId;

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

  test('liga com ou sem `+` e com ou sem o nono dígito, mas não entre DDDs diferentes (@spec:AC-725)', async () => {
    const comMais = await novoLead('Ana', '+5511999990001');
    const comNono = await novoLead('Bia', '+5521987654321');
    const fixo = await novoLead('Caio', '+551133334444');
    const outroDdd = await novoLead('Davi', '+5531988887777');
    await novoLead('Eva', '+393331234567');

    const semMais = await novaMensagem('5511999990001'); // só falta o `+`
    const semNono = await novaMensagem('552187654321'); // falta o `+` e o nono dígito
    const telFixo = await novaMensagem('551133334444');
    const dddDiferente = await novaMensagem('5541988887777'); // mesmos 8 últimos dígitos de Davi, mas DDD 41
    const estrangeiro = await novaMensagem('393331234567');

    const resultado = await vincular();

    expect(resultado).toMatchObject({ semLead: 5, vinculadas: 4, semLeadParaTelefone: 1, telefoneAmbiguo: 0 });
    expect(await leadDa(semMais.id)).toBe(comMais.id);
    expect(await leadDa(semNono.id)).toBe(comNono.id);
    expect(await leadDa(telFixo.id)).toBe(fixo.id);
    expect(await leadDa(estrangeiro.id)).not.toBeNull();
    expect(await leadDa(dddDiferente.id)).toBeNull(); // DDD 41 não é o do Davi (31)
    expect(outroDdd.id).toBeTruthy();
  });

  test('dois leads que cabem no mesmo número continuam ambíguos e sem vínculo (@spec:AC-725)', async () => {
    await novoLead('Fábio', '+5511999990009');
    await novoLead('Gina', '+551199990009'); // o mesmo número, sem o nono dígito
    const mensagem = await novaMensagem('5511999990009');

    const resultado = await vincular();

    expect(resultado).toMatchObject({ semLead: 1, vinculadas: 0, semLeadParaTelefone: 0, telefoneAmbiguo: 1 });
    expect(await leadDa(mensagem.id)).toBeNull();
  });

  test('a chave ignora pontuação e `+`, e só junta números brasileiros pelo DDD e os 8 últimos dígitos @spec:AC-725', () => {
    expect(chaveDeTelefone('+55 (11) 99999-0001')).toBe(chaveDeTelefone('5511999990001'));
    expect(chaveDeTelefone('5511999990001')).toBe(chaveDeTelefone('551199990001'));
    expect(chaveDeTelefone('5511999990001')).not.toBe(chaveDeTelefone('5521999990001'));
    expect(chaveDeTelefone('+393331234567')).toBe('393331234567');
  });
});
