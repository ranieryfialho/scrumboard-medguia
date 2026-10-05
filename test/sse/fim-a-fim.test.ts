// T-063 (fase2c-sse, US-037/US-038): prova fim a fim — a rota real
// `POST /api/oportunidades/:id/transicao` (T-047) move um card contra um
// Postgres 15 efêmero real e o barramento (T-061, mesmo singleton que
// `GET /api/stream` usa) entrega `oportunidade.movida` com o contrato do
// TDD (AC-108); um ouvinte da empresa que não é a do card não recebe nada,
// nem o evento nem o id (AC-109); e as três formas de transição recusada
// pela rota — 422 de regra de domínio, 409 de conflito de versão e 404 de
// card de outro tenant — não emitem nenhum evento (AC-110).
//
// A notificação em si (payload, rollback vs. commit) já tem prova própria
// em test/sse/notify-sql.test.ts (T-060) e o comportamento do barramento
// como consumidor de LISTEN/NOTIFY em test/sse/barramento.test.ts (T-061);
// aqui o que se prova é a cadeia completa partindo da rota HTTP real.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import type { EventoBarramento } from '../../src/lib/sse/barramento';

const SENHA = 'senha-correta-123';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2; // "1º dia de contato" — sem exigências, destino da transição com sucesso.
const ETAPA_NEGOCIACAO = 13; // não alcançável a partir da etapa 1 (fora do grafo — 422).

const CARD_SUCESSO = 'ffffffff-0000-0000-0000-0000000000b1';
const CARD_422 = 'ffffffff-0000-0000-0000-0000000000b2';
const CARD_409 = 'ffffffff-0000-0000-0000-0000000000b3';

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

