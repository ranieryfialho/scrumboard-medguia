// Testes de T-047 (fase2-kanban, US-031): rota
// `POST /api/oportunidades/:id/transicao` — único jeito de mudar a etapa de
// um card, contra um Postgres 15 efêmero real com dois tenants seedados
// (test/support/seed-tenants.ts). Mesmos moldes de test/api/oportunidades.test.ts.
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

const ETAPA_PERDIDO = 14;
const ETAPA_ALTERNATIVA = 2; // "1º dia de contato" — sem exigências.
const ETAPA_NEGOCIACAO = 13; // não alcançável a partir da etapa 1 (AC-083).
const ETAPA_DESTINO_RESTRITA = 4; // "3º dia de contato" — usada só pela transição forjada (2→4) abaixo.

const CARD_AC082 = 'ffffffff-0000-0000-0000-0000000000a1';
const CARD_AC083 = 'ffffffff-0000-0000-0000-0000000000a2';
const CARD_AC084 = 'ffffffff-0000-0000-0000-0000000000a3';
const CARD_AC085 = 'ffffffff-0000-0000-0000-0000000000a4';
const CARD_AC086 = 'ffffffff-0000-0000-0000-0000000000a5';

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

function postTransicao(id: string, cookie: string, body: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost/api/oportunidades/${id}/transicao`, {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return request;
}

describe('T-047: rota POST /api/oportunidades/:id/transicao', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/[id]/transicao/route');
  let cookieA: string;
  let cookieB: string;
  let motivoPerdaId: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const cartoes = [
      { id: CARD_AC082, etapaId: 1 },
      { id: CARD_AC083, etapaId: 1 },
      { id: CARD_AC084, etapaId: ETAPA_ALTERNATIVA },
      { id: CARD_AC085, etapaId: 1 },
      { id: CARD_AC086, etapaId: 1 },
    ];
    const valoresCartoes = cartoes
      .map((c) => `('${c.id}', '${tenants.empresaA}', '${tenants.leadA}', ${c.etapaId})`)
      .join(',\n');

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES
         ${valoresCartoes};
       -- Transição forjada só para provar AC-084 (papel sem permissão): o
       -- grafo seedado (drizzle/0005_seeds.sql) libera todo papel em toda
       -- combinação, então nenhuma transição real exercita PAPEL_NAO_PERMITIDO.
       INSERT INTO "pipeline_transicoes" ("etapa_origem_id", "etapa_destino_id", "exige_justificativa", "papeis_permitidos")
       VALUES (${ETAPA_ALTERNATIVA}, ${ETAPA_DESTINO_RESTRITA}, false, ARRAY['MASTER']::papel_usuario[]);`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de transição: ${setup.stderr}`);
    }

    const motivo = pg.psqlComo(
      'crm_migrator',
      `SELECT "id" FROM "motivos_perda" WHERE "nome" = 'Sem interesse' LIMIT 1`
    );
    if (motivo.status !== 0 || !motivo.stdout.trim()) {
      throw new Error(`Falha ao buscar motivo de perda de fixture: ${motivo.stderr}`);
    }
    motivoPerdaId = motivo.stdout.trim();

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
    routeModule = await import('../../src/app/api/oportunidades/[id]/transicao/route');

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

  describe('AC-082: transição permitida grava etapa, dados de guard e evento atomicamente', () => {
    test('move pra "Perdido" com motivo: 200, etapa/version/motivo atualizados @spec:AC-082', async () => {
      const request = postTransicao(CARD_AC082, cookieA, {
        version: 1,
        etapaDestinoId: ETAPA_PERDIDO,
        motivoPerdaId,
      });
      const resposta = await routeModule.POST(request, { params: Promise.resolve({ id: CARD_AC082 }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.etapaId).toBe(ETAPA_PERDIDO);
      expect(corpo.version).toBe(2);
      expect(corpo.motivoPerdaId).toBe(motivoPerdaId);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${CARD_AC082}' AND "tipo" = 'transicao_etapa'`
      );
      expect(evento.stdout.trim()).toBe('1');
    });
  });

  describe('AC-083: transição fora do grafo não move o card', () => {
    test('destino sem linha em pipeline_transicoes: 422 TRANSICAO_NAO_PERMITIDA, card inalterado @spec:AC-083', async () => {
      const request = postTransicao(CARD_AC083, cookieA, {
        version: 1,
        etapaDestinoId: ETAPA_NEGOCIACAO,
      });
      const resposta = await routeModule.POST(request, { params: Promise.resolve({ id: CARD_AC083 }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('TRANSICAO_NAO_PERMITIDA');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${CARD_AC083}'`
      );
      expect(linha.stdout.trim()).toBe('1|1');
    });
  });

  describe('AC-084: transição com papel sem permissão não move o card', () => {
    test('papeisPermitidos não inclui o papel do ator: 422 PAPEL_NAO_PERMITIDO, card inalterado @spec:AC-084', async () => {
      const request = postTransicao(CARD_AC084, cookieA, {
        version: 1,
        etapaDestinoId: ETAPA_DESTINO_RESTRITA,
      });
      const resposta = await routeModule.POST(request, { params: Promise.resolve({ id: CARD_AC084 }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('PAPEL_NAO_PERMITIDO');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${CARD_AC084}'`
      );
      expect(linha.stdout.trim()).toBe(`${ETAPA_ALTERNATIVA}|1`);
    });
  });

  describe('AC-085: transição com dado obrigatório faltante não move o card', () => {
    test('etapa "Perdido" sem motivoPerdaId: 422 MOTIVO_PERDA_OBRIGATORIO, card inalterado @spec:AC-085', async () => {
      const request = postTransicao(CARD_AC085, cookieA, {
        version: 1,
        etapaDestinoId: ETAPA_PERDIDO,
      });
      const resposta = await routeModule.POST(request, { params: Promise.resolve({ id: CARD_AC085 }) });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('MOTIVO_PERDA_OBRIGATORIO');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${CARD_AC085}'`
      );
      expect(linha.stdout.trim()).toBe('1|1');
    });
  });

  describe('AC-086: conflito de versão é rejeitado sem sobrescrever', () => {
    test('version desatualizada: 409 CONFLITO_DE_VERSAO, card permanece como estava @spec:AC-086', async () => {
      const primeira = await routeModule.POST(
        postTransicao(CARD_AC086, cookieA, { version: 1, etapaDestinoId: ETAPA_ALTERNATIVA }),
        { params: Promise.resolve({ id: CARD_AC086 }) }
      );
      expect(primeira.status).toBe(200);

      // `version` 1 já foi consumida pela transição acima (card está em
      // version 2 agora) — reenviar com a mesma `version` simula outro ator
      // que ainda não sabia da mudança.
      const resposta = await routeModule.POST(
        postTransicao(CARD_AC086, cookieA, { version: 1, etapaDestinoId: ETAPA_PERDIDO, motivoPerdaId }),
        { params: Promise.resolve({ id: CARD_AC086 }) }
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(409);
      expect(corpo.codigo).toBe('CONFLITO_DE_VERSAO');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${CARD_AC086}'`
      );
      expect(linha.stdout.trim()).toBe(`${ETAPA_ALTERNATIVA}|2`);
    });
  });

  describe('AC-087: card de outro tenant não é encontrado (fail closed)', () => {
    test('sessão da empresa B tentando mover card da empresa A: 404 @spec:AC-087', async () => {
      const request = postTransicao(tenants.oportunidadeA, cookieB, {
        version: 1,
        etapaDestinoId: ETAPA_ALTERNATIVA,
      });
      const resposta = await routeModule.POST(request, { params: Promise.resolve({ id: tenants.oportunidadeA }) });

      expect(resposta.status).toBe(404);

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${tenants.oportunidadeA}'`
      );
      expect(linha.stdout.trim()).toBe('1|1');
    });
  });
});
