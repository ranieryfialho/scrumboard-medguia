// Os checks do WhatsApp: o webhook recebe `messages.update` da Evolution e avança o status da mensagem enviada
// (enviada -> entregue -> lida), contra um Postgres efêmero real. O status só sobe: aviso atrasado nunca desfaz "lida".
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA = 'e0000000-0000-0000-0000-000000000011';
const OUTRA_EMPRESA = 'e0000000-0000-0000-0000-000000000012';
const SEGREDO = 'segredo-status-123';
const LEAD = 'e0000000-0000-0000-0000-00000000b001';
const NUMERO = '5585999985587';

function post(corpo: unknown, empresa = EMPRESA, segredo = SEGREDO): NextRequest {
  return new NextRequest(`http://localhost/api/whatsapp/webhook?empresa_id=${empresa}&secret=${segredo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

describe('webhook messages.update: checks de entregue e lida', () => {
  let pg: PostgresEfemero;
  let rota: typeof import('../../src/app/api/whatsapp/webhook/route');
  let repositorio: typeof import('../../src/repositories/whatsapp');

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA}', 'Empresa Status', 'empresa-status'),
         ('${OUTRA_EMPRESA}', 'Outra Empresa', 'outra-empresa-status');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA}', 'evolution_webhook_secret', '"${SEGREDO}"'::jsonb),
         ('${OUTRA_EMPRESA}', 'evolution_webhook_secret', '"${SEGREDO}"'::jsonb);
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD}', '${EMPRESA}', 'Lead Status', '+${NUMERO}');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);

    process.env.DATABASE_URL = pg.appUrl;
    rota = await import('../../src/app/api/whatsapp/webhook/route');
    repositorio = await import('../../src/repositories/whatsapp');
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    await (getDb() as unknown as { $client: Pool }).$client.end();
    pg?.parar();
  });

  async function enviarMensagem(evolutionMessageId: string): Promise<void> {
    const { getDb } = await import('../../src/db/client');
    await repositorio.registrarMensagemEnviada(getDb(), { empresaId: EMPRESA }, { numero: NUMERO, texto: 'oi', evolutionMessageId });
  }

  function statusDe(evolutionMessageId: string): string {
    const r = pg.psqlComo('crm_migrator', `SELECT "status" FROM "whatsapp_mensagens" WHERE "evolution_message_id" = '${evolutionMessageId}'`);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }

  const atualizacao = (keyId: string, status: string | number) => ({ event: 'messages.update', data: { keyId, status } });

  test('a mensagem enviada nasce com um check ("enviada"), não como "entregue"', async () => {
    await enviarMensagem('evo-st-1');
    expect(statusDe('evo-st-1')).toBe('enviada');
  });

  test('entregue e depois lida: sobe de um check para dois e para dois azuis', async () => {
    await enviarMensagem('evo-st-2');

    expect((await rota.POST(post(atualizacao('evo-st-2', 'DELIVERY_ACK')))).status).toBe(200);
    expect(statusDe('evo-st-2')).toBe('entregue');

    expect((await rota.POST(post(atualizacao('evo-st-2', 'READ')))).status).toBe(200);
    expect(statusDe('evo-st-2')).toBe('lida');
  });

  test('aviso fora de ordem não desfaz: "entregue" atrasado depois de "lida" é ignorado', async () => {
    await enviarMensagem('evo-st-3');
    await rota.POST(post(atualizacao('evo-st-3', 'READ')));
    await rota.POST(post(atualizacao('evo-st-3', 'DELIVERY_ACK')));
    await rota.POST(post(atualizacao('evo-st-3', 'SERVER_ACK')));
    expect(statusDe('evo-st-3')).toBe('lida');
  });

  test('aceita o formato cru do Baileys (update.status numérico) e array de itens', async () => {
    await enviarMensagem('evo-st-4');
    await enviarMensagem('evo-st-5');
    await rota.POST(
      post({
        event: 'MESSAGES_UPDATE',
        data: [
          { key: { id: 'evo-st-4', fromMe: true }, update: { status: 3 } },
          { key: { id: 'evo-st-5', fromMe: true }, update: { status: 4 } },
        ],
      })
    );
    expect(statusDe('evo-st-4')).toBe('entregue');
    expect(statusDe('evo-st-5')).toBe('lida');
  });

  test('o aviso não vira mensagem nova, e id desconhecido ou status de erro não quebram nada', async () => {
    const antes = pg.psqlComo('crm_migrator', 'SELECT count(*) FROM "whatsapp_mensagens"').stdout.trim();
    const r1 = await rota.POST(post({ event: 'messages.update', data: { key: { id: 'nao-existe', fromMe: false, remoteJid: `${NUMERO}@s.whatsapp.net` }, update: { status: 4 } } }));
    const r2 = await rota.POST(post(atualizacao('evo-st-1', 'ERROR')));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(statusDe('evo-st-1')).toBe('enviada');
    expect(pg.psqlComo('crm_migrator', 'SELECT count(*) FROM "whatsapp_mensagens"').stdout.trim()).toBe(antes);
  });

  test('o aviso de outra empresa não mexe na mensagem (isolamento por tenant)', async () => {
    await enviarMensagem('evo-st-6');
    await rota.POST(post(atualizacao('evo-st-6', 'READ'), OUTRA_EMPRESA));
    expect(statusDe('evo-st-6')).toBe('enviada');
  });

  test('sem o segredo certo: 401 e nada muda', async () => {
    await enviarMensagem('evo-st-7');
    const r = await rota.POST(post(atualizacao('evo-st-7', 'READ'), EMPRESA, 'errado'));
    expect(r.status).toBe(401);
    expect(statusDe('evo-st-7')).toBe('enviada');
  });
});
