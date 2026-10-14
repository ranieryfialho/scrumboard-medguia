// Testes de T-092 (fase2b-cadencia, US-053): rota `GET /api/atividades`,
// contra um Postgres 15 efêmero real. Mesmo molde de
// test/api/cadencia-iniciar.test.ts (sessão via cookie real), mas aqui
// precisamos de três papéis diferentes (GERENTE e dois ATENDENTE) para
// provar o filtro de responsável de ASM-061 — por isso o seed é próprio
// deste arquivo em vez de test/support/seed-tenants.ts.
//
// AC-192 exige o turno vigente em `America/Sao_Paulo` no instante da
// chamada; como a rota lê `new Date()` (ASM-062 diz que só o domínio/
// repositório recebem o relógio por parâmetro — a rota é a borda real), os
// testes controlam o relógio com `vi.setSystemTime` (fakeia só `Date`,
// nunca os timers do driver do Postgres).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import { concluirAtividade, iniciarCadencia } from '../../src/repositories/cadencia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const SENHA = 'senha-correta-123';
const ETAPA_ENTRADA = 1;

const EMPRESA = 'aaaaaaaa-f110-0000-0000-00000000000a';
const LEAD = 'aaaaaaaa-f110-0000-0000-0000000000a1';
const MASTER_ID = 'aaaaaaaa-f110-0000-0000-0000000000f1';

// 2026-06-11 é quinta-feira — dia útil comum, fora da lista de feriados de
// T-088 (mesma data usada por test/repositories/cadencia.test.ts).
const MANHA_UTIL = new Date('2026-06-11T09:00:00-03:00');
const TARDE_UTIL = new Date('2026-06-11T14:00:00-03:00');
const FORA_DE_TURNO = new Date('2026-06-11T12:30:00-03:00');
const SABADO = new Date('2026-06-13T10:00:00-03:00');

