// Testes de T-080 (fase2c-whatsapp-conversa, US-046): rotas GET
// /api/whatsapp/unread e POST /api/whatsapp/lidas contra um Postgres 15
// efêmero real. Mesmo molde de test/api/whatsapp-messages.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'f0000000-0000-0000-0000-00000000000a';
const EMPRESA_B = 'f0000000-0000-0000-0000-00000000000b';

// AC-153: mensagens recebidas antigas, já marcadas lidas pela migration (backfill).
const LEAD_AC153 = 'f0000000-0000-0000-0000-0000000a0153';

// AC-154: duas conversas de lead não lidas, um número avulso não lido, mais enviadas e já lidas.
const LEAD_AC154_1 = 'f0000000-0000-0000-0000-0000000a0154';
const LEAD_AC154_2 = 'f0000000-0000-0000-0000-0000000b0154';

// AC-155: lead com não lidas no principal e no extra, número avulso com as duas grafias.
const LEAD_AC155 = 'f0000000-0000-0000-0000-0000000a0155';
const TELEFONE_EXTRA_AC155 = 'f0000000-0000-0000-0000-0000000e0155';

// AC-157/AC-158: marcar como lida (por leadId e por número avulso) e idempotência.
const LEAD_AC157 = 'f0000000-0000-0000-0000-0000000a0157';
const LEAD_AC158_OUTRO = 'f0000000-0000-0000-0000-0000000a0158';

