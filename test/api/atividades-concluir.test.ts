// Testes de T-092 (fase2b-cadencia, US-054): rota
// `POST /api/atividades/:id/concluir`, contra um Postgres 15 efêmero real.
// Mesmo molde de test/api/cadencia-iniciar.test.ts (sessão via cookie
// real). O ator principal da maioria dos cenários é um GERENTE (ASM-061:
// MASTER/GERENTE/super admin concluem qualquer card do tenant) — o filtro
// por responsável (ATENDENTE só os próprios) tem um describe dedicado.
//
// AC-196/AC-197 exigem controlar o relógio que a rota lê (`new Date()`,
// ASM-062 — a rota é a borda real, só domínio/repositório recebem o
// relógio por parâmetro); por isso `vi.setSystemTime` fakeia só `Date`,
// nunca os timers do driver do Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import { iniciarCadencia } from '../../src/repositories/cadencia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const SENHA = 'senha-correta-123';
const ETAPA_ENTRADA = 1;
const ETAPA_QUALIFICANDO = 5;

const EMPRESA_A = 'bbbbbbbb-c011-0000-0000-00000000000a';
const EMPRESA_B = 'bbbbbbbb-c011-0000-0000-00000000000b';
const LEAD_A = 'bbbbbbbb-c011-0000-0000-0000000000a1';
const LEAD_B = 'bbbbbbbb-c011-0000-0000-0000000000b1';
const MASTER_A_ID = 'bbbbbbbb-c011-0000-0000-0000000000f1';
const MASTER_B_ID = 'bbbbbbbb-c011-0000-0000-0000000000f2';

// 2026-06-11 é quinta-feira — dia útil comum (mesma data usada pelos demais
// testes de T-089/T-090/T-091 desta feature).
const MANHA_UTIL = new Date('2026-06-11T09:00:00-03:00');
const TARDE_UTIL = new Date('2026-06-11T14:00:00-03:00');
const ANTES_DAS_13H = new Date('2026-06-11T12:30:00-03:00');

