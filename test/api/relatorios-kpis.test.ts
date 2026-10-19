// Testes de T-102 (fase2d-kpis, US-062): rota GET /api/relatorios/kpis
// contra um Postgres 15 efêmero real — mesmo molde de
// test/api/whatsapp-config.test.ts (login real via better-auth, handler
// chamado direto com um `NextRequest`).
//
// O repositório (T-101, test/db/kpis.test.ts) já prova a conta de cada
// indicador — aqui o sinal usado é só o denominador de `conexao` (= total
// de cards na coorte), suficiente para provar que a rota aplica filtro de
// período (AC-226), filtro por responsável (AC-227) e isolamento entre
// empresas (AC-228) antes de chamar o repositório.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'aaaaaaaa-1000-0000-0000-00000000000a';
const EMPRESA_B = 'aaaaaaaa-1000-0000-0000-00000000000b';
const LEAD_A = 'aaaaaaaa-1000-0000-0000-00000000001a';
const LEAD_B = 'aaaaaaaa-1000-0000-0000-00000000001b';
const RESP_A1 = 'aaaaaaaa-1000-0000-0000-00000000002a';
const RESP_A2 = 'aaaaaaaa-1000-0000-0000-00000000002b';
const RESP_B1 = 'aaaaaaaa-1000-0000-0000-00000000002c';

