// T-062 (fase2c-sse, US-038): prova da rota `GET /api/stream` contra um
// Postgres 15 efêmero real (mesmo harness de test/api/oportunidades.test.ts),
// com uma empresa seedada e um usuário logado de verdade (cookie de sessão
// via Better Auth). Cobre: sem sessão não abre nada (AC-113); com sessão, a
// resposta é um `text/event-stream` sem cache que emite `: ping` a cada
// `INTERVALO_PING_MS` (AC-114) e repassa `oportunidade.movida` no formato
// SSE com o contrato do TDD (AC-108, aqui disparado direto via
// `pg_notify` — o fim a fim com a rota de transição real é T-063); fechar a
// conexão (abortar a requisição) cancela a inscrição no barramento e limpa
// o timer do batimento (AC-116).
//
// A rota usa os singletons `getDb()`/`getBarramento()`, então os módulos só
// podem ser importados DEPOIS de `process.env.DATABASE_URL` apontar pro
// Postgres efêmero deste teste — daí o `await import(...)` dinâmico dentro
// de `beforeAll`, mesmo padrão de test/api/oportunidades.test.ts.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { seedarDoisTenants, type TenantsSeedados } from '../support/seed-tenants';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

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

function getStream(headers: Record<string, string> = {}, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost/api/stream', { headers, signal });
}

interface BlocoDecodificado {
  texto: string;
}

/** Lê do stream SSE até fechar um bloco (`\n\n`) e devolve o bloco sem o terminador. */
async function lerProximoBloco(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: BlocoDecodificado
): Promise<string> {
  const decoder = new TextDecoder();
  while (!buffer.texto.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error('stream encerrado antes de completar um bloco SSE');
    }
    buffer.texto += decoder.decode(value, { stream: true });
  }
  const indice = buffer.texto.indexOf('\n\n');
  const bloco = buffer.texto.slice(0, indice);
  buffer.texto = buffer.texto.slice(indice + 2);
  return bloco;
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

/** `inscrever` só devolve depois de agendar a conexão — o `LISTEN` real no Postgres ainda é assíncrono (T-061). */
async function aguardarListenAtivo(pg: PostgresEfemero): Promise<void> {
  await aguardarCondicao(async () => {
    const resultado = pg.psqlComo(
      'postgres',
      `SELECT count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND query ILIKE 'LISTEN %'`,
      'postgres'
    );
    return resultado.stdout.trim() === '1';
  });
}

describe('T-062: rota GET /api/stream', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/stream/route');
  let barramentoModule: typeof import('../../src/lib/sse/barramento');
  let cookieA: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-0000-0000-0000-0000000000f1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/stream/route');
    barramentoModule = await import('../../src/lib/sse/barramento');

    cookieA = await loginComoCookie(auth, 'gerente.a@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    await barramentoModule?.getBarramento().encerrar();
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-113: sem login não há stream', () => {
    test('requisição sem sessão válida: 401 NAO_AUTENTICADO, nenhuma inscrição é aberta @spec:AC-113', async () => {
      const antes = barramentoModule.getBarramento().contarInscricoes();

      const resposta = await routeModule.GET(getStream());
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTENTICADO');
      expect(barramentoModule.getBarramento().contarInscricoes()).toBe(antes);
    });
  });

  describe('AC-114 e AC-108: stream autenticado com batimento e evento no contrato', () => {
    test('200 text/event-stream sem cache, bate a cada INTERVALO_PING_MS e repassa oportunidade.movida @spec:AC-114 @spec:AC-108', async () => {
      // O timer de batimento (`setInterval`) só vira um "fake timer" se já
      // existir fake timers ativos quando a rota o cria — por isso o
      // `vi.useFakeTimers()` precisa vir ANTES de `GET` (que dispara
      // `ReadableStream.start`, síncrono, dentro da própria chamada).
      // Restrito a setInterval/clearInterval: `resolverContexto` ainda vai
      // fazer consultas reais no Postgres dentro de `GET`, e essas dependem
      // de `setImmediate`/`setTimeout` internos do driver `pg` — fakeá-los
      // também travaria a consulta para sempre.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const controladorAbort = new AbortController();
      const resposta = await routeModule.GET(getStream({ Cookie: cookieA }, controladorAbort.signal));

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('Content-Type')).toBe('text/event-stream');
      expect(resposta.headers.get('Cache-Control')).toBe('no-cache, no-transform');

      const reader = resposta.body!.getReader();
      const buffer: BlocoDecodificado = { texto: '' };

      try {
        await vi.advanceTimersByTimeAsync(routeModule.INTERVALO_PING_MS);
      } finally {
        vi.useRealTimers();
      }
      const blocoPing = await lerProximoBloco(reader, buffer);
      expect(blocoPing).toBe(': ping');

      const oportunidadeId = 'ffffffff-0000-0000-0000-0000000000e1';
      const atorId = 'ffffffff-0000-0000-0000-0000000000e2';
      const ocorridoEm = new Date().toISOString();
      const payload = JSON.stringify({
        empresaId: tenants.empresaA,
        oportunidadeId,
        etapaOrigemId: 1,
        etapaDestinoId: 2,
        atorId,
        ocorridoEm,
      });
      await aguardarListenAtivo(pg);
      const notify = pg.psqlComo('crm_app', `SELECT pg_notify('oportunidade', $$${payload}$$)`);
      if (notify.status !== 0) {
        throw new Error(`Falha ao disparar NOTIFY de teste: ${notify.stderr}`);
      }

      const blocoEvento = await lerProximoBloco(reader, buffer);
      const linhas = blocoEvento.split('\n');
      expect(linhas[0]).toBe('event: oportunidade.movida');
      expect(linhas[1]).toMatch(/^data: /);

      const dados = JSON.parse(linhas[1].slice('data: '.length));
      expect(dados).toEqual({
        empresaId: tenants.empresaA,
        oportunidadeId,
        etapaOrigemId: 1,
        etapaDestinoId: 2,
        atorId,
        ocorridoEm,
      });

      controladorAbort.abort();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }, 30_000);
  });

  describe('AC-116: cliente que fecha libera os recursos', () => {
    test('abortar a requisição cancela a inscrição no barramento e limpa o timer de batimento @spec:AC-116', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const antes = barramentoModule.getBarramento().contarInscricoes();

      const controladorAbort = new AbortController();
      const resposta = await routeModule.GET(getStream({ Cookie: cookieA }, controladorAbort.signal));

      expect(resposta.status).toBe(200);
      expect(barramentoModule.getBarramento().contarInscricoes()).toBe(antes + 1);

      controladorAbort.abort();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(barramentoModule.getBarramento().contarInscricoes()).toBe(antes);
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });
  });
});
