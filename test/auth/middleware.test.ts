// Testes de T-143 (fase4-design-system-shell-acesso, US-104): middleware do
// Better Auth — mesmo molde de test/api/oportunidades.test.ts (Postgres 15
// efêmero real, dois tenants seedados, login de verdade via
// `auth.api.signInEmail` para obter o cookie de sessão).
//
// O middleware usa `getDb()` (singleton de src/db/client.ts) e `getAuth()`
// (singleton de src/lib/auth/instancia.ts), então os dois módulos só podem
// ser importados DEPOIS de `process.env.DATABASE_URL` apontar pro Postgres
// efêmero deste teste — daí o `await import(...)` dinâmico dentro de
// `beforeAll`, em vez de um import estático no topo do arquivo.
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
const ATOR_MASTER: AtorConvite = {
  usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
  empresaId: '',
  papel: 'MASTER',
  isSuperAdmin: false,
};

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

describe('T-143: middleware do Better Auth, permissões por rota e raiz', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let middlewareModule: typeof import('../../src/middleware');
  let homeModule: typeof import('../../src/app/page');
  let cookieAtendente: string;
  let cookieGerente: string;
  let cookieMaster: string;
  let cookieSuperAdmin: string;
  let supabaseUrlOriginal: string | undefined;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);
    ATOR_MASTER.empresaId = tenants.empresaA;

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const conviteAtendente = await convidarUsuario(db, ATOR_MASTER, {
      email: 'atendente@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendente.token, SENHA);

    const conviteGerente = await convidarUsuario(db, ATOR_MASTER, {
      email: 'gerente@teste.com',
      papel: 'GERENTE',
    });
    await definirSenhaComToken(db, conviteGerente.token, SENHA);

    const conviteMaster = await convidarUsuario(db, ATOR_MASTER, {
      email: 'master@teste.com',
      papel: 'MASTER',
    });
    await definirSenhaComToken(db, conviteMaster.token, SENHA);

    const conviteSuperAdmin = await convidarUsuario(db, ATOR_MASTER, {
      email: 'superadmin@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteSuperAdmin.token, SENHA);
    const marcarSuperAdmin = pg.psqlComo(
      'crm_migrator',
      `UPDATE "usuarios" SET "is_super_admin" = true WHERE "email" = 'superadmin@teste.com';`
    );
    if (marcarSuperAdmin.status !== 0) {
      throw new Error(`Falha ao marcar super admin: ${marcarSuperAdmin.stderr}`);
    }

    // AC-384: a env do Supabase não existe neste teste (removida caso esteja
    // definida no ambiente) — o middleware precisa funcionar mesmo assim.
    supabaseUrlOriginal = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    // O middleware/página leem `getDb()`/`getAuth()` (singletons) — precisam
    // apontar pro Postgres efêmero ANTES do primeiro import desses módulos.
    process.env.DATABASE_URL = pg.appUrl;
    middlewareModule = await import('../../src/middleware');
    homeModule = await import('../../src/app/page');

    cookieAtendente = await loginComoCookie(auth, 'atendente@teste.com', SENHA);
    cookieGerente = await loginComoCookie(auth, 'gerente@teste.com', SENHA);
    cookieMaster = await loginComoCookie(auth, 'master@teste.com', SENHA);
    cookieSuperAdmin = await loginComoCookie(auth, 'superadmin@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    if (supabaseUrlOriginal !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrlOriginal;
    }
    // O middleware/página usam `getDb()` (singleton próprio, pool separado
    // do `pool` deste teste) — sem fechá-lo antes de derrubar o container, o
    // driver `pg` emite "Connection terminated unexpectedly" (unhandled).
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  function passouAdiante(resposta: Response): boolean {
    return resposta.headers.get('x-middleware-next') === '1';
  }

  describe('AC-379: sem sessão, páginas vão para o login e APIs respondem 401', () => {
    test('página protegida sem cookie redireciona para /login preservando o destino @spec:AC-379', async () => {
      const request = new NextRequest('http://localhost/pipeline/abc');
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(307);
      const destino = new URL(resposta.headers.get('location')!);
      expect(destino.pathname).toBe('/login');
      expect(destino.searchParams.get('next')).toBe('/pipeline/abc');
    });

    test('API protegida sem cookie responde 401 sem redirecionar @spec:AC-379', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades');
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(401);
      expect(resposta.headers.get('location')).toBeNull();
      const corpo = await resposta.json();
      expect(corpo).toEqual({ codigo: 'NAO_AUTENTICADO' });
    });

    test('cookie inválido é tratado como sem sessão @spec:AC-379', async () => {
      const request = new NextRequest('http://localhost/pipeline', {
        headers: { Cookie: '__Secure-better-auth.session_token=token-forjado' },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get('location')!).pathname).toBe('/login');
    });
  });

  describe('AC-380: o que precisa ser público continua público', () => {
    const rotasPublicas = [
      'http://localhost/login',
      'http://localhost/esqueci-senha',
      'http://localhost/redefinir-senha/um-token',
      'http://localhost/convite/um-token',
      'http://localhost/sem-acesso',
      'http://localhost/api/auth/sign-in/email',
      'http://localhost/api/health',
      'http://localhost/api/whatsapp/webhook',
      'http://localhost/api/webhooks/resend',
      'http://localhost/api/cron/cadencia',
    ];

    test.each(rotasPublicas)('%s passa sem sessão, sem redirecionar nem bloquear @spec:AC-380', async (url) => {
      const request = new NextRequest(url);
      const resposta = await middlewareModule.middleware(request);

      expect(passouAdiante(resposta)).toBe(true);
      expect(resposta.status).not.toBe(401);
      expect(resposta.status).not.toBe(403);
      expect(resposta.headers.get('location')).toBeNull();
    });
  });

  describe('AC-381: papel sem permissão vai para a tela de sem acesso', () => {
    test('ATENDENTE logado é redirecionado de /indicadores para /sem-acesso @spec:AC-381', async () => {
      const request = new NextRequest('http://localhost/indicadores', {
        headers: { Cookie: cookieAtendente },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(307);
      const destino = new URL(resposta.headers.get('location')!);
      expect(destino.pathname).toBe('/sem-acesso');
      expect(destino.searchParams.get('de')).toBe('/indicadores');
    });

    test('ATENDENTE logado recebe 403 SEM_PERMISSAO em /api/relatorios/kpis @spec:AC-381', async () => {
      const request = new NextRequest('http://localhost/api/relatorios/kpis', {
        headers: { Cookie: cookieAtendente },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(403);
      const corpo = await resposta.json();
      expect(corpo).toEqual({ codigo: 'SEM_PERMISSAO' });
    });

    test('GERENTE logado acessa /indicadores normalmente @spec:AC-381', async () => {
      const request = new NextRequest('http://localhost/indicadores', {
        headers: { Cookie: cookieGerente },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(passouAdiante(resposta)).toBe(true);
    });

    test('MASTER é barrado de /admin/empresas (só super admin vê, AC-349) @spec:AC-381', async () => {
      const request = new NextRequest('http://localhost/admin/empresas', {
        headers: { Cookie: cookieMaster },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get('location')!).pathname).toBe('/sem-acesso');
    });

    test('super admin acessa /admin/empresas normalmente @spec:AC-381', async () => {
      const request = new NextRequest('http://localhost/admin/empresas', {
        headers: { Cookie: cookieSuperAdmin },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(passouAdiante(resposta)).toBe(true);
    });
  });

  describe('AC-382: a raiz leva ao lugar certo', () => {
    test('visitante sem sessão em / vai para /login @spec:AC-382', async () => {
      const request = new NextRequest('http://localhost/');
      const resposta = await middlewareModule.middleware(request);

      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get('location')!).pathname).toBe('/login');
    });

    test('usuário logado em / passa pelo middleware (a página decide o destino) @spec:AC-382', async () => {
      const request = new NextRequest('http://localhost/', {
        headers: { Cookie: cookieAtendente },
      });
      const resposta = await middlewareModule.middleware(request);

      expect(passouAdiante(resposta)).toBe(true);
    });

    test('a página da raiz redireciona quem chegou até ela para /pipeline @spec:AC-382', () => {
      // `redirect()` (next/navigation) lança um erro com `digest` no formato
      // `NEXT_REDIRECT;<tipo>;<destino>;<status>;` — não há API pública para
      // capturar isso fora do app router, então o teste olha o digest.
      try {
        homeModule.default();
        throw new Error('deveria ter lançado o redirecionamento');
      } catch (erro) {
        const digest = (erro as { digest?: string }).digest ?? '';
        expect(digest.startsWith('NEXT_REDIRECT;')).toBe(true);
        expect(digest.split(';')).toContain('/pipeline');
      }
    });
  });

  describe('AC-384: o middleware já não consulta o Supabase', () => {
    test('decide pela sessão do Better Auth sem NEXT_PUBLIC_SUPABASE_URL definida @spec:AC-384', async () => {
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();

      const semSessao = await middlewareModule.middleware(new NextRequest('http://localhost/pipeline'));
      expect(semSessao.status).toBe(307);

      const comSessao = await middlewareModule.middleware(
        new NextRequest('http://localhost/pipeline', { headers: { Cookie: cookieAtendente } })
      );
      expect(passouAdiante(comSessao)).toBe(true);
    });

    test('o código do middleware não importa nada do Supabase @spec:AC-384', async () => {
      const fs = await import('node:fs/promises');
      const codigoFonte = await fs.readFile(
        new URL('../../src/middleware.ts', import.meta.url),
        'utf-8'
      );
      // Varre só as linhas de `import` — os comentários do arquivo citam
      // "Supabase" para explicar por que ele não é mais consultado aqui.
      const linhasDeImport = codigoFonte
        .split('\n')
        .filter((linha) => /^\s*import\b/.test(linha));
      expect(linhasDeImport.some((linha) => linha.toLowerCase().includes('supabase'))).toBe(false);
    });
  });
});