const ETAPA_ENTRADA = 1;

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `aaaaaaaa-2222-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-102: GET /api/relatorios/kpis', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rota: typeof import('../../src/app/api/relatorios/kpis/route');

  let cookieMasterA: string;
  let cookieGerenteA: string;
  let cookieAtendenteA: string;
  let cookieGerenteB: string;
  let cookieSuperAdmin: string;

  function kpis(cookie: string | null, query = ''): Promise<Response> {
    const request = new NextRequest(`http://localhost/api/relatorios/kpis${query}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rota.GET(request);
  }

  function criarOportunidade(empresaId: string, leadId: string, responsavelId: string, criadoEm: string): void {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "criado_em")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA}, '${responsavelId}', '${criadoEm}')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A KPIs Rota', 'empresa-a-kpis-rota'),
         ('${EMPRESA_B}', 'Empresa B KPIs Rota', 'empresa-b-kpis-rota');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead A KPIs Rota'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead B KPIs Rota');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESP_A1}', 'resp-kpis-rota-a1@teste.local', 'Responsável KPIs Rota A1'),
         ('${RESP_A2}', 'resp-kpis-rota-a2@teste.local', 'Responsável KPIs Rota A2'),
         ('${RESP_B1}', 'resp-kpis-rota-b1@teste.local', 'Responsável KPIs Rota B1');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de relatorios-kpis: ${setup.stderr}`);
    }

    // AC-226: dentro do período (2026-03-01 a 2026-03-31) — 3 de RESP_A1 em
    // 03-05, 2 de RESP_A1 em 03-25, 3 de RESP_A2 em 03-07. Fora do período —
    // 2 de RESP_A1 em 02-20. AC-228 — 4 cards da empresa B em 03-10.
    for (let i = 0; i < 3; i += 1) criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-03-05T12:00:00-03:00');
    for (let i = 0; i < 2; i += 1) criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-03-25T12:00:00-03:00');
    for (let i = 0; i < 3; i += 1) criarOportunidade(EMPRESA_A, LEAD_A, RESP_A2, '2026-03-07T12:00:00-03:00');
    for (let i = 0; i < 2; i += 1) criarOportunidade(EMPRESA_A, LEAD_A, RESP_A1, '2026-02-20T12:00:00-03:00');
    for (let i = 0; i < 4; i += 1) criarOportunidade(EMPRESA_B, LEAD_B, RESP_B1, '2026-03-10T12:00:00-03:00');

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-1000-0000-0000-0000000001f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-1000-0000-0000-0000000001f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a@kpis-rota.teste', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@kpis-rota.teste', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, {
      email: 'atendente.a@kpis-rota.teste',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b@kpis-rota.teste', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    // ASM-074/AC-229: super admin vê os indicadores mesmo com papel ATENDENTE
    // no vínculo — o bypass é só por `is_super_admin`.
    const conviteSuperAdmin = await convidarUsuario(db, atorMasterA, {
      email: 'super.admin@kpis-rota.teste',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteSuperAdmin.token, SENHA);
    const marcarSuperAdmin = pg.psqlComo(
      'crm_migrator',
      `UPDATE "usuarios" SET "is_super_admin" = true WHERE "email" = 'super.admin@kpis-rota.teste'`
    );
    if (marcarSuperAdmin.status !== 0) {
      throw new Error(`Falha ao marcar super admin: ${marcarSuperAdmin.stderr}`);
    }

    process.env.DATABASE_URL = pg.appUrl;
    rota = await import('../../src/app/api/relatorios/kpis/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a@kpis-rota.teste', SENHA);
    cookieGerenteA = await loginComoCookie(auth, 'gerente.a@kpis-rota.teste', SENHA);
    cookieAtendenteA = await loginComoCookie(auth, 'atendente.a@kpis-rota.teste', SENHA);
    cookieGerenteB = await loginComoCookie(auth, 'gerente.b@kpis-rota.teste', SENHA);
    cookieSuperAdmin = await loginComoCookie(auth, 'super.admin@kpis-rota.teste', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  test('sem sessão: 401 NAO_AUTENTICADO @spec:AC-229', async () => {
    const resposta = await kpis(null, '?de=2026-03-01&ate=2026-03-31');
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  test('ATENDENTE recebe 403 SEM_PERMISSAO @spec:AC-229', async () => {
    const resposta = await kpis(cookieAtendenteA, '?de=2026-03-01&ate=2026-03-31');
    expect(resposta.status).toBe(403);
    expect((await resposta.json()).codigo).toBe('SEM_PERMISSAO');
  });

  test('MASTER, GERENTE e super admin recebem 200 @spec:AC-229', async () => {
    for (const cookie of [cookieMasterA, cookieGerenteA, cookieSuperAdmin]) {
      const resposta = await kpis(cookie, '?de=2026-03-01&ate=2026-03-31');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.conexao).toHaveProperty('valor');
      expect(corpo.conexao).toHaveProperty('numerador');
      expect(corpo.conexao).toHaveProperty('denominador');
    }
  });

  test('filtro de período: só os cards criados no intervalo entram na conta @spec:AC-226', async () => {
    const respostaMes = await kpis(cookieGerenteA, '?de=2026-03-01&ate=2026-03-31');
    expect((await respostaMes.json()).conexao.denominador).toBe(8);

    const respostaEstreita = await kpis(cookieGerenteA, '?de=2026-03-01&ate=2026-03-10');
    expect((await respostaEstreita.json()).conexao.denominador).toBe(6);
  });

  test('filtro por responsável restringe a conta a esse responsável @spec:AC-227', async () => {
    const resposta = await kpis(cookieGerenteA, `?de=2026-03-01&ate=2026-03-31&responsavelId=${RESP_A1}`);
    expect((await resposta.json()).conexao.denominador).toBe(5);

    const respostaOutro = await kpis(cookieGerenteA, `?de=2026-03-01&ate=2026-03-31&responsavelId=${RESP_A2}`);
    expect((await respostaOutro.json()).conexao.denominador).toBe(3);
  });

  test('isolamento entre empresas: cards da empresa B nunca entram, mesmo passando empresaId=B na query @spec:AC-228', async () => {
    const respostaA = await kpis(cookieGerenteA, `?de=2026-03-01&ate=2026-03-31&empresaId=${EMPRESA_B}`);
    expect((await respostaA.json()).conexao.denominador).toBe(8);

    const respostaB = await kpis(cookieGerenteB, '?de=2026-03-01&ate=2026-03-31');
    expect((await respostaB.json()).conexao.denominador).toBe(4);
  });

  test('de maior que ate: 400 PARAMETRO_INVALIDO, sem consultar o banco @spec:AC-230', async () => {
    const resposta = await kpis(cookieGerenteA, '?de=2026-03-31&ate=2026-03-01');
    expect(resposta.status).toBe(400);
    const corpo = await resposta.json();
    expect(corpo.codigo).toBe('PARAMETRO_INVALIDO');
    expect(typeof corpo.mensagem).toBe('string');
    expect(corpo.mensagem.length).toBeGreaterThan(0);
  });

  test('data mal formada: 400 PARAMETRO_INVALIDO @spec:AC-230', async () => {
    for (const query of ['?de=31-03-2026', '?ate=2026-13-01', '?de=2026-02-30', '?de=2026/03/01']) {
      const resposta = await kpis(cookieGerenteA, query);
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('PARAMETRO_INVALIDO');
    }
  });

  test('responsavelId que não é UUID: 400 PARAMETRO_INVALIDO @spec:AC-230', async () => {
    const resposta = await kpis(cookieGerenteA, '?responsavelId=nao-e-um-uuid');
    expect(resposta.status).toBe(400);
    expect((await resposta.json()).codigo).toBe('PARAMETRO_INVALIDO');
  });
});