function postConcluir(id: string, cookie: string | null, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/atividades/${id}/concluir`, {
    method: 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('T-092: rota POST /api/atividades/:id/concluir', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let routeModule: typeof import('../../src/app/api/atividades/[id]/concluir/route');

  let cookieGerenteA: string;
  let cookieGerenteB: string;
  let cookieAtendenteA1: string;
  let cookieAtendenteA2: string;
  let atendenteA1Id: string;
  let gerenteAId: string;
  let gerenteBId: string;

  async function loginComoCookie(email: string, senha: string): Promise<string> {
    const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
    if (!sessionCookie) {
      throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
    }
    return sessionCookie.split(';')[0];
  }

  function criarOportunidade(empresaId: string, leadId: string, responsavelId?: string): string {
    const id = crypto.randomUUID();
    const resultado = pg.psqlComo(
      'crm_migrator',
      responsavelId
        ? `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id")
           VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA}, '${responsavelId}')`
        : `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id")
           VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function valor(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao consultar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function valorJson<T = unknown>(sqlTexto: string): T {
    return JSON.parse(valor(sqlTexto)) as T;
  }

  function versionAtual(oportunidadeId: string): number {
    return Number(valor(`SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`));
  }

  interface AtividadeLinha {
    id: string;
    sequencia: number;
    dia: number;
    turno: string;
    resultado: string;
  }

  function atividades(oportunidadeId: string): AtividadeLinha[] {
    return valorJson<AtividadeLinha[]>(
      `SELECT coalesce(json_agg(t), '[]'::json) FROM (
         SELECT id, sequencia, dia, turno, resultado
         FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' ORDER BY sequencia
       ) t`
    );
  }

  function estadoOportunidade(id: string) {
    return valorJson<{ etapa_id: number; version: number; cadencia_encerrada_em: string | null }>(
      `SELECT row_to_json(t) FROM (
         SELECT etapa_id, version, cadencia_encerrada_em FROM oportunidades WHERE id = '${id}'
       ) t`
    );
  }

  /** Inicia a cadência (dia 1, manhã) de um card já criado, sob o `ContextoTenant` informado. */
  async function iniciar(contexto: ContextoTenant, oportunidadeId: string) {
    await iniciarCadencia(db, contexto, oportunidadeId, {
      version: versionAtual(oportunidadeId),
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
    });
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Concluir A', 'empresa-teste-concluir-a'),
         ('${EMPRESA_B}', 'Empresa Teste Concluir B', 'empresa-teste-concluir-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Concluir A'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead Teste Concluir B');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de concluir: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = { usuarioId: MASTER_A_ID, empresaId: EMPRESA_A, papel: 'MASTER', isSuperAdmin: false };
    const atorMasterB: AtorConvite = { usuarioId: MASTER_B_ID, empresaId: EMPRESA_B, papel: 'MASTER', isSuperAdmin: false };

    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.concluir.a@teste.com', papel: 'GERENTE' });
    gerenteAId = conviteGerenteA.usuarioId;
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.concluir.b@teste.com', papel: 'GERENTE' });
    gerenteBId = conviteGerenteB.usuarioId;
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    const conviteAtendenteA1 = await convidarUsuario(db, atorMasterA, {
      email: 'atendente1.concluir.a@teste.com',
      papel: 'ATENDENTE',
    });
    atendenteA1Id = conviteAtendenteA1.usuarioId;
    await definirSenhaComToken(db, conviteAtendenteA1.token, SENHA);

    const conviteAtendenteA2 = await convidarUsuario(db, atorMasterA, {
      email: 'atendente2.concluir.a@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA2.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/atividades/[id]/concluir/route');

    cookieGerenteA = await loginComoCookie('gerente.concluir.a@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie('gerente.concluir.b@teste.com', SENHA);
    cookieAtendenteA1 = await loginComoCookie('atendente1.concluir.a@teste.com', SENHA);
    cookieAtendenteA2 = await loginComoCookie('atendente2.concluir.a@teste.com', SENHA);
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

  describe('AC-193: concluir com sem_resposta registra o fato', () => {
    test('toque fica sem_resposta, com realizada_em e realizada_por preenchidos @spec:AC-193', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);
      const toque1 = atividades(cardId).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.POST(postConcluir(toque1.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }), {
        params: Promise.resolve({ id: toque1.id }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.resultado).toBe('sem_resposta');
      expect(corpo.realizadaEm).not.toBeNull();
      expect(corpo.realizadaPor).toBe(gerenteAId);
    });
  });

  describe('AC-194: terceiro sem_resposta do bloco libera o seguinte', () => {
    test('ao concluir o terceiro toque sem_resposta da manhã, os 3 toques da tarde (4-6) nascem pendentes @spec:AC-194', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const pendentesDaManha = atividades(cardId).filter((t) => t.turno === 'manha');
      expect(pendentesDaManha).toHaveLength(3);

      for (const toque of pendentesDaManha) {
        const resposta = await routeModule.POST(
          postConcluir(toque.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
          { params: Promise.resolve({ id: toque.id }) }
        );
        expect(resposta.status).toBe(200);
      }

      const todas = atividades(cardId);
      expect(todas).toHaveLength(6);
      const tarde = todas.filter((t) => t.turno === 'tarde');
      expect(tarde.map((t) => t.sequencia)).toEqual([4, 5, 6]);
      expect(tarde.every((t) => t.resultado === 'pendente')).toBe(true);
    });
  });

  describe('AC-195: conectou interrompe a cadência na hora', () => {
    test('cancela as demais pendentes, encerra a cadência e move para Qualificando, na mesma transação @spec:AC-195', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);
      const [t1, t2, t3] = atividades(cardId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const concluidoT1 = await routeModule.POST(
        postConcluir(t1.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: t1.id }) }
      );
      expect(concluidoT1.status).toBe(200);

      const concluidoT2 = await routeModule.POST(
        postConcluir(t2.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'conectou' }),
        { params: Promise.resolve({ id: t2.id }) }
      );
      const corpoT2 = await concluidoT2.json();
      expect(concluidoT2.status).toBe(200);
      expect(corpoT2.resultado).toBe('conectou');

      const estado = estadoOportunidade(cardId);
      expect(estado.cadencia_encerrada_em).not.toBeNull();
      expect(estado.etapa_id).toBe(ETAPA_QUALIFICANDO);

      const todas = atividades(cardId);
      expect(todas).toHaveLength(3); // nenhum bloco novo gerado
      expect(todas.find((t) => t.id === t3.id)!.resultado).toBe('cancelada');
    });
  });

  describe('AC-196: toque fora de ordem ou fora do turno é recusado', () => {
    test('toque da tarde antes das 13h: 422 TURNO_NAO_LIBERADO e continua pendente @spec:AC-196', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      for (const toque of atividades(cardId).filter((t) => t.turno === 'manha')) {
        const resposta = await routeModule.POST(
          postConcluir(toque.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
          { params: Promise.resolve({ id: toque.id }) }
        );
        expect(resposta.status).toBe(200);
      }

      const toqueTarde = atividades(cardId).find((t) => t.sequencia === 4)!;

      vi.setSystemTime(ANTES_DAS_13H);
      const recusado = await routeModule.POST(
        postConcluir(toqueTarde.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toqueTarde.id }) }
      );
      const corpo = await recusado.json();

      expect(recusado.status).toBe(422);
      expect(corpo.codigo).toBe('TURNO_NAO_LIBERADO');
      expect(atividades(cardId).find((t) => t.id === toqueTarde.id)!.resultado).toBe('pendente');
    });

    test('toque de um bloco que ainda não é o corrente: 422 BLOCO_ANTERIOR_PENDENTE e continua pendente @spec:AC-196', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);

      // bloco corrente ainda é (dia 1, manhã) — insere, por fora do fluxo
      // normal, um toque da tarde (mesmo truque de test/db/cadencia-funcoes.test.ts).
      const atividadeForaDeOrdemId = crypto.randomUUID();
      const insercao = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO cadencia_atividades (id, oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
         VALUES ('${atividadeForaDeOrdemId}', '${cardId}', '${EMPRESA_A}', 4, 1, 'tarde', 'telefone', 'ligacao')`
      );
      expect(insercao.status).toBe(0);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(TARDE_UTIL);

      const recusado = await routeModule.POST(
        postConcluir(atividadeForaDeOrdemId, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: atividadeForaDeOrdemId }) }
      );
      const corpo = await recusado.json();

      expect(recusado.status).toBe(422);
      expect(corpo.codigo).toBe('BLOCO_ANTERIOR_PENDENTE');
      expect(atividades(cardId).find((t) => t.id === atividadeForaDeOrdemId)!.resultado).toBe('pendente');
    });
  });

  describe('AC-197: toque já concluído, cancelado ou de cadência encerrada não conclui de novo', () => {
    test('concluir de novo um toque que já não está pendente: 422 CADENCIA_ENCERRADA @spec:AC-197', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);
      const toque1 = atividades(cardId).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const primeira = await routeModule.POST(
        postConcluir(toque1.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toque1.id }) }
      );
      expect(primeira.status).toBe(200);

      const segunda = await routeModule.POST(
        postConcluir(toque1.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toque1.id }) }
      );
      const corpo = await segunda.json();

      expect(segunda.status).toBe(422);
      expect(corpo.codigo).toBe('CADENCIA_ENCERRADA');
      expect(atividades(cardId).find((t) => t.id === toque1.id)!.resultado).toBe('sem_resposta');
    });

    test('toque pendente de um card com cadencia_encerrada_em preenchido: 422 CADENCIA_ENCERRADA @spec:AC-197', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);

      // simula uma conexão por WhatsApp (fora desta feature) encerrando a
      // cadência direto no banco, sem passar pela rota — o toque segue
      // "pendente", mas o card não aceita mais conclusão alguma.
      const encerrar = pg.psqlComo('crm_migrator', `UPDATE oportunidades SET cadencia_encerrada_em = now() WHERE id = '${cardId}'`);
      expect(encerrar.status).toBe(0);

      const toque1 = atividades(cardId).find((t) => t.sequencia === 1)!;
      expect(toque1.resultado).toBe('pendente');

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const recusado = await routeModule.POST(
        postConcluir(toque1.id, cookieGerenteA, { version: versionAtual(cardId), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toque1.id }) }
      );
      const corpo = await recusado.json();

      expect(recusado.status).toBe(422);
      expect(corpo.codigo).toBe('CADENCIA_ENCERRADA');
      expect(atividades(cardId).find((t) => t.id === toque1.id)!.resultado).toBe('pendente');
    });
  });

  describe('AC-198: concluir exige sessão, tenant e versão', () => {
    test('version desatualizada: 409 CONFLITO_DE_VERSAO e o toque não muda @spec:AC-198', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);
      const toque1 = atividades(cardId).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.POST(postConcluir(toque1.id, cookieGerenteA, { version: 99, resultado: 'sem_resposta' }), {
        params: Promise.resolve({ id: toque1.id }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(409);
      expect(corpo.codigo).toBe('CONFLITO_DE_VERSAO');
      expect(atividades(cardId).find((t) => t.id === toque1.id)!.resultado).toBe('pendente');
    });

    test('toque de outra empresa: 404 e o toque não muda @spec:AC-198', async () => {
      const contextoGerenteB: ContextoTenant = { usuarioId: gerenteBId, empresaId: EMPRESA_B, papel: 'GERENTE', isSuperAdmin: false };
      const cardB = criarOportunidade(EMPRESA_B, LEAD_B);
      await iniciar(contextoGerenteB, cardB);
      const toqueB = atividades(cardB).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      // GERENTE da empresa A tentando concluir um toque da empresa B.
      const resposta = await routeModule.POST(postConcluir(toqueB.id, cookieGerenteA, { version: versionAtual(cardB), resultado: 'sem_resposta' }), {
        params: Promise.resolve({ id: toqueB.id }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(404);
      expect(corpo.codigo).toBeDefined();
      expect(atividades(cardB).find((t) => t.id === toqueB.id)!.resultado).toBe('pendente');
    });

    test('sem sessão: 401 NAO_AUTENTICADO e o toque não muda @spec:AC-198', async () => {
      const contextoGerenteA: ContextoTenant = { usuarioId: gerenteAId, empresaId: EMPRESA_A, papel: 'GERENTE', isSuperAdmin: false };
      const cardId = criarOportunidade(EMPRESA_A, LEAD_A);
      await iniciar(contextoGerenteA, cardId);
      const toque1 = atividades(cardId).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.POST(postConcluir(toque1.id, null, { version: versionAtual(cardId), resultado: 'sem_resposta' }), {
        params: Promise.resolve({ id: toque1.id }),
      });
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTENTICADO');
      expect(atividades(cardId).find((t) => t.id === toque1.id)!.resultado).toBe('pendente');
    });
  });

  describe('ASM-061: papel decide quem pode concluir', () => {
    test('ATENDENTE tentando concluir toque de um card de outro responsável: 403 SEM_PERMISSAO', async () => {
      const contextoAtendenteA1: ContextoTenant = {
        usuarioId: atendenteA1Id,
        empresaId: EMPRESA_A,
        papel: 'ATENDENTE',
        isSuperAdmin: false,
      };
      const cardDoAtendente1 = criarOportunidade(EMPRESA_A, LEAD_A, atendenteA1Id);
      await iniciar(contextoAtendenteA1, cardDoAtendente1);
      const toque1 = atividades(cardDoAtendente1).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.POST(
        postConcluir(toque1.id, cookieAtendenteA2, { version: versionAtual(cardDoAtendente1), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toque1.id }) }
      );
      const corpo = await resposta.json();

      expect(resposta.status).toBe(403);
      expect(corpo.codigo).toBe('SEM_PERMISSAO');
      expect(atividades(cardDoAtendente1).find((t) => t.id === toque1.id)!.resultado).toBe('pendente');
    });

    test('o próprio ATENDENTE responsável conclui normalmente', async () => {
      const contextoAtendenteA1: ContextoTenant = {
        usuarioId: atendenteA1Id,
        empresaId: EMPRESA_A,
        papel: 'ATENDENTE',
        isSuperAdmin: false,
      };
      const cardDoAtendente1 = criarOportunidade(EMPRESA_A, LEAD_A, atendenteA1Id);
      await iniciar(contextoAtendenteA1, cardDoAtendente1);
      const toque1 = atividades(cardDoAtendente1).find((t) => t.sequencia === 1)!;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.POST(
        postConcluir(toque1.id, cookieAtendenteA1, { version: versionAtual(cardDoAtendente1), resultado: 'sem_resposta' }),
        { params: Promise.resolve({ id: toque1.id }) }
      );
      expect(resposta.status).toBe(200);
    });
  });
});
