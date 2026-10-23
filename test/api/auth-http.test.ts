// Testes de T-144 (fase4-design-system-shell-acesso, US-104/US-098): rotas
// HTTP do Better Auth (`/api/auth/[...all]`), `/api/me` e `/api/empresa-ativa`
// — mesmo molde de test/auth/middleware.test.ts e test/api/oportunidades.test.ts
// (Postgres 15 efêmero real, dois tenants seedados, login de verdade via
// `auth.api.signInEmail` para obter o cookie de sessão).
//
// As rotas usam `getDb()`/`getAuth()` (singletons), então os módulos só
// podem ser importados DEPOIS de `process.env.DATABASE_URL` apontar pro
// Postgres efêmero deste teste — daí o `await import(...)` dinâmico dentro
// de `beforeAll`, em vez de um import estático no topo do arquivo.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const BASE_URL = 'http://localhost:3000';
const SENHA = 'senha-correta-123';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({
    body: { email, password: senha },
    asResponse: true,
  });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

async function tokenDoCookie(auth: Auth, cookie: string): Promise<string> {
  const sessao = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
  if (!sessao) throw new Error('cookie não corresponde a uma sessão válida');
  return sessao.session.token;
}

describe('T-144: rotas HTTP de autenticação, /api/me e empresa ativa', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let authRouteModule: typeof import('../../src/app/api/auth/[...all]/route');
  let meRouteModule: typeof import('../../src/app/api/me/route');
  let empresaAtivaRouteModule: typeof import('../../src/app/api/empresa-ativa/route');
  let cookieMaster: string;
  let cookieSuperAdmin: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMaster: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMaster = await convidarUsuario(db, atorMaster, {
      email: 'master@teste.com',
      papel: 'MASTER',
    });
    await definirSenhaComToken(db, conviteMaster.token, SENHA, { nome: 'Mestre Testes' });

    const conviteSuperAdmin = await convidarUsuario(db, atorMaster, {
      email: 'superadmin@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteSuperAdmin.token, SENHA, { nome: 'Super Admin Testes' });
    const marcarSuperAdmin = pg.psqlComo(
      'crm_migrator',
      `UPDATE "usuarios" SET "is_super_admin" = true WHERE "email" = 'superadmin@teste.com';`
    );
    if (marcarSuperAdmin.status !== 0) {
      throw new Error(`Falha ao marcar super admin: ${marcarSuperAdmin.stderr}`);
    }

    // As rotas leem `getDb()`/`getAuth()` (singletons) — precisam apontar pro
    // Postgres efêmero ANTES do primeiro import desses módulos.
    process.env.DATABASE_URL = pg.appUrl;
    authRouteModule = await import('../../src/app/api/auth/[...all]/route');
    meRouteModule = await import('../../src/app/api/me/route');
    empresaAtivaRouteModule = await import('../../src/app/api/empresa-ativa/route');

    cookieMaster = await loginComoCookie(auth, 'master@teste.com', SENHA);
    cookieSuperAdmin = await loginComoCookie(auth, 'superadmin@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    // As rotas usam `getDb()` (singleton próprio, pool separado do `pool`
    // deste teste) — sem fechá-lo antes de derrubar o container, o driver
    // `pg` emite "Connection terminated unexpectedly" (unhandled).
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-378: as rotas do Better Auth atendem pelo navegador', () => {
    test('POST /api/auth/sign-in/email cria a sessão e devolve cookie HttpOnly/Secure/SameSite=Lax @spec:AC-378', async () => {
      const request = new NextRequest(`${BASE_URL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'master@teste.com', password: SENHA }),
      });

      const resposta = await authRouteModule.POST(request);
      expect(resposta.status).toBe(200);

      const cookies = resposta.headers.getSetCookie();
      const sessionCookieRaw = cookies.find((c) => c.includes('better-auth.session_token='));
      if (!sessionCookieRaw) throw new Error(`cookie de sessão não encontrado: ${cookies.join(' | ')}`);

      expect(sessionCookieRaw).toContain('HttpOnly');
      expect(sessionCookieRaw).toContain('Secure');
      expect(sessionCookieRaw).toContain('SameSite=Lax');

      const cookieHeader = sessionCookieRaw.split(';')[0];
      const token = await tokenDoCookie(auth, cookieHeader);
      const linhas = await pool.query('SELECT 1 FROM "sessoes" WHERE "token" = $1', [token]);
      expect(linhas.rowCount).toBe(1);
    });

    test('POST /api/auth/sign-out revoga a sessão e limpa o cookie, usando o schema em português @spec:AC-378', async () => {
      const cookie = await loginComoCookie(auth, 'master@teste.com', SENHA);
      const token = await tokenDoCookie(auth, cookie);

      const antes = await pool.query('SELECT 1 FROM "sessoes" WHERE "token" = $1', [token]);
      expect(antes.rowCount).toBe(1);

      const request = new NextRequest(`${BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: BASE_URL },
      });
      const resposta = await authRouteModule.POST(request);
      expect(resposta.status).toBe(200);

      const cookies = resposta.headers.getSetCookie();
      const sessionCookieLimpo = cookies.find((c) => c.includes('better-auth.session_token='));
      expect(sessionCookieLimpo).toBeDefined();
      expect(sessionCookieLimpo).toContain('Max-Age=0');

      const depois = await pool.query('SELECT 1 FROM "sessoes" WHERE "token" = $1', [token]);
      expect(depois.rowCount).toBe(0);
    });
  });

  describe('AC-357: sair encerra a sessão', () => {
    test('após "Sair", a linha de sessoes é apagada e a sessão antiga não mostra mais dados da empresa @spec:AC-357', async () => {
      const cookie = await loginComoCookie(auth, 'master@teste.com', SENHA);
      const token = await tokenDoCookie(auth, cookie);

      const requestMeAntes = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookie } });
      const respostaMeAntes = await meRouteModule.GET(requestMeAntes);
      expect(respostaMeAntes.status).toBe(200);

      const requestSignOut = new NextRequest(`${BASE_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: BASE_URL },
      });
      await authRouteModule.POST(requestSignOut);

      const linhas = await pool.query('SELECT 1 FROM "sessoes" WHERE "token" = $1', [token]);
      expect(linhas.rowCount).toBe(0);

      // "Voltar com o botão do navegador" == reusar o cookie antigo: a API
      // não mostra mais nenhum dado da empresa, só 401.
      const requestMeDepois = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookie } });
      const respostaMeDepois = await meRouteModule.GET(requestMeDepois);
      expect(respostaMeDepois.status).toBe(401);
      expect(await respostaMeDepois.json()).toEqual({ codigo: 'NAO_AUTENTICADO' });
    });
  });

  describe('AC-383: /api/me entrega o necessário para a casca', () => {
    test('sem sessão: 401 @spec:AC-383', async () => {
      const request = new NextRequest(`${BASE_URL}/api/me`);
      const resposta = await meRouteModule.GET(request);

      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual({ codigo: 'NAO_AUTENTICADO' });
    });

    test('com sessão: nome, e-mail, papel, isSuperAdmin e empresa ativa (id e nome) @spec:AC-383', async () => {
      const request = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookieMaster } });
      const resposta = await meRouteModule.GET(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.nome).toBe('Mestre Testes');
      expect(corpo.email).toBe('master@teste.com');
      expect(corpo.papel).toBe('MASTER');
      expect(corpo.isSuperAdmin).toBe(false);
      expect(corpo.empresaAtiva).toEqual({ id: tenants.empresaA, nome: 'Empresa A' });
    });
  });

  describe('AC-353: só o super admin vê e usa o seletor de empresa', () => {
    test('MASTER não recebe a lista de empresas em /api/me @spec:AC-353', async () => {
      const request = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookieMaster } });
      const corpo = await (await meRouteModule.GET(request)).json();

      expect(corpo.empresas).toBeUndefined();
    });

    test('super admin recebe a lista de empresas em /api/me, com a ativa marcada @spec:AC-353', async () => {
      const request = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookieSuperAdmin } });
      const corpo = await (await meRouteModule.GET(request)).json();

      expect(corpo.isSuperAdmin).toBe(true);
      expect(corpo.empresas).toEqual(
        expect.arrayContaining([
          { id: tenants.empresaA, nome: 'Empresa A' },
          { id: tenants.empresaB, nome: 'Empresa B' },
        ])
      );
      expect(corpo.empresaAtiva).toEqual({ id: tenants.empresaA, nome: 'Empresa A' });
    });

    test('MASTER não pode trocar a empresa ativa: 403 SEM_PERMISSAO @spec:AC-353', async () => {
      const request = new NextRequest(`${BASE_URL}/api/empresa-ativa`, {
        method: 'POST',
        headers: { Cookie: cookieMaster, 'content-type': 'application/json' },
        body: JSON.stringify({ empresaId: tenants.empresaB }),
      });
      const resposta = await empresaAtivaRouteModule.POST(request);

      expect(resposta.status).toBe(403);
      expect(await resposta.json()).toEqual({ codigo: 'SEM_PERMISSAO' });
    });

    test('super admin troca a empresa ativa e a próxima leitura de /api/me reflete a nova empresa @spec:AC-353', async () => {
      const requestTroca = new NextRequest(`${BASE_URL}/api/empresa-ativa`, {
        method: 'POST',
        headers: { Cookie: cookieSuperAdmin, 'content-type': 'application/json' },
        body: JSON.stringify({ empresaId: tenants.empresaB }),
      });
      const respostaTroca = await empresaAtivaRouteModule.POST(requestTroca);

      expect(respostaTroca.status).toBe(200);
      expect(await respostaTroca.json()).toEqual({ empresaAtiva: { id: tenants.empresaB, nome: 'Empresa B' } });

      const requestMe = new NextRequest(`${BASE_URL}/api/me`, { headers: { Cookie: cookieSuperAdmin } });
      const corpo = await (await meRouteModule.GET(requestMe)).json();
      expect(corpo.empresaAtiva).toEqual({ id: tenants.empresaB, nome: 'Empresa B' });
    });
  });
});
