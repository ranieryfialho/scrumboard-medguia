// Testes de T-156 (fase4-pipeline-telas, US-108/US-109): rotas
// `POST /api/oportunidades/:id/reabrir` e
// `POST /api/oportunidades/:id/anotacoes`, contra um Postgres 15 efêmero
// real — mesmo molde de test/api/oportunidades-transicao.test.ts (login real
// via better-auth, handler chamado direto com um `NextRequest`).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'eeeeeeee-1560-0000-0000-00000000000a';
const EMPRESA_B = 'eeeeeeee-1560-0000-0000-00000000000b';

const ETAPA_ENTRADA = 1;
const ETAPA_QUALIFICANDO = 5;
const ETAPA_NEGOCIACAO = 13;
const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `eeeeeeee-2266-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
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

describe('T-156: reabrir card e registrar anotação', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rotaReabrir: typeof import('../../src/app/api/oportunidades/[id]/reabrir/route');
  let rotaAnotacoes: typeof import('../../src/app/api/oportunidades/[id]/anotacoes/route');

  let cookieMasterA: string;
  let cookieGerenteA: string;
  let cookieAtendenteA: string;
  let cookieMasterB: string;

  let leadA: string;
  let leadB: string;
  let motivoSemInteresse: string;

  let cardPerdidoParaMaster: string;
  let cardGanhoParaGerente: string;
  let cardPerdidoParaAtendente: string;
  let cardPerdidoSemJustificativa: string;
  let cardAtivoNaoArquivado: string;
  let cardParaAnotacao: string;
  let cardDaEmpresaB: string;
  let masterAId: string;

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function criarOportunidade(empresaId: string, leadId: string, etapaId: number, motivoPerdaId?: string): string {
    const id = proximoUuid();
    const motivoSql = motivoPerdaId ? `'${motivoPerdaId}'` : 'NULL';
    executar(
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "motivo_perda_id")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${etapaId}, ${motivoSql})`
    );
    return id;
  }

  function postReabrir(id: string, cookie: string | null, body: Record<string, unknown>) {
    const request = new NextRequest(`http://localhost/api/oportunidades/${id}/reabrir`, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return rotaReabrir.POST(request, { params: Promise.resolve({ id }) });
  }

  function postAnotacao(id: string, cookie: string | null, body: unknown) {
    const request = new NextRequest(`http://localhost/api/oportunidades/${id}/anotacoes`, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return rotaAnotacoes.POST(request, { params: Promise.resolve({ id }) });
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    executar(
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Pipeline Escrita', 'empresa-a-pipeline-escrita'),
         ('${EMPRESA_B}', 'Empresa B Pipeline Escrita', 'empresa-b-pipeline-escrita')`
    );

    leadA = proximoUuid();
    executar(`INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadA}', '${EMPRESA_A}', 'Lead Pipeline Escrita A')`);
    leadB = proximoUuid();
    executar(`INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadB}', '${EMPRESA_B}', 'Lead Pipeline Escrita B')`);

    motivoSemInteresse = executar(`SELECT id FROM motivos_perda WHERE nome = 'Sem interesse' LIMIT 1`);

    cardPerdidoParaMaster = criarOportunidade(EMPRESA_A, leadA, ETAPA_PERDIDO, motivoSemInteresse);
    cardGanhoParaGerente = criarOportunidade(EMPRESA_A, leadA, ETAPA_CONTRATO_GANHO);
    cardPerdidoParaAtendente = criarOportunidade(EMPRESA_A, leadA, ETAPA_PERDIDO, motivoSemInteresse);
    cardPerdidoSemJustificativa = criarOportunidade(EMPRESA_A, leadA, ETAPA_PERDIDO, motivoSemInteresse);
    cardAtivoNaoArquivado = criarOportunidade(EMPRESA_A, leadA, ETAPA_ENTRADA);
    cardParaAnotacao = criarOportunidade(EMPRESA_A, leadA, ETAPA_ENTRADA);
    cardDaEmpresaB = criarOportunidade(EMPRESA_B, leadB, ETAPA_PERDIDO, motivoSemInteresse);

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-1560-0000-0000-0000000001f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-1560-0000-0000-0000000001f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a@pipeline-escrita.teste', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    masterAId = conviteMasterA.usuarioId;
    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@pipeline-escrita.teste', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, { email: 'atendente.a@pipeline-escrita.teste', papel: 'ATENDENTE' });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteMasterB = await convidarUsuario(db, atorMasterB, { email: 'master.b@pipeline-escrita.teste', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rotaReabrir = await import('../../src/app/api/oportunidades/[id]/reabrir/route');
    rotaAnotacoes = await import('../../src/app/api/oportunidades/[id]/anotacoes/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a@pipeline-escrita.teste', SENHA);
    cookieGerenteA = await loginComoCookie(auth, 'gerente.a@pipeline-escrita.teste', SENHA);
    cookieAtendenteA = await loginComoCookie(auth, 'atendente.a@pipeline-escrita.teste', SENHA);
    cookieMasterB = await loginComoCookie(auth, 'master.b@pipeline-escrita.teste', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('POST /api/oportunidades/:id/reabrir', () => {
    test('sem sessão: 401 NAO_AUTENTICADO, antes de tocar no banco @spec:AC-404', async () => {
      const resposta = await postReabrir(cardPerdidoParaMaster, null, { version: 1, justificativa: 'Cliente voltou a responder' });
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('MASTER reabre um card Perdido: volta a Qualificando e sai dos arquivados @spec:AC-404', async () => {
      const resposta = await postReabrir(cardPerdidoParaMaster, cookieMasterA, {
        version: 1,
        justificativa: 'Cliente voltou a responder',
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.etapaId).toBe(ETAPA_QUALIFICANDO);
      expect(corpo.version).toBe(2);

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${cardPerdidoParaMaster}' AND "tipo" = 'transicao_etapa' AND "etapa_destino_id" = ${ETAPA_QUALIFICANDO}`
      );
      expect(evento.stdout.trim()).toBe('1');
    });

    test('GERENTE reabre um card Ganho: volta a Negociação e sai dos arquivados @spec:AC-404', async () => {
      const resposta = await postReabrir(cardGanhoParaGerente, cookieGerenteA, {
        version: 1,
        justificativa: 'Contrato cancelado, retomando negociação',
        proximaAcaoEm: '2099-01-01T12:00:00-03:00',
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.etapaId).toBe(ETAPA_NEGOCIACAO);
    });

    test('ATENDENTE não pode reabrir: 403 SEM_PERMISSAO, card inalterado @spec:AC-404', async () => {
      const resposta = await postReabrir(cardPerdidoParaAtendente, cookieAtendenteA, {
        version: 1,
        justificativa: 'Cliente voltou a responder',
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(403);
      expect(corpo.codigo).toBe('SEM_PERMISSAO');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${cardPerdidoParaAtendente}'`
      );
      expect(linha.stdout.trim()).toBe(`${ETAPA_PERDIDO}|1`);
    });

    test('sem justificativa: 422 JUSTIFICATIVA_OBRIGATORIA, card inalterado @spec:AC-404', async () => {
      const resposta = await postReabrir(cardPerdidoSemJustificativa, cookieMasterA, { version: 1 });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(422);
      expect(corpo.codigo).toBe('JUSTIFICATIVA_OBRIGATORIA');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${cardPerdidoSemJustificativa}'`
      );
      expect(linha.stdout.trim()).toBe(`${ETAPA_PERDIDO}|1`);
    });

    test('card que não está arquivado: 422 TRANSICAO_NAO_PERMITIDA @spec:AC-404', async () => {
      const resposta = await postReabrir(cardAtivoNaoArquivado, cookieMasterA, {
        version: 1,
        justificativa: 'Não deveria valer',
      });
      expect(resposta.status).toBe(422);
      expect((await resposta.json()).codigo).toBe('TRANSICAO_NAO_PERMITIDA');
    });

    test('card de outra empresa: 404, mesmo para MASTER @spec:AC-404', async () => {
      const resposta = await postReabrir(cardDaEmpresaB, cookieMasterA, {
        version: 1,
        justificativa: 'Não deveria valer',
      });
      expect(resposta.status).toBe(404);
    });
  });

  describe('POST /api/oportunidades/:id/anotacoes', () => {
    test('sem sessão: 401 NAO_AUTENTICADO, antes de tocar no banco @spec:AC-409', async () => {
      const resposta = await postAnotacao(cardParaAnotacao, null, { texto: 'Liguei e confirmei o interesse' });
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('registra a anotação com o autor da sessão, como evento na linha do tempo @spec:AC-409', async () => {
      const resposta = await postAnotacao(cardParaAnotacao, cookieMasterA, { texto: 'Liguei e confirmei o interesse' });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.texto).toBe('Liguei e confirmei o interesse');
      expect(corpo.autorId).toBe(masterAId);
      expect(corpo.autorNome).toBe('master.a@pipeline-escrita.teste');

      const evento = pg.psqlComo(
        'crm_migrator',
        `SELECT "tipo", "payload"->>'texto', "ator_id" FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${cardParaAnotacao}' AND "tipo" = 'anotacao'`
      );
      expect(evento.stdout.trim()).toBe(`anotacao|Liguei e confirmei o interesse|${masterAId}`);
    });

    test('texto vazio não grava evento: 400 TEXTO_OBRIGATORIO @spec:AC-409', async () => {
      const antes = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${cardParaAnotacao}' AND "tipo" = 'anotacao'`
      );

      const resposta = await postAnotacao(cardParaAnotacao, cookieMasterA, { texto: '   ' });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('TEXTO_OBRIGATORIO');

      const depois = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${cardParaAnotacao}' AND "tipo" = 'anotacao'`
      );
      expect(depois.stdout.trim()).toBe(antes.stdout.trim());
    });

    test('card de outra empresa: 404, sem vazar dado', async () => {
      const resposta = await postAnotacao(cardDaEmpresaB, cookieMasterA, { texto: 'Não deveria valer' });
      expect(resposta.status).toBe(404);
    });
  });
});
