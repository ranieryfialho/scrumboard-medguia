// Testes de T-079 (fase2c-whatsapp-conversa, US-045): rota GET
// /api/whatsapp/messages contra um Postgres 15 efêmero real. Mesmo molde de
// test/api/whatsapp-send.test.ts e test/repositories/whatsapp-conversa.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'e0000000-0000-0000-0000-00000000000a';
const EMPRESA_B = 'e0000000-0000-0000-0000-00000000000b';

// AC-148: mensagens enviadas e recebidas do mesmo número.
const LEAD_AC148 = 'e0000000-0000-0000-0000-0000000a0148';

// AC-149: mensagens gravadas com e sem o nono dígito.
const LEAD_AC149 = 'e0000000-0000-0000-0000-0000000a0149';

// AC-150: lead com principal + extra, mensagens trocadas com cada um.
const LEAD_AC150 = 'e0000000-0000-0000-0000-0000000a0150';
const TELEFONE_EXTRA_AC150 = 'e0000000-0000-0000-0000-0000000e0150';

// AC-151: mesmo número em A e B; lead de B consultado pela A.
const LEAD_AC151_A = 'e0000000-0000-0000-0000-0000000a0151';
const LEAD_AC151_B = 'e0000000-0000-0000-0000-0000000b0151';

const INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-079: GET /api/whatsapp/messages', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rota: typeof import('../../src/app/api/whatsapp/messages/route');
  let cookieA: string;

  function getHistorico(cookie: string | null, query: string) {
    const request = new NextRequest(`http://localhost/api/whatsapp/messages${query}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    return rota.GET(request);
  }

  function inserirMensagemBruta(opcoes: {
    empresaId: string;
    leadId: string | null;
    numero: string;
    mensagem: string;
    direcao: 'enviada' | 'recebida';
    criadoEm: string;
  }): void {
    const leadIdSql = opcoes.leadId ? `'${opcoes.leadId}'` : 'NULL';
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "whatsapp_mensagens"
         ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "criado_em")
       VALUES
         ('${opcoes.empresaId}', ${leadIdSql}, '${opcoes.numero}', '${opcoes.mensagem}', '${opcoes.direcao}', '${opcoes.criadoEm}')`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Mensagens', 'empresa-a-mensagens'),
         ('${EMPRESA_B}', 'Empresa B Mensagens', 'empresa-b-mensagens');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_AC148}', '${EMPRESA_A}', 'Lead AC148', '+5585911110148'),
         ('${LEAD_AC149}', '${EMPRESA_A}', 'Lead AC149', '+5585911110149'),
         ('${LEAD_AC150}', '${EMPRESA_A}', 'Lead AC150', '+5585911110150'),
         ('${LEAD_AC151_A}', '${EMPRESA_A}', 'Lead AC151 A', '+5585911110151'),
         ('${LEAD_AC151_B}', '${EMPRESA_B}', 'Lead AC151 B', '+5585911110151');

       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo") VALUES
         ('${TELEFONE_EXTRA_AC150}', '${EMPRESA_A}', '${LEAD_AC150}', '5585922220150', 'Recepção');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-messages: ${setup.stderr}`);

    // AC-148: enviada e recebida do mesmo número, sem lead, em ordem.
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585911119148',
      mensagem: 'primeira (recebida)',
      direcao: 'recebida',
      criadoEm: '2026-01-01T10:00:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585911119148',
      mensagem: 'segunda (enviada)',
      direcao: 'enviada',
      criadoEm: '2026-01-01T10:05:00Z',
    });

    // AC-149: mesmo número gravado nas duas grafias (com e sem o nono dígito).
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585999985587',
      mensagem: 'com nono dígito',
      direcao: 'recebida',
      criadoEm: '2026-01-02T10:00:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '558599985587',
      mensagem: 'sem nono dígito',
      direcao: 'enviada',
      criadoEm: '2026-01-02T10:05:00Z',
    });

    // AC-150: mensagens com o principal (ligada por lead_id) e com o extra (sem lead_id, só numero).
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC150,
      numero: '5585911110150',
      mensagem: 'pelo principal',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:00:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585922220150',
      mensagem: 'pelo extra',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:05:00Z',
    });

    // AC-151: mesmo número em A e B.
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585933330151',
      mensagem: 'conversa da empresa A',
      direcao: 'recebida',
      criadoEm: '2026-01-04T10:00:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_B,
      leadId: null,
      numero: '5585933330151',
      mensagem: 'conversa da empresa B',
      direcao: 'recebida',
      criadoEm: '2026-01-04T10:05:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_B,
      leadId: LEAD_AC151_B,
      numero: '5585911110151',
      mensagem: 'lead da empresa B',
      direcao: 'recebida',
      criadoEm: '2026-01-04T10:10:00Z',
    });

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f3',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'operador.msg.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rota = await import('../../src/app/api/whatsapp/messages/route');

    cookieA = await loginComoCookie(auth, 'operador.msg.a@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('sem sessão: 401, nenhuma mensagem é lida @spec:AC-147', async () => {
    const resposta = await getHistorico(null, `?numero=5585911119148`);

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  test('histórico por número traz enviadas e recebidas em ordem cronológica @spec:AC-148', async () => {
    const resposta = await getHistorico(cookieA, `?numero=5585911119148`);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.mensagens).toHaveLength(2);
    expect(corpo.mensagens[0]).toMatchObject({ mensagem: 'primeira (recebida)', direcao: 'recebida' });
    expect(corpo.mensagens[1]).toMatchObject({ mensagem: 'segunda (enviada)', direcao: 'enviada' });
    for (const mensagem of corpo.mensagens) {
      expect(mensagem).toHaveProperty('id');
      expect(mensagem).toHaveProperty('created_at');
      expect(mensagem).toHaveProperty('numero');
      expect(mensagem).toHaveProperty('status');
    }
  });

  test('número é reconhecido com DDI e com a variação do nono dígito @spec:AC-149', async () => {
    const consultas = ['?numero=85999985587', '?numero=5585999985587', '?numero=558599985587'];

    for (const query of consultas) {
      const resposta = await getHistorico(cookieA, query);
      const corpo = await resposta.json();
      expect(resposta.status).toBe(200);
      const textos = corpo.mensagens.map((mensagem: { mensagem: string }) => mensagem.mensagem);
      expect(textos).toEqual(expect.arrayContaining(['com nono dígito', 'sem nono dígito']));
      expect(corpo.mensagens).toHaveLength(2);
    }
  });

  test('histórico por lead reúne todos os telefones do lead sem repetir @spec:AC-150', async () => {
    const resposta = await getHistorico(cookieA, `?leadId=${LEAD_AC150}`);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.mensagens).toHaveLength(2);
    expect(corpo.mensagens[0]).toMatchObject({ mensagem: 'pelo principal' });
    expect(corpo.mensagens[1]).toMatchObject({ mensagem: 'pelo extra' });
  });

  describe('AC-151: histórico nunca mostra mensagens de outra empresa', () => {
    test('por número: só vê as mensagens da própria empresa', async () => {
      const resposta = await getHistorico(cookieA, `?numero=5585933330151`);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.mensagens).toHaveLength(1);
      expect(corpo.mensagens[0]).toMatchObject({ mensagem: 'conversa da empresa A' });
    });

    test('leadId de outra empresa: lista vazia, sem acusar 404', async () => {
      const resposta = await getHistorico(cookieA, `?leadId=${LEAD_AC151_B}`);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.mensagens).toEqual([]);
    });
  });

  describe('AC-152: consulta sem número nem lead é recusada', () => {
    test('sem numero e sem leadId: 400 @spec:AC-152', async () => {
      const resposta = await getHistorico(cookieA, '');
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('REQUISICAO_INVALIDA');
    });

    test('numero sem dígitos: 400 @spec:AC-152', async () => {
      const resposta = await getHistorico(cookieA, '?numero=abc');
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('REQUISICAO_INVALIDA');
    });

    test('leadId que não é UUID: 400 @spec:AC-152', async () => {
      const resposta = await getHistorico(cookieA, '?leadId=nao-e-um-uuid');
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('REQUISICAO_INVALIDA');
    });

    test('leadId inexistente, mas UUID válido: lista vazia, não 400 @spec:AC-152', async () => {
      const resposta = await getHistorico(cookieA, `?leadId=${INEXISTENTE}`);
      expect(resposta.status).toBe(200);
      expect((await resposta.json()).mensagens).toEqual([]);
    });
  });
});
