// Testes de T-091 (fase2b-cadencia, US-053): rota
// `POST /api/oportunidades/:id/cadencia/iniciar`, contra um Postgres 15
// efêmero real com dois tenants seedados (test/support/seed-tenants.ts).
// Mesmos moldes de test/api/oportunidades-transicao.test.ts.
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
const ETAPA_1_DIA_DE_CONTATO = 2;

function postIniciar(id: string, cookie: string | null, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/oportunidades/${id}/cadencia/iniciar`, {
    method: 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('T-091: rota POST /api/oportunidades/:id/cadencia/iniciar', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');
  let cookieA: string;
  let cookieB: string;

  async function loginComoCookie(email: string, senha: string): Promise<string> {
    const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
    if (!sessionCookie) {
      throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
    }
    return sessionCookie.split(';')[0];
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-1111-0000-0000-0000000000f1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-1111-0000-0000-0000000000f2',
      empresaId: tenants.empresaB,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.cadencia.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);
    const conviteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.cadencia.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');

    cookieA = await loginComoCookie('gerente.cadencia.a@teste.com', SENHA);
    cookieB = await loginComoCookie('gerente.cadencia.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  function atividadesDoCard(oportunidadeId: string) {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT coalesce(json_agg(t), '[]'::json) FROM (
         SELECT sequencia, resultado FROM cadencia_atividades
         WHERE oportunidade_id = '${oportunidadeId}' ORDER BY sequencia
       ) t`
    );
    return JSON.parse(resultado.stdout.trim()) as Array<{ sequencia: number; resultado: string }>;
  }

  describe('AC-190: iniciar gera só o primeiro bloco', () => {
    test('card vai para "1º dia de contato" com exatamente 3 toques pendentes (1-3); resposta traz card e toques @spec:AC-190', async () => {
      const resposta = await routeModule.POST(postIniciar(tenants.oportunidadeA, cookieA, { version: 1 }), {
        params: Promise.resolve({ id: tenants.oportunidadeA }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.oportunidade.etapaId).toBe(ETAPA_1_DIA_DE_CONTATO);
      expect(corpo.oportunidade.cadenciaDia).toBe(1);
      expect(corpo.oportunidade.cadenciaTurno).toBe('manha');
      expect(corpo.toques).toHaveLength(3);
      expect(corpo.toques.map((t: { sequencia: number }) => t.sequencia)).toEqual([1, 2, 3]);
      expect(corpo.toques.every((t: { resultado: string }) => t.resultado === 'pendente')).toBe(true);

      const todas = atividadesDoCard(tenants.oportunidadeA);
      expect(todas).toHaveLength(3);
    });
  });

  describe('AC-191: iniciar respeita versão, tenant e sessão', () => {
    test('version desatualizada: 409 CONFLITO_DE_VERSAO e nenhum toque criado @spec:AC-191', async () => {
      const resposta = await routeModule.POST(postIniciar(tenants.oportunidadeB, cookieB, { version: 99 }), {
        params: Promise.resolve({ id: tenants.oportunidadeB }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(409);
      expect(corpo.codigo).toBe('CONFLITO_DE_VERSAO');
      expect(atividadesDoCard(tenants.oportunidadeB)).toHaveLength(0);
    });

    test('card de outra empresa: 404 OPORTUNIDADE_NAO_ENCONTRADA e nenhum toque criado @spec:AC-191', async () => {
      const resposta = await routeModule.POST(postIniciar(tenants.oportunidadeA, cookieB, { version: 2 }), {
        params: Promise.resolve({ id: tenants.oportunidadeA }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(404);
      expect(corpo.codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');
      // tenants.oportunidadeA já tinha 3 toques do teste de AC-190 — confirma que não mudou.
      expect(atividadesDoCard(tenants.oportunidadeA)).toHaveLength(3);
    });

    test('sem sessão: 401 NAO_AUTENTICADO e nenhum toque criado @spec:AC-191', async () => {
      const resposta = await routeModule.POST(postIniciar(tenants.oportunidadeB, null, { version: 1 }), {
        params: Promise.resolve({ id: tenants.oportunidadeB }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTENTICADO');
      expect(atividadesDoCard(tenants.oportunidadeB)).toHaveLength(0);
    });
  });
});