function getAtividades(cookie: string | null) {
  return new NextRequest('http://localhost/api/atividades', {
    method: 'GET',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe('T-092: rota GET /api/atividades', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let routeModule: typeof import('../../src/app/api/atividades/route');

  let cookieGerente: string;
  let cookieAtendente1: string;
  let cookieAtendente2: string;
  let atendente1Id: string;
  let atendente2Id: string;

  let cardAtendente1Id: string;
  let cardAtendente2Id: string;
  let cardTardeId: string;

  async function loginComoCookie(email: string, senha: string): Promise<string> {
    const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
    if (!sessionCookie) {
      throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
    }
    return sessionCookie.split(';')[0];
  }

  function criarOportunidade(responsavelId: string): string {
    const id = crypto.randomUUID();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id")
       VALUES ('${id}', '${EMPRESA}', '${LEAD}', ${ETAPA_ENTRADA}, '${responsavelId}')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function versionAtual(oportunidadeId: string): number {
    const resultado = pg.psqlComo('crm_migrator', `SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`);
    return Number(resultado.stdout.trim());
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA}', 'Empresa Teste Fila Cadencia', 'empresa-teste-fila-cadencia');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD}', '${EMPRESA}', 'Lead Teste Fila');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes da fila: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMaster: AtorConvite = { usuarioId: MASTER_ID, empresaId: EMPRESA, papel: 'MASTER', isSuperAdmin: false };

    const conviteGerente = await convidarUsuario(db, atorMaster, { email: 'gerente.fila@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerente.token, SENHA);

    const conviteAtendente1 = await convidarUsuario(db, atorMaster, {
      email: 'atendente1.fila@teste.com',
      papel: 'ATENDENTE',
    });
    atendente1Id = conviteAtendente1.usuarioId;
    await definirSenhaComToken(db, conviteAtendente1.token, SENHA);

    const conviteAtendente2 = await convidarUsuario(db, atorMaster, {
      email: 'atendente2.fila@teste.com',
      papel: 'ATENDENTE',
    });
    atendente2Id = conviteAtendente2.usuarioId;
    await definirSenhaComToken(db, conviteAtendente2.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/atividades/route');

    cookieGerente = await loginComoCookie('gerente.fila@teste.com', SENHA);
    cookieAtendente1 = await loginComoCookie('atendente1.fila@teste.com', SENHA);
    cookieAtendente2 = await loginComoCookie('atendente2.fila@teste.com', SENHA);

    // card do atendente 1: bloco da manhã pendente.
    cardAtendente1Id = criarOportunidade(atendente1Id);
    const contextoAtendente1: ContextoTenant = {
      usuarioId: atendente1Id,
      empresaId: EMPRESA,
      papel: 'ATENDENTE',
      isSuperAdmin: false,
    };
    await iniciarCadencia(db, contextoAtendente1, cardAtendente1Id, {
      version: versionAtual(cardAtendente1Id),
      atorId: atendente1Id,
      atorTipo: 'usuario',
    });

    // card do atendente 2: bloco da manhã pendente — não deve aparecer na fila do atendente 1.
    cardAtendente2Id = criarOportunidade(atendente2Id);
    const contextoAtendente2: ContextoTenant = {
      usuarioId: atendente2Id,
      empresaId: EMPRESA,
      papel: 'ATENDENTE',
      isSuperAdmin: false,
    };
    await iniciarCadencia(db, contextoAtendente2, cardAtendente2Id, {
      version: versionAtual(cardAtendente2Id),
      atorId: atendente2Id,
      atorTipo: 'usuario',
    });

    // card extra do atendente 1, com a manhã já concluída (sem_resposta) —
    // libera o bloco da tarde (AC-194), que só aparece na fila a partir das
    // 13h.
    cardTardeId = criarOportunidade(atendente1Id);
    await iniciarCadencia(db, contextoAtendente1, cardTardeId, {
      version: versionAtual(cardTardeId),
      atorId: atendente1Id,
      atorTipo: 'usuario',
    });
    const resultadoManha = pg.psqlComo(
      'crm_migrator',
      `SELECT id FROM cadencia_atividades WHERE oportunidade_id = '${cardTardeId}' ORDER BY sequencia`
    );
    const idsManha = resultadoManha.stdout
      .trim()
      .split('\n')
      .map((linha) => linha.trim())
      .filter(Boolean);
    for (const atividadeId of idsManha) {
      await concluirAtividade(db, contextoAtendente1, atividadeId, {
        version: versionAtual(cardTardeId),
        resultado: 'sem_resposta',
        atorId: atendente1Id,
        atorTipo: 'usuario',
        agora: MANHA_UTIL,
      });
    }
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-192: fila "Minhas tarefas" lista só o turno liberado', () => {
    test('ATENDENTE vê só os toques pendentes do próprio responsável, no turno vigente @spec:AC-192', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const oportunidadesNaFila = new Set(corpo.itens.map((item: { oportunidade: { id: string } }) => item.oportunidade.id));
      expect(oportunidadesNaFila.has(cardAtendente1Id)).toBe(true);
      expect(oportunidadesNaFila.has(cardAtendente2Id)).toBe(false);
      expect(corpo.itens.every((item: { atividade: { turno: string } }) => item.atividade.turno === 'manha')).toBe(true);
    });

    test('MASTER/GERENTE vê os toques pendentes de todo o tenant, não só os do próprio responsável @spec:AC-192', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieGerente));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const oportunidadesNaFila = new Set(corpo.itens.map((item: { oportunidade: { id: string } }) => item.oportunidade.id));
      expect(oportunidadesNaFila.has(cardAtendente1Id)).toBe(true);
      expect(oportunidadesNaFila.has(cardAtendente2Id)).toBe(true);
    });

    test('o bloco da tarde só aparece na fila a partir das 13h, mesmo já existindo no banco @spec:AC-192', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });

      vi.setSystemTime(FORA_DE_TURNO);
      const antesDas13h = await routeModule.GET(getAtividades(cookieAtendente1));
      const corpoAntes = await antesDas13h.json();
      expect(corpoAntes.itens).toEqual([]);

      vi.setSystemTime(TARDE_UTIL);
      const depoisDas13h = await routeModule.GET(getAtividades(cookieAtendente1));
      const corpoDepois = await depoisDas13h.json();
      const oportunidadesDaTarde = new Set(
        corpoDepois.itens.map((item: { oportunidade: { id: string } }) => item.oportunidade.id)
      );
      expect(oportunidadesDaTarde.has(cardTardeId)).toBe(true);
      expect(corpoDepois.itens.every((item: { atividade: { turno: string } }) => item.atividade.turno === 'tarde')).toBe(
        true
      );
    });

    test('fora de turno, em dia não útil, a fila vem vazia @spec:AC-192', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });

      vi.setSystemTime(FORA_DE_TURNO);
      const foraDeTurno = await routeModule.GET(getAtividades(cookieAtendente1));
      expect((await foraDeTurno.json()).itens).toEqual([]);

      vi.setSystemTime(SABADO);
      const sabado = await routeModule.GET(getAtividades(cookieAtendente1));
      expect((await sabado.json()).itens).toEqual([]);
    });

    test('sem sessão: 401 NAO_AUTENTICADO @spec:AC-192', async () => {
      const resposta = await routeModule.GET(getAtividades(null));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTENTICADO');
    });
  });
});
