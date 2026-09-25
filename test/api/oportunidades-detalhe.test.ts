// Testes de T-048 (fase2-kanban, US-033): rota `GET /api/oportunidades/:id`
// (detalhe do card), contra um Postgres 15 efêmero real com dois tenants
// seedados (test/support/seed-tenants.ts). Mesmos moldes de
// test/api/oportunidades.test.ts.
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
const RESPONSAVEL_A = 'ffffffff-0000-0000-0000-0000000000b1';
const CARD_COMPLETO_A = 'ffffffff-0000-0000-0000-0000000000b2';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

describe('T-048: rota GET /api/oportunidades/:id', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/[id]/route');
  let cookieA: string;
  let cookieB: string;
  let motivoPerdaId: string;
  let motivoPerdaNome: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const motivo = pg.psqlComo(
      'crm_migrator',
      `SELECT "id", "nome" FROM "motivos_perda" WHERE "nome" = 'Sem interesse' LIMIT 1`
    );
    [motivoPerdaId, motivoPerdaNome] = motivo.stdout.trim().split('|');
    if (!motivoPerdaId) {
      throw new Error(`Falha ao buscar motivo de perda de fixture: ${motivo.stderr}`);
    }

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESPONSAVEL_A}', 'responsavel.detalhe@teste.com', 'Responsável Detalhe');
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "valor", "motivo_perda_id", "proxima_acao_em")
       VALUES ('${CARD_COMPLETO_A}', '${tenants.empresaA}', '${tenants.leadA}', 14, '${RESPONSAVEL_A}', '4200.00', '${motivoPerdaId}', now() + interval '3 days');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de detalhe: ${setup.stderr}`);
    }

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
    routeModule = await import('../../src/app/api/oportunidades/[id]/route');

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

  describe('AC-092: detalhe traz os dados do card', () => {
    test('card com lead/responsável/valor/motivo/próxima ação: todos presentes na resposta @spec:AC-092', async () => {
      const request = new NextRequest(`http://localhost/api/oportunidades/${CARD_COMPLETO_A}`, {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request, { params: Promise.resolve({ id: CARD_COMPLETO_A }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.leadNome).toBe('Lead da Empresa A');
      expect(corpo.responsavelNome).toBe('Responsável Detalhe');
      expect(corpo.etapaId).toBe(14);
      expect(corpo.valor).toBe('4200.00');
      expect(corpo.motivoPerdaNome).toBe(motivoPerdaNome);
      expect(corpo.proximaAcaoEm).not.toBeNull();
    });

    test('card sem responsável/valor/motivo: campos nulos, sem quebrar @spec:AC-092', async () => {
      const request = new NextRequest(`http://localhost/api/oportunidades/${tenants.oportunidadeA}`, {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request, { params: Promise.resolve({ id: tenants.oportunidadeA }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.responsavelNome).toBeNull();
      expect(corpo.motivoPerdaNome).toBeNull();
      expect(corpo.valor).toBeNull();
    });
  });

  describe('AC-093: detalhe de card de outro tenant não é acessível', () => {
    test('sessão da empresa B pedindo card da empresa A: 404 @spec:AC-093', async () => {
      const request = new NextRequest(`http://localhost/api/oportunidades/${CARD_COMPLETO_A}`, {
        headers: { Cookie: cookieB },
      });
      const resposta = await routeModule.GET(request, { params: Promise.resolve({ id: CARD_COMPLETO_A }) });

      expect(resposta.status).toBe(404);
    });
  });
});
