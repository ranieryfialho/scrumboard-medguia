// Testes de T-074 (fase2c-whatsapp-conversa, US-047): rotas
// GET/POST /api/leads/:id/telefones e DELETE /api/leads/:id/telefones/:telefoneId
// contra um Postgres 15 efêmero real com dois tenants seedados
// (test/support/seed-tenants.ts). Mesmos moldes de test/api/oportunidades-detalhe.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

// Lead da empresa A com telefone principal `+5585999985587` (AC-161) e um
// extra já cadastrado `5585988887777` direto por SQL (fixture de "estado já
// existente", fora das rotas sob teste).
const LEAD_COM_TELEFONES = 'cccccccc-0000-0000-0000-0000000000a1';
const EXTRA_JA_CADASTRADO = 'cccccccc-0000-0000-0000-0000000000a2';
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

describe('T-074: rotas de telefones do lead', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let rotaColecao: typeof import('../../src/app/api/leads/[id]/telefones/route');
  let rotaItem: typeof import('../../src/app/api/leads/[id]/telefones/[telefoneId]/route');
  let cookieA: string;
  let cookieB: string;

  function getTelefones(leadId: string, cookie: string | null) {
    const request = new NextRequest(`http://localhost/api/leads/${leadId}/telefones`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    return rotaColecao.GET(request, { params: Promise.resolve({ id: leadId }) });
  }

  function postTelefone(leadId: string, cookie: string | null, body: Record<string, unknown>) {
    const request = new NextRequest(`http://localhost/api/leads/${leadId}/telefones`, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return rotaColecao.POST(request, { params: Promise.resolve({ id: leadId }) });
  }

  function deleteTelefone(leadId: string, telefoneId: string, cookie: string | null) {
    const request = new NextRequest(`http://localhost/api/leads/${leadId}/telefones/${telefoneId}`, {
      method: 'DELETE',
      headers: cookie ? { Cookie: cookie } : {},
    });
    return rotaItem.DELETE(request, { params: Promise.resolve({ id: leadId, telefoneId }) });
  }

  function contarTelefones() {
    return pg.psqlComo('crm_migrator', `SELECT count(*) FROM "lead_telefones"`).stdout.trim();
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164")
         VALUES ('${LEAD_COM_TELEFONES}', '${tenants.empresaA}', 'Lead com telefones', '+5585999985587');
       INSERT INTO "lead_telefones" ("id", "empresa_id", "lead_id", "numero", "rotulo")
         VALUES ('${EXTRA_JA_CADASTRADO}', '${tenants.empresaA}', '${LEAD_COM_TELEFONES}', '5585988887777', 'Sócio');`
    );
    if (setup.status !== 0) throw new Error(`Falha ao preparar fixtures de lead-telefones: ${setup.stderr}`);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f2',
      empresaId: tenants.empresaB,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);
    const conviteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rotaColecao = await import('../../src/app/api/leads/[id]/telefones/route');
    rotaItem = await import('../../src/app/api/leads/[id]/telefones/[telefoneId]/route');

    cookieA = await loginComoCookie(auth, 'gerente.a@teste.com', SENHA);
    cookieB = await loginComoCookie(auth, 'gerente.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('cadastra telefone extra com DDI 55, dígitos só, rótulo e id @spec:AC-160', async () => {
    const resposta = await postTelefone(tenants.leadA, cookieA, { numero: '(85) 98888-1234', rotulo: 'Recepção' });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(201);
    expect(corpo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(corpo.numero).toBe('5585988881234');
    expect(corpo.rotulo).toBe('Recepção');
  });

  test('recusa telefone repetido contra o principal e contra outro extra, inclusive com a variação do nono dígito @spec:AC-161', async () => {
    const antes = contarTelefones();

    // Principal `+5585999985587` sem o nono dígito, e sem DDI nem nono dígito.
    const semNono = await postTelefone(LEAD_COM_TELEFONES, cookieA, { numero: '558599985587' });
    const semDdiSemNono = await postTelefone(LEAD_COM_TELEFONES, cookieA, { numero: '85999985587' });
    // Já é outro extra do mesmo lead.
    const extraRepetido = await postTelefone(LEAD_COM_TELEFONES, cookieA, { numero: '5585988887777' });

    for (const resposta of [semNono, semDdiSemNono, extraRepetido]) {
      expect(resposta.status).toBe(409);
      expect((await resposta.json()).codigo).toBe('TELEFONE_DUPLICADO');
    }
    expect(contarTelefones()).toBe(antes);
  });

  test('número inválido, rótulo grande demais, lead alheio, inexistente ou sem sessão: nada é gravado @spec:AC-162', async () => {
    const antes = contarTelefones();

    const curto = await postTelefone(tenants.leadA, cookieA, { numero: '123456789' }); // 9 dígitos
    const longo = await postTelefone(tenants.leadA, cookieA, { numero: '1234567890123456' }); // 16 dígitos
    const rotuloGrande = await postTelefone(tenants.leadA, cookieA, {
      numero: '5585977776666',
      rotulo: 'x'.repeat(61),
    });
    const leadAlheio = await postTelefone(tenants.leadB, cookieA, { numero: '5585977776666' });
    const leadInexistente = await postTelefone(INEXISTENTE, cookieA, { numero: '5585977776666' });
    const semSessao = await postTelefone(tenants.leadA, null, { numero: '5585977776666' });

    expect(curto.status).toBe(400);
    expect((await curto.json()).codigo).toBe('REQUISICAO_INVALIDA');
    expect(longo.status).toBe(400);
    expect((await longo.json()).codigo).toBe('REQUISICAO_INVALIDA');
    expect(rotuloGrande.status).toBe(400);
    expect((await rotuloGrande.json()).codigo).toBe('REQUISICAO_INVALIDA');

    expect(leadAlheio.status).toBe(404);
    expect((await leadAlheio.json()).codigo).toBe('LEAD_NAO_ENCONTRADO');
    expect(leadInexistente.status).toBe(404);
    expect((await leadInexistente.json()).codigo).toBe('LEAD_NAO_ENCONTRADO');

    expect(semSessao.status).toBe(401);
    expect((await semSessao.json()).codigo).toBe('NAO_AUTENTICADO');

    expect(contarTelefones()).toBe(antes);
  });

  test('lista o principal e os extras, remove só o extra do próprio lead @spec:AC-163', async () => {
    const listagem = await getTelefones(LEAD_COM_TELEFONES, cookieA);
    const corpoListagem = await listagem.json();

    expect(listagem.status).toBe(200);
    const principal = corpoListagem.telefones.find((t: { principal: boolean }) => t.principal);
    expect(principal).toMatchObject({ numero: '5585999985587', principal: true });
    expect(principal.id).toBeUndefined();

    const extra = corpoListagem.telefones.find((t: { id?: string }) => t.id === EXTRA_JA_CADASTRADO);
    expect(extra).toMatchObject({ id: EXTRA_JA_CADASTRADO, numero: '5585988887777', rotulo: 'Sócio', principal: false });

    // De outro lead: 404, nada apagado.
    const deOutroLead = await deleteTelefone(tenants.leadA, EXTRA_JA_CADASTRADO, cookieA);
    expect(deOutroLead.status).toBe(404);
    expect((await deOutroLead.json()).codigo).toBe('TELEFONE_NAO_ENCONTRADO');

    const remocao = await deleteTelefone(LEAD_COM_TELEFONES, EXTRA_JA_CADASTRADO, cookieA);
    expect(remocao.status).toBe(204);

    const depois = await getTelefones(LEAD_COM_TELEFONES, cookieA);
    const corpoDepois = await depois.json();
    expect(corpoDepois.telefones.some((t: { id?: string }) => t.id === EXTRA_JA_CADASTRADO)).toBe(false);
    expect(corpoDepois.telefones.some((t: { principal: boolean }) => t.principal)).toBe(true);
  });

  test('telefones de uma empresa não aparecem, não cadastram duplicidade nem são removíveis pela outra @spec:AC-164', async () => {
    // Mesmo número cadastrado como extra em cada empresa — não é duplicidade entre tenants.
    const extraA = await postTelefone(tenants.leadA, cookieA, { numero: '5585966665555' });
    const extraB = await postTelefone(tenants.leadB, cookieB, { numero: '5585966665555' });
    const corpoA = await extraA.json();
    const corpoB = await extraB.json();
    expect(extraA.status).toBe(201);
    expect(extraB.status).toBe(201);
    expect(corpoA.numero).toBe(corpoB.numero);

    // B não lista o lead da A.
    const listaB = await getTelefones(tenants.leadA, cookieB);
    expect(listaB.status).toBe(404);
    expect((await listaB.json()).codigo).toBe('LEAD_NAO_ENCONTRADO');

    // B não remove o extra da A.
    const removeDeA = await deleteTelefone(tenants.leadA, corpoA.id, cookieB);
    expect(removeDeA.status).toBe(404);

    const aindaExisteNaA = await getTelefones(tenants.leadA, cookieA);
    const corpoAindaExiste = await aindaExisteNaA.json();
    expect(corpoAindaExiste.telefones.some((t: { id?: string }) => t.id === corpoA.id)).toBe(true);
  });
});
