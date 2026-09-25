// Testes de T-046 (fase2-kanban, US-029/US-030): rota do board
// (`GET /api/oportunidades`) e criação manual de card
// (`POST /api/oportunidades`), contra um Postgres 15 efêmero real com dois
// tenants seedados (test/support/seed-tenants.ts) — mesmos moldes de
// test/repositories/oportunidades.test.ts, mas exercitando a rota HTTP.
//
// A rota usa `getDb()` (singleton de src/db/client.ts), então o módulo só
// pode ser importado DEPOIS de `process.env.DATABASE_URL` apontar pro
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

const ETAPA_ALTERNATIVA = 2; // "1º dia de contato" — seed de drizzle/0005_seeds.sql.
const SENHA = 'senha-correta-123';

const RESPONSAVEL_A = 'ffffffff-0000-0000-0000-000000000001';

const OPORTUNIDADE_COM_DADOS_A = 'ffffffff-0000-0000-0000-000000000002';
const OPORTUNIDADE_OUTRA_ETAPA_A = 'ffffffff-0000-0000-0000-000000000003';

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

describe('T-046: rota GET/POST /api/oportunidades', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/route');
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const extras = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${RESPONSAVEL_A}', 'responsavel.a@teste.com', 'Responsável A');
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id", "valor", "criado_em") VALUES
         ('${OPORTUNIDADE_COM_DADOS_A}', '${tenants.empresaA}', '${tenants.leadA}', ${tenants.etapaId}, '${RESPONSAVEL_A}', '3500.00', now() + interval '1 seconds'),
         ('${OPORTUNIDADE_OUTRA_ETAPA_A}', '${tenants.empresaA}', '${tenants.leadA}', ${ETAPA_ALTERNATIVA}, null, null, now() + interval '2 seconds');`
    );
    if (extras.status !== 0) {
      throw new Error(`Falha ao preparar fixtures extras: ${extras.stderr}`);
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

    const conviteA = await convidarUsuario(db, atorMasterA, {
      email: 'gerente.a@teste.com',
      papel: 'GERENTE',
    });
    await definirSenhaComToken(db, conviteA.token, SENHA);

    const conviteB = await convidarUsuario(db, atorMasterB, {
      email: 'gerente.b@teste.com',
      papel: 'GERENTE',
    });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    // A rota lê `getDb()` (singleton) — precisa apontar pro Postgres efêmero
    // ANTES do módulo da rota ser importado pela primeira vez.
    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/oportunidades/route');

    cookieA = await loginComoCookie(auth, 'gerente.a@teste.com', SENHA);
    cookieB = await loginComoCookie(auth, 'gerente.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    // A rota usa `getDb()` (singleton próprio, pool separado do `pool` deste
    // teste) — sem fechá-lo antes de derrubar o container, o driver `pg`
    // emite "Connection terminated unexpectedly" (unhandled) quando o
    // container some com conexões ainda abertas.
    // `getDb()` é anotado com o tipo `NodePgDatabase` puro (sem o campo
    // `$client` da interseção que `drizzle()` retorna em tempo de execução)
    // — o valor existe, só não está no tipo declarado.
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-078: sem sessão válida, o board é recusado', () => {
    test('sem cookie: 401 @spec:AC-078', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades');
      const resposta = await routeModule.GET(request);

      expect(resposta.status).toBe(401);
    });

    test('cookie inválido: 401 @spec:AC-078', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        headers: { Cookie: '__Secure-better-auth.session_token=token-forjado' },
      });
      const resposta = await routeModule.GET(request);

      expect(resposta.status).toBe(401);
    });
  });

  describe('AC-074: board só mostra cards do tenant da sessão', () => {
    test('empresa A não vê nenhum card da empresa B @spec:AC-074', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const ids: string[] = corpo.itens.map((c: { id: string }) => c.id);
      expect(ids).toContain(tenants.oportunidadeA);
      expect(ids).not.toContain(tenants.oportunidadeB);
    });
  });

  describe('AC-075: cada card traz nome do lead, do responsável e o valor', () => {
    test('card com lead/responsável/valor preenchidos traz os três @spec:AC-075', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      const card = corpo.itens.find((c: { id: string }) => c.id === OPORTUNIDADE_COM_DADOS_A);
      expect(card).toBeDefined();
      expect(card.leadNome).toBe('Lead da Empresa A');
      expect(card.responsavelNome).toBe('Responsável A');
      expect(card.valor).toBe('3500.00');
    });

    test('card sem responsável traz responsavelNome nulo @spec:AC-075', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      const card = corpo.itens.find((c: { id: string }) => c.id === tenants.oportunidadeA);
      expect(card).toBeDefined();
      expect(card.responsavelNome).toBeNull();
      expect(card.valor).toBeNull();
    });
  });

  describe('AC-076: filtro por etapa restringe o resultado', () => {
    test('etapaId filtra só cards daquela etapa @spec:AC-076', async () => {
      const request = new NextRequest(`http://localhost/api/oportunidades?etapaId=${ETAPA_ALTERNATIVA}`, {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      expect(corpo.itens.every((c: { etapaId: number }) => c.etapaId === ETAPA_ALTERNATIVA)).toBe(true);
      expect(corpo.itens.map((c: { id: string }) => c.id)).toContain(OPORTUNIDADE_OUTRA_ETAPA_A);
    });
  });

  describe('AC-077: filtro por responsável restringe o resultado', () => {
    test('responsavelId filtra só cards daquele responsável @spec:AC-077', async () => {
      const request = new NextRequest(`http://localhost/api/oportunidades?responsavelId=${RESPONSAVEL_A}`, {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      expect(corpo.itens.map((c: { id: string }) => c.id)).toEqual([OPORTUNIDADE_COM_DADOS_A]);
    });
  });

  describe('AC-094: board expõe as etapas de destino alcançáveis a partir de cada etapa', () => {
    test('grafo traz as 15 etapas, e etapa 1 alcança 2 e 14 @spec:AC-094', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        headers: { Cookie: cookieA },
      });
      const resposta = await routeModule.GET(request);
      const corpo = await resposta.json();

      expect(Object.keys(corpo.grafo)).toHaveLength(15);
      expect([...corpo.grafo['1']].sort((a: number, b: number) => a - b)).toEqual([2, 14]);
    });
  });

  describe('T-044/AC-079/AC-080: POST cria card em "Entrada de leads"', () => {
    test('card novo nasce em "Entrada de leads" com version 1, no tenant da sessão @spec:AC-079', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        method: 'POST',
        headers: { Cookie: cookieA, 'content-type': 'application/json' },
        body: JSON.stringify({ leadId: tenants.leadA }),
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.etapaId).toBe(1);
      expect(corpo.version).toBe(1);
      expect(corpo.empresaId).toBe(tenants.empresaA);
    });

    test('empresaId do corpo é ignorado — card pertence ao tenant da sessão @spec:AC-080', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        method: 'POST',
        headers: { Cookie: cookieA, 'content-type': 'application/json' },
        body: JSON.stringify({ leadId: tenants.leadA, empresaId: tenants.empresaB }),
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.empresaId).toBe(tenants.empresaA);
    });
  });

  describe('AC-081: leadId inexistente ou de outro tenant é rejeitado', () => {
    test('leadId de outro tenant: 422 com codigo LEAD_NAO_ENCONTRADO, nenhum card criado @spec:AC-081', async () => {
      const request = new NextRequest('http://localhost/api/oportunidades', {
        method: 'POST',
        headers: { Cookie: cookieA, 'content-type': 'application/json' },
        body: JSON.stringify({ leadId: tenants.leadB }),
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('LEAD_NAO_ENCONTRADO');
    });
  });

  // Prova cruzada de isolamento de sessão: cookie de B nunca enxerga dado de A.
  test('empresa B autenticada não vê cards da empresa A', async () => {
    const request = new NextRequest('http://localhost/api/oportunidades', {
      headers: { Cookie: cookieB },
    });
    const resposta = await routeModule.GET(request);
    const corpo = await resposta.json();

    const ids: string[] = corpo.itens.map((c: { id: string }) => c.id);
    expect(ids).toContain(tenants.oportunidadeB);
    expect(ids).not.toContain(tenants.oportunidadeA);
  });
});
