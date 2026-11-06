// Reações às mensagens do WhatsApp, contra um Postgres efêmero real: o webhook grava, troca e retira a reação do contato (sem criar
// mensagem fantasma), o histórico devolve as reações, e a rota `POST /api/whatsapp/reacao` reage pela Evolution. Sessão e Evolution
// são simuladas (mocks); o banco é de verdade, com RLS.
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA = 'e0000000-0000-0000-0000-000000000021';
const OUTRA = 'e0000000-0000-0000-0000-000000000022';
const SEGREDO = 'segredo-reacoes-123';
const LEAD = 'e0000000-0000-0000-0000-00000000c001';
const NUMERO = '5585999985587';
const JID = `${NUMERO}@s.whatsapp.net`;

const evolucao = vi.hoisted(() => ({ aceita: true, chamadas: [] as { mensagem: unknown; emoji: string }[] }));

vi.mock('../../src/lib/auth/instancia', () => ({
  getAuth: () => ({
    api: { getSession: async ({ headers }: { headers: Headers }) => (headers.get('x-sessao') ? { session: { token: 'tok' } } : null) },
  }),
}));
vi.mock('../../src/lib/auth/tenant', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('../../src/lib/auth/tenant')>();
  return {
    ...original,
    resolverContextoTenant: async () => ({ usuarioId: 'u', empresaId: 'e0000000-0000-0000-0000-000000000021', papel: 'MASTER', isSuperAdmin: false }),
  };
});
vi.mock('../../src/lib/evolution-api', async (importarOriginal) => {
  const original = await importarOriginal<typeof import('../../src/lib/evolution-api')>();
  return {
    ...original,
    sendReaction: async (_config: unknown, mensagem: unknown, emoji: string) => {
      evolucao.chamadas.push({ mensagem, emoji });
      return evolucao.aceita;
    },
  };
});