function postTransicao(id: string, cookie: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/oportunidades/${id}/transicao`, {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function aguardarCondicao(
  condicao: () => boolean | Promise<boolean>,
  { tentativas = 50, intervaloMs = 100 }: { tentativas?: number; intervaloMs?: number } = {}
): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
  if (!(await condicao())) {
    throw new Error('Condição não satisfeita dentro do tempo esperado.');
  }
}

async function contarConexoesListen(pg: PostgresEfemero): Promise<number> {
  const resultado = pg.psqlComo(
    'postgres',
    `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`,
    'postgres'
  );
  return Number(resultado.stdout.trim());
}

describe('T-063: evento chega fim a fim e transição recusada não emite', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/[id]/transicao/route');
  let barramentoModule: typeof import('../../src/lib/sse/barramento');
  let cookieA: string;
  let cookieB: string;

  const eventosA: EventoBarramento[] = [];
  const eventosB: EventoBarramento[] = [];
  let cancelarA: () => void;
  let cancelarB: () => void;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const cartoes = [
      { id: CARD_SUCESSO, etapaId: ETAPA_ENTRADA },
      { id: CARD_422, etapaId: ETAPA_ENTRADA },
      { id: CARD_409, etapaId: ETAPA_ENTRADA },
    ];
    const valores = cartoes
      .map((c) => `('${c.id}', '${tenants.empresaA}', '${tenants.leadA}', ${c.etapaId})`)
      .join(',\n');
    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ${valores};`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures de transição: ${setup.stderr}`);
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
    routeModule = await import('../../src/app/api/oportunidades/[id]/transicao/route');
    barramentoModule = await import('../../src/lib/sse/barramento');

    cookieA = await loginComoCookie(auth, 'gerente.a@teste.com', SENHA);
    cookieB = await loginComoCookie(auth, 'gerente.b@teste.com', SENHA);

    cancelarA = barramentoModule.getBarramento().inscrever(tenants.empresaA, (evento) => eventosA.push(evento));
    cancelarB = barramentoModule.getBarramento().inscrever(tenants.empresaB, (evento) => eventosB.push(evento));
    await aguardarCondicao(() => barramentoModule.getBarramento().contarInscricoes() === 2);
    await aguardarCondicao(async () => (await contarConexoesListen(pg)) === 1);
  }, 120_000);

  afterAll(async () => {
    cancelarA?.();
    cancelarB?.();
    await barramentoModule?.getBarramento().encerrar();
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-108 e AC-109: mover um card emite o evento com o contrato do TDD, só para o tenant dele', () => {
    test('200 na rota real: empresa A recebe oportunidade.movida com os valores reais; empresa B não recebe nada @spec:AC-108 @spec:AC-109', async () => {
      const antes = Date.now();
      const resposta = await routeModule.POST(postTransicao(CARD_SUCESSO, cookieA, { version: 1, etapaDestinoId: ETAPA_1_DIA }), {
        params: Promise.resolve({ id: CARD_SUCESSO }),
      });
      expect(resposta.status).toBe(200);

      await aguardarCondicao(() => eventosA.some((e) => e.tipo === 'oportunidade.movida' && e.oportunidadeId === CARD_SUCESSO));

      const evento = eventosA.find((e) => e.tipo === 'oportunidade.movida' && e.oportunidadeId === CARD_SUCESSO);
      expect(evento).toMatchObject({
        tipo: 'oportunidade.movida',
        empresaId: tenants.empresaA,
        oportunidadeId: CARD_SUCESSO,
        etapaOrigemId: ETAPA_ENTRADA,
        etapaDestinoId: ETAPA_1_DIA,
      });
      if (evento && evento.tipo === 'oportunidade.movida') {
        expect(new Date(evento.ocorridoEm).getTime()).toBeGreaterThanOrEqual(antes - 1000);
        expect(evento.atorId).toBeTruthy();
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventosB.some((e) => e.tipo === 'oportunidade.movida' && e.oportunidadeId === CARD_SUCESSO)).toBe(false);
    });
  });

  describe('AC-110: transição recusada não emite evento', () => {
    test('422 de regra de domínio (fora do grafo) não gera oportunidade.movida @spec:AC-110', async () => {
      const antes = eventosA.length + eventosB.length;

      const resposta = await routeModule.POST(postTransicao(CARD_422, cookieA, { version: 1, etapaDestinoId: ETAPA_NEGOCIACAO }), {
        params: Promise.resolve({ id: CARD_422 }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('TRANSICAO_NAO_PERMITIDA');

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventosA.length + eventosB.length).toBe(antes);
    });

    test('409 de conflito de versão não gera oportunidade.movida @spec:AC-110', async () => {
      const primeira = await routeModule.POST(postTransicao(CARD_409, cookieA, { version: 1, etapaDestinoId: ETAPA_1_DIA }), {
        params: Promise.resolve({ id: CARD_409 }),
      });
      expect(primeira.status).toBe(200);
      await aguardarCondicao(() => eventosA.some((e) => e.tipo === 'oportunidade.movida' && e.oportunidadeId === CARD_409));

      const antes = eventosA.length + eventosB.length;

      // `version` 1 já foi consumida pela transição acima — reenviar com a
      // mesma `version` simula outro ator que ainda não sabia da mudança.
      // Destino 3 é uma aresta válida a partir da etapa atual (2), sem
      // exigências extras, pra isolar o conflito de versão (409) do 422 de
      // grafo/dados obrigatórios.
      const resposta = await routeModule.POST(postTransicao(CARD_409, cookieA, { version: 1, etapaDestinoId: 3 }), {
        params: Promise.resolve({ id: CARD_409 }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(409);
      expect(corpo.codigo).toBe('CONFLITO_DE_VERSAO');

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventosA.length + eventosB.length).toBe(antes);
    });

    test('404 de card de outro tenant não gera oportunidade.movida @spec:AC-110', async () => {
      const antes = eventosA.length + eventosB.length;

      const resposta = await routeModule.POST(
        postTransicao(tenants.oportunidadeA, cookieB, { version: 1, etapaDestinoId: ETAPA_1_DIA }),
        { params: Promise.resolve({ id: tenants.oportunidadeA }) }
      );

      expect(resposta.status).toBe(404);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventosA.length + eventosB.length).toBe(antes);
    });
  });
});