// AC-159: conversa já lida que recebe mensagem nova.
const LEAD_AC159 = 'f0000000-0000-0000-0000-0000000a0159';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-080: GET /api/whatsapp/unread e POST /api/whatsapp/lidas', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rotaUnread: typeof import('../../src/app/api/whatsapp/unread/route');
  let rotaLidas: typeof import('../../src/app/api/whatsapp/lidas/route');
  let cookieA: string;
  let cookieB: string;

  function getUnread(cookie: string | null) {
    const request = new NextRequest('http://localhost/api/whatsapp/unread', {
      headers: cookie ? { Cookie: cookie } : {},
    });
    return rotaUnread.GET(request);
  }

  function postLidas(cookie: string | null, corpo: unknown) {
    const request = new NextRequest('http://localhost/api/whatsapp/lidas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return rotaLidas.POST(request);
  }

  function inserirMensagemBruta(opcoes: {
    empresaId: string;
    leadId: string | null;
    numero: string;
    mensagem: string;
    direcao: 'enviada' | 'recebida';
    criadoEm: string;
    lidaEm?: string | null;
  }): void {
    const leadIdSql = opcoes.leadId ? `'${opcoes.leadId}'` : 'NULL';
    const lidaEmSql = opcoes.lidaEm === undefined ? 'NULL' : opcoes.lidaEm === null ? 'NULL' : `'${opcoes.lidaEm}'`;
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "whatsapp_mensagens"
         ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "criado_em", "lida_em")
       VALUES
         ('${opcoes.empresaId}', ${leadIdSql}, '${opcoes.numero}', '${opcoes.mensagem}', '${opcoes.direcao}', '${opcoes.criadoEm}', ${lidaEmSql})`
    );
    if (resultado.status !== 0) throw new Error(resultado.stderr);
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Não Lidas', 'empresa-a-nao-lidas'),
         ('${EMPRESA_B}', 'Empresa B Não Lidas', 'empresa-b-nao-lidas');

       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_AC153}', '${EMPRESA_A}', 'Lead AC153', '+5585911110153'),
         ('${LEAD_AC154_1}', '${EMPRESA_A}', 'Lead AC154 1', '+5585911110154'),
         ('${LEAD_AC154_2}', '${EMPRESA_B}', 'Lead AC154 2', '+5585911110254'),
         ('${LEAD_AC155}', '${EMPRESA_A}', 'Lead AC155', '+5585911110155'),
         ('${LEAD_AC157}', '${EMPRESA_A}', 'Lead AC157', '+5585911110157'),
         ('${LEAD_AC158_OUTRO}', '${EMPRESA_A}', 'Lead AC158 Outro', '+5585911110158'),
         ('${LEAD_AC159}', '${EMPRESA_A}', 'Lead AC159', '+5585911110159');

       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo") VALUES
         ('${TELEFONE_EXTRA_AC155}', '${EMPRESA_A}', '${LEAD_AC155}', '5585922220155', 'Recepção');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de whatsapp-nao-lidas: ${setup.stderr}`);

    // AC-153: recebida "antiga" já marcada lida (simulando o backfill da migration 0009).
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC153,
      numero: '5585911110153',
      mensagem: 'mensagem antiga',
      direcao: 'recebida',
      criadoEm: '2025-01-01T10:00:00Z',
      lidaEm: '2025-01-01T10:00:00Z',
    });

    // AC-154: duas conversas não lidas (lead A154_1 e número avulso), mais enviada e já lida (ruído).
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC154_1,
      numero: '5585911110154',
      mensagem: 'não lida do lead 154',
      direcao: 'recebida',
      criadoEm: '2026-01-01T10:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585933330154',
      mensagem: 'não lida do número avulso',
      direcao: 'recebida',
      criadoEm: '2026-01-01T11:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC154_1,
      numero: '5585911110154',
      mensagem: 'enviada (não conta)',
      direcao: 'enviada',
      criadoEm: '2026-01-01T10:05:00Z',
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC154_1,
      numero: '5585911110154',
      mensagem: 'recebida já lida (não conta)',
      direcao: 'recebida',
      criadoEm: '2026-01-01T09:00:00Z',
      lidaEm: '2026-01-01T09:30:00Z',
    });

    // AC-155: lead com não lidas no principal e no extra; número avulso com as duas grafias do nono dígito.
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC155,
      numero: '5585911110155',
      mensagem: 'pelo principal',
      direcao: 'recebida',
      criadoEm: '2026-01-02T10:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC155,
      numero: '5585922220155',
      mensagem: 'pelo extra',
      direcao: 'recebida',
      criadoEm: '2026-01-02T10:05:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585999985588',
      mensagem: 'avulso com nono dígito',
      direcao: 'recebida',
      criadoEm: '2026-01-02T11:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '558599985588',
      mensagem: 'avulso sem nono dígito',
      direcao: 'recebida',
      criadoEm: '2026-01-02T11:05:00Z',
      lidaEm: null,
    });

    // AC-157/AC-158: lead com não lidas (marcar como lida) e outra conversa que não deve ser tocada.
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC157,
      numero: '5585911110157',
      mensagem: 'para marcar como lida',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC158_OUTRO,
      numero: '5585911110158',
      mensagem: 'outra conversa (não deve mudar)',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:00:00Z',
      lidaEm: null,
    });
    // mesmo número avulso de AC-158 em outra empresa — não deve ser tocado.
    inserirMensagemBruta({
      empresaId: EMPRESA_B,
      leadId: null,
      numero: '5585900000158',
      mensagem: 'mesma empresa b, não deve mudar',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:00:00Z',
      lidaEm: null,
    });
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: null,
      numero: '5585900000158',
      mensagem: 'avulso empresa a para marcar',
      direcao: 'recebida',
      criadoEm: '2026-01-03T10:00:00Z',
      lidaEm: null,
    });

    // AC-159: conversa já lida — a mensagem nova chega via chamada direta ao repositório (simulando o webhook).
    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC159,
      numero: '5585911110159',
      mensagem: 'já lida antes',
      direcao: 'recebida',
      criadoEm: '2026-01-04T10:00:00Z',
      lidaEm: '2026-01-04T10:05:00Z',
    });

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f4',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'operador.lidas.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);

    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f5',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteB = await convidarUsuario(db, atorMasterB, { email: 'operador.lidas.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rotaUnread = await import('../../src/app/api/whatsapp/unread/route');
    rotaLidas = await import('../../src/app/api/whatsapp/lidas/route');

    cookieA = await loginComoCookie(auth, 'operador.lidas.a@teste.com', SENHA);
    cookieB = await loginComoCookie(auth, 'operador.lidas.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('sem sessão: GET /unread devolve 401 @spec:AC-156', async () => {
    const resposta = await getUnread(null);
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  test('sem sessão: POST /lidas devolve 401 @spec:AC-156', async () => {
    const resposta = await postLidas(null, { leadId: LEAD_AC157 });
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  test('mensagens antigas (backfill) não entram em /unread @spec:AC-153', async () => {
    const resposta = await getUnread(cookieA);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    const conversaAntiga = corpo.conversas.find((c: { leadId: string | null }) => c.leadId === LEAD_AC153);
    expect(conversaAntiga).toBeUndefined();
  });

  test('/unread lista só recebidas não lidas, por conversa @spec:AC-154', async () => {
    const resposta = await getUnread(cookieA);
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);

    const doLead = corpo.conversas.find((c: { leadId: string | null }) => c.leadId === LEAD_AC154_1);
    expect(doLead).toMatchObject({ leadId: LEAD_AC154_1, count: 1, lastMessage: 'não lida do lead 154' });

    const doAvulso = corpo.conversas.find((c: { numero: string }) => c.numero === '5585933330154');
    expect(doAvulso).toMatchObject({ leadId: null, count: 1, lastMessage: 'não lida do número avulso' });
  });

  test('/unread vem da mais recente para a mais antiga @spec:AC-154', async () => {
    const resposta = await getUnread(cookieA);
    const corpo = await resposta.json();

    const indiceLead154 = corpo.conversas.findIndex((c: { leadId: string | null }) => c.leadId === LEAD_AC154_1);
    const indiceAvulso154 = corpo.conversas.findIndex((c: { numero: string }) => c.numero === '5585933330154');
    expect(indiceAvulso154).toBeLessThan(indiceLead154);
  });

  test('telefones diferentes do mesmo lead contam como uma conversa só @spec:AC-155', async () => {
    const resposta = await getUnread(cookieA);
    const corpo = await resposta.json();

    const conversasDoLead = corpo.conversas.filter((c: { leadId: string | null }) => c.leadId === LEAD_AC155);
    expect(conversasDoLead).toHaveLength(1);
    expect(conversasDoLead[0].count).toBe(2);

    const conversasAvulsas = corpo.conversas.filter((c: { numero: string }) =>
      ['5585999985588', '558599985588'].includes(c.numero)
    );
    expect(conversasAvulsas).toHaveLength(1);
    expect(conversasAvulsas[0].count).toBe(2);
  });

  test('abrir a conversa por leadId marca as recebidas como lidas e some de /unread @spec:AC-157', async () => {
    const antes = await (await getUnread(cookieA)).json();
    expect(antes.conversas.some((c: { leadId: string | null }) => c.leadId === LEAD_AC157)).toBe(true);

    const resposta = await postLidas(cookieA, { leadId: LEAD_AC157 });
    const corpo = await resposta.json();
    expect(resposta.status).toBe(200);
    expect(corpo.marcadas).toBe(1);

    const depois = await (await getUnread(cookieA)).json();
    expect(depois.conversas.some((c: { leadId: string | null }) => c.leadId === LEAD_AC157)).toBe(false);
  });

  test('abrir a conversa por número marca as recebidas como lidas e some de /unread @spec:AC-157', async () => {
    const resposta = await postLidas(cookieA, { numero: '5585900000158' });
    const corpo = await resposta.json();
    expect(resposta.status).toBe(200);
    expect(corpo.marcadas).toBe(1);

    const depois = await (await getUnread(cookieA)).json();
    expect(depois.conversas.some((c: { numero: string }) => c.numero === '5585900000158')).toBe(false);
  });

  describe('AC-158: marcar como lida é idempotente e isolado', () => {
    test('segunda chamada seguida devolve 0, outra conversa e outra empresa continuam intactas', async () => {
      const segunda = await postLidas(cookieA, { leadId: LEAD_AC157 });
      expect((await segunda.json()).marcadas).toBe(0);

      const depois = await (await getUnread(cookieA)).json();
      const outraConversa = depois.conversas.find((c: { leadId: string | null }) => c.leadId === LEAD_AC158_OUTRO);
      expect(outraConversa).toMatchObject({ leadId: LEAD_AC158_OUTRO, count: 1 });

      const depoisB = await (await getUnread(cookieB)).json();
      const conversaEmpresaB = depoisB.conversas.find((c: { numero: string }) => c.numero === '5585900000158');
      expect(conversaEmpresaB).toMatchObject({ numero: '5585900000158', count: 1 });
    });
  });

  test('mensagem nova depois de lida volta a contar @spec:AC-159', async () => {
    const antes = await (await getUnread(cookieA)).json();
    expect(antes.conversas.some((c: { leadId: string | null }) => c.leadId === LEAD_AC159)).toBe(false);

    inserirMensagemBruta({
      empresaId: EMPRESA_A,
      leadId: LEAD_AC159,
      numero: '5585911110159',
      mensagem: 'nova mensagem',
      direcao: 'recebida',
      criadoEm: '2026-01-04T11:00:00Z',
      lidaEm: null,
    });

    const depois = await (await getUnread(cookieA)).json();
    const conversa = depois.conversas.find((c: { leadId: string | null }) => c.leadId === LEAD_AC159);
    expect(conversa).toMatchObject({ leadId: LEAD_AC159, count: 1, lastMessage: 'nova mensagem' });
  });
});