describe('reações às mensagens do WhatsApp', () => {
  let pg: PostgresEfemero;
  let webhook: typeof import('../../src/app/api/whatsapp/webhook/route');
  let reagir: typeof import('../../src/app/api/whatsapp/reacao/route');
  let repositorio: typeof import('../../src/repositories/whatsapp');
  let getDb: typeof import('../../src/db/client').getDb;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA}', 'Empresa Reacoes', 'empresa-reacoes'),
         ('${OUTRA}', 'Outra Empresa', 'outra-reacoes');
       INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES
         ('${EMPRESA}', 'evolution_webhook_secret', '"${SEGREDO}"'::jsonb),
         ('${EMPRESA}', 'evolution_instance_name', '"instancia-teste"'::jsonb),
         ('${OUTRA}', 'evolution_webhook_secret', '"${SEGREDO}"'::jsonb);
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD}', '${EMPRESA}', 'Lead Reacoes', '+${NUMERO}');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures: ${setup.stderr}`);

    process.env.DATABASE_URL = pg.appUrl;
    webhook = await import('../../src/app/api/whatsapp/webhook/route');
    reagir = await import('../../src/app/api/whatsapp/reacao/route');
    repositorio = await import('../../src/repositories/whatsapp');
    ({ getDb } = await import('../../src/db/client'));
  }, 120_000);

  afterAll(async () => {
    await (getDb() as unknown as { $client: Pool }).$client.end();
    pg?.parar();
  });

  beforeEach(() => {
    evolucao.aceita = true;
    evolucao.chamadas = [];
  });

  const sql = (consulta: string) => {
    const r = pg.psqlComo('crm_migrator', consulta);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };

  function postWebhook(corpo: unknown, empresa = EMPRESA): NextRequest {
    return new NextRequest(`http://localhost/api/whatsapp/webhook?empresa_id=${empresa}&secret=${SEGREDO}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  }

  const reacaoDoContato = (alvo: string, emoji: string, fromMe = false) => ({
    event: 'messages.upsert',
    data: { key: { remoteJid: JID, fromMe, id: `R-${Math.random()}` }, message: { reactionMessage: { key: { id: alvo }, text: emoji } } },
  });

  async function mensagem(evolutionMessageId: string, direcao: 'enviada' | 'recebida' = 'enviada'): Promise<string> {
    if (direcao === 'enviada') {
      return (await repositorio.registrarMensagemEnviada(getDb(), { empresaId: EMPRESA }, { numero: NUMERO, texto: 'oi', evolutionMessageId })).mensagemId;
    }
    return (await repositorio.registrarMensagemRecebida(getDb(), { empresaId: EMPRESA }, { numero: NUMERO, texto: 'olá', evolutionMessageId })).mensagemId!;
  }

  const reacoesDe = async (id: string) => {
    const historico = await repositorio.buscarHistoricoPorLead(getDb(), { empresaId: EMPRESA }, LEAD);
    return historico.find((m) => m.id === id)?.reacoes;
  };

  test('o contato reage: grava, aparece no histórico e não vira mensagem nova', async () => {
    const id = await mensagem('evo-rc-1');
    const antes = sql(`SELECT count(*) FROM "whatsapp_mensagens"`);

    expect((await webhook.POST(postWebhook(reacaoDoContato('evo-rc-1', '👍')))).status).toBe(200);

    expect(await reacoesDe(id)).toEqual([{ autor: 'contato', emoji: '👍' }]);
    expect(sql(`SELECT count(*) FROM "whatsapp_mensagens"`)).toBe(antes);
  });

  test('trocar o emoji substitui a reação anterior; texto vazio retira', async () => {
    const id = await mensagem('evo-rc-2');
    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-2', '👍')));
    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-2', '❤️')));
    expect(await reacoesDe(id)).toEqual([{ autor: 'contato', emoji: '❤️' }]);

    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-2', '')));
    expect(await reacoesDe(id)).toEqual([]);
  });

  test('empresa e contato podem reagir à mesma mensagem, uma reação cada', async () => {
    const id = await mensagem('evo-rc-3', 'recebida');
    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-3', '😂')));
    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-3', '🙏', true))); // a empresa, pelo celular
    const reacoes = (await reacoesDe(id))!;
    expect(reacoes).toHaveLength(2);
    expect(reacoes).toEqual(expect.arrayContaining([{ autor: 'contato', emoji: '😂' }, { autor: 'nos', emoji: '🙏' }]));
  });

  test('reação a mensagem que não está no CRM é ignorada sem erro; de outra empresa não vaza', async () => {
    const id = await mensagem('evo-rc-4');
    expect((await webhook.POST(postWebhook(reacaoDoContato('nao-existe', '👍')))).status).toBe(200);
    // a OUTRA empresa manda uma reação com o id da mensagem desta: não pode atingi-la
    await webhook.POST(postWebhook(reacaoDoContato('evo-rc-4', '👎'), OUTRA));
    expect(await reacoesDe(id)).toEqual([]);
  });

  test('o histórico marca quem pode reagir: só mensagem com id da Evolution', async () => {
    const { mensagemId } = await repositorio.registrarMensagemEnviada(getDb(), { empresaId: EMPRESA }, { numero: NUMERO, texto: 'sem id', evolutionMessageId: null });
    const historico = await repositorio.buscarHistoricoPorLead(getDb(), { empresaId: EMPRESA }, LEAD);
    expect(historico.find((m) => m.id === mensagemId)?.reagivel).toBe(false);
    expect(historico.find((m) => m.mensagem === 'oi')?.reagivel).toBe(true);
  });

  describe('POST /api/whatsapp/reacao', () => {
    function post(corpo: unknown, sessao = true): NextRequest {
      return new NextRequest('http://localhost/api/whatsapp/reacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(sessao ? { 'x-sessao': '1' } : {}) },
        body: JSON.stringify(corpo),
      });
    }

    test('sem sessão: 401 e a Evolution nem é chamada', async () => {
      const id = await mensagem('evo-rc-5');
      expect((await reagir.POST(post({ mensagemId: id, emoji: '👍' }, false))).status).toBe(401);
      expect(evolucao.chamadas).toEqual([]);
    });

    test('reage a mensagem enviada: manda fromMe=true, grava a reação "nos" e devolve 200', async () => {
      const id = await mensagem('evo-rc-6', 'enviada');
      const r = await reagir.POST(post({ mensagemId: id, emoji: '👍' }));
      expect(r.status).toBe(200);
      expect(evolucao.chamadas).toEqual([{ mensagem: { remoteJid: JID, fromMe: true, id: 'evo-rc-6' }, emoji: '👍' }]);
      expect(await reacoesDe(id)).toEqual([{ autor: 'nos', emoji: '👍' }]);
    });

    test('reage a mensagem recebida: manda fromMe=false; emoji vazio retira a reação', async () => {
      const id = await mensagem('evo-rc-7', 'recebida');
      await reagir.POST(post({ mensagemId: id, emoji: '❤️' }));
      expect(evolucao.chamadas[0].mensagem).toMatchObject({ fromMe: false, id: 'evo-rc-7' });
      expect(await reacoesDe(id)).toEqual([{ autor: 'nos', emoji: '❤️' }]);

      expect((await reagir.POST(post({ mensagemId: id, emoji: '' }))).status).toBe(200);
      expect(await reacoesDe(id)).toEqual([]);
    });

    test('a Evolution recusa: 502 e nada é gravado', async () => {
      const id = await mensagem('evo-rc-8');
      evolucao.aceita = false;
      expect((await reagir.POST(post({ mensagemId: id, emoji: '👍' }))).status).toBe(502);
      expect(await reacoesDe(id)).toEqual([]);
    });

    test('corpo inválido: 400 (id que não é uuid, texto que não é emoji, emoji gigante)', async () => {
      const id = await mensagem('evo-rc-9');
      for (const corpo of [{ mensagemId: 'x', emoji: '👍' }, { mensagemId: id, emoji: 'oi' }, { mensagemId: id, emoji: '👍'.repeat(20) }, { mensagemId: id }]) {
        expect((await reagir.POST(post(corpo))).status).toBe(400);
      }
      expect(evolucao.chamadas).toEqual([]);
    });

    test('mensagem inexistente, de outra empresa ou sem id da Evolution: 404', async () => {
      const semId = (await repositorio.registrarMensagemEnviada(getDb(), { empresaId: EMPRESA }, { numero: NUMERO, texto: 'x', evolutionMessageId: null })).mensagemId;
      for (const mensagemId of ['ffffffff-ffff-ffff-ffff-ffffffffffff', semId]) {
        expect((await reagir.POST(post({ mensagemId, emoji: '👍' }))).status).toBe(404);
      }
      expect(evolucao.chamadas).toEqual([]);
    });
  });
});
