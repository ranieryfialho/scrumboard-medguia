// Testes de T-095 (fase2b-fila-tarefas, US-056/US-058): rota `GET
// /api/atividades`, contra um Postgres 15 efêmero real. Mesmo molde de
// test/api/atividades.test.ts (sessão via cookie real, dois ATENDENTE e um
// GERENTE para provar ASM-061), estendido para AC-212 (parâmetro
// `?atrasados=1`) e AC-205 (dados do lead em cada item).
//
// AC-212/ASM-065 depende de `liberada_em` (migration 0012, T-094) — como
// `iniciarCadencia`/`concluirAtividade` sempre liberam no instante real da
// chamada (nunca no relógio fake do teste), os toques "atrasados" são
// fabricados retroagindo `liberada_em` via UPDATE direto (`psqlComo`), a
// única forma de simular "liberado num turno/dia anterior" sem esperar o
// tempo real passar.
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

const EMPRESA_A = 'bbbbbbbb-f110-0000-0000-00000000000a';
const EMPRESA_B = 'bbbbbbbb-f110-0000-0000-00000000000b';
const LEAD_A = 'bbbbbbbb-f110-0000-0000-0000000000a1';
const LEAD_B = 'bbbbbbbb-f110-0000-0000-0000000000b1';
const MASTER_A_ID = 'bbbbbbbb-f110-0000-0000-0000000000f1';
const MASTER_B_ID = 'bbbbbbbb-f110-0000-0000-0000000000f2';

// 2026-06-11 é quinta-feira — dia útil comum, fora da lista de feriados de
// T-088 (mesma data usada por test/api/atividades.test.ts).
const MANHA_UTIL = new Date('2026-06-11T09:00:00-03:00');
const ONTEM_TARDE = new Date('2026-06-10T14:00:00-03:00');

function getAtividades(cookie: string | null, query?: string) {
  return new NextRequest(`http://localhost/api/atividades${query ?? ''}`, {
    method: 'GET',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

type ItemResposta = {
  atividade: { id: string; turno: string };
  oportunidade: { id: string };
  lead: { id: string; nome: string; telefoneE164: string | null };
  atrasado?: boolean;
};

describe('T-095: rota GET /api/atividades — atrasados e dados do lead', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let routeModule: typeof import('../../src/app/api/atividades/route');

  let cookieAtendente1: string;
  let cookieAtendente2: string;
  let cookieGerenteB: string;
  let atendente1Id: string;
  let atendente2Id: string;
  let gerenteBId: string;

  let cardVigenteId: string;
  let cardAtrasadoMesmoTurnoId: string;
  let atividadeAtrasadaMesmoTurnoId: string;
  let cardOutroResponsavelId: string;
  let cardOutraEmpresaId: string;

  async function loginComoCookie(email: string, senha: string): Promise<string> {
    const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
    if (!sessionCookie) {
      throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
    }
    return sessionCookie.split(';')[0];
  }

  function criarOportunidade(empresaId: string, leadId: string, responsavelId: string): string {
    const id = crypto.randomUUID();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "responsavel_id")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_ENTRADA}, '${responsavelId}')`
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

  function idsDoBloco(oportunidadeId: string): string[] {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `SELECT id FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' ORDER BY sequencia`
    );
    return resultado.stdout
      .trim()
      .split('\n')
      .map((linha) => linha.trim())
      .filter(Boolean);
  }

  function retroagirLiberadaEm(atividadeId: string, instante: Date): void {
    const resultado = pg.psqlComo(
      'crm_migrator',
      `UPDATE cadencia_atividades SET liberada_em = '${instante.toISOString()}'::timestamptz WHERE id = '${atividadeId}'`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao retroagir liberada_em: ${resultado.stderr}`);
    }
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Atrasados A', 'empresa-teste-atrasados-a'),
         ('${EMPRESA_B}', 'Empresa Teste Atrasados B', 'empresa-teste-atrasados-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste Atrasados', '+5511999990001'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead Outra Empresa', '+5511999990002');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de atrasados: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = { usuarioId: MASTER_A_ID, empresaId: EMPRESA_A, papel: 'MASTER', isSuperAdmin: false };
    const atorMasterB: AtorConvite = { usuarioId: MASTER_B_ID, empresaId: EMPRESA_B, papel: 'MASTER', isSuperAdmin: false };

    const conviteAtendente1 = await convidarUsuario(db, atorMasterA, {
      email: 'atendente1.atrasados@teste.com',
      papel: 'ATENDENTE',
    });
    atendente1Id = conviteAtendente1.usuarioId;
    await definirSenhaComToken(db, conviteAtendente1.token, SENHA);

    const conviteAtendente2 = await convidarUsuario(db, atorMasterA, {
      email: 'atendente2.atrasados@teste.com',
      papel: 'ATENDENTE',
    });
    atendente2Id = conviteAtendente2.usuarioId;
    await definirSenhaComToken(db, conviteAtendente2.token, SENHA);

    const conviteGerenteB = await convidarUsuario(db, atorMasterB, {
      email: 'gerente.atrasados.b@teste.com',
      papel: 'GERENTE',
    });
    gerenteBId = conviteGerenteB.usuarioId;
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/atividades/route');

    cookieAtendente1 = await loginComoCookie('atendente1.atrasados@teste.com', SENHA);
    cookieAtendente2 = await loginComoCookie('atendente2.atrasados@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie('gerente.atrasados.b@teste.com', SENHA);

    const contextoAtendente1: ContextoTenant = {
      usuarioId: atendente1Id,
      empresaId: EMPRESA_A,
      papel: 'ATENDENTE',
      isSuperAdmin: false,
    };
    const contextoAtendente2: ContextoTenant = {
      usuarioId: atendente2Id,
      empresaId: EMPRESA_A,
      papel: 'ATENDENTE',
      isSuperAdmin: false,
    };

    // card do atendente 1: bloco da manhã liberado agora — fica no turno
    // vigente quando a fila é consultada em MANHA_UTIL (AC-192 inalterado).
    cardVigenteId = criarOportunidade(EMPRESA_A, LEAD_A, atendente1Id);
    await iniciarCadencia(db, contextoAtendente1, cardVigenteId, {
      version: versionAtual(cardVigenteId),
      atorId: atendente1Id,
      atorTipo: 'usuario',
    });

    // card do atendente 1: bloco da manhã, mas com `liberada_em` retroagido
    // para ontem à tarde — ASM-065 ("dia-calendário anterior"), mesmo com
    // `turno = 'manha'` batendo com o vigente de hoje. Prova que o atraso é
    // decidido por `liberada_em`, não só por igualdade de `turno`.
    cardAtrasadoMesmoTurnoId = criarOportunidade(EMPRESA_A, LEAD_A, atendente1Id);
    await iniciarCadencia(db, contextoAtendente1, cardAtrasadoMesmoTurnoId, {
      version: versionAtual(cardAtrasadoMesmoTurnoId),
      atorId: atendente1Id,
      atorTipo: 'usuario',
    });
    [atividadeAtrasadaMesmoTurnoId] = idsDoBloco(cardAtrasadoMesmoTurnoId);
    for (const id of idsDoBloco(cardAtrasadoMesmoTurnoId)) {
      retroagirLiberadaEm(id, ONTEM_TARDE);
    }

    // card do atendente 2 (mesmo tenant): não deve aparecer na fila do
    // atendente 1 (ASM-061), nem nos atrasados dele.
    cardOutroResponsavelId = criarOportunidade(EMPRESA_A, LEAD_A, atendente2Id);
    await iniciarCadencia(db, contextoAtendente2, cardOutroResponsavelId, {
      version: versionAtual(cardOutroResponsavelId),
      atorId: atendente2Id,
      atorTipo: 'usuario',
    });
    for (const id of idsDoBloco(cardOutroResponsavelId)) {
      retroagirLiberadaEm(id, ONTEM_TARDE);
    }

    // card da empresa B: isolamento de tenant também vale para atrasados.
    const contextoGerenteB: ContextoTenant = {
      usuarioId: gerenteBId,
      empresaId: EMPRESA_B,
      papel: 'GERENTE',
      isSuperAdmin: false,
    };
    cardOutraEmpresaId = criarOportunidade(EMPRESA_B, LEAD_B, gerenteBId);
    await iniciarCadencia(db, contextoGerenteB, cardOutraEmpresaId, {
      version: versionAtual(cardOutraEmpresaId),
      atorId: gerenteBId,
      atorTipo: 'usuario',
    });
    for (const id of idsDoBloco(cardOutraEmpresaId)) {
      retroagirLiberadaEm(id, ONTEM_TARDE);
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

  describe('AC-205: cada toque mostra o lead, o canal e a posição na cadência', () => {
    test('o item traz nome e telefone do lead, canal, tipo e sequência (toque N de 18) @spec:AC-205', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const item = (corpo.itens as ItemResposta[]).find((i) => i.oportunidade.id === cardVigenteId);
      expect(item).toBeDefined();
      expect(item!.lead).toEqual({ id: LEAD_A, nome: 'Lead Teste Atrasados', telefoneE164: '+5511999990001' });
      expect((item as unknown as { atividade: { canal: string; tipo: string; sequencia: number } }).atividade.canal).toBe(
        'telefone'
      );
      expect((item as unknown as { atividade: { tipo: string } }).atividade.tipo).toBe('ligacao');
      expect((item as unknown as { atividade: { sequencia: number } }).atividade.sequencia).toBe(1);
    });
  });

  describe('AC-212: a rota devolve os atrasados quando pedidos', () => {
    test('sem o parâmetro, a resposta é a de AC-192 — sem o campo atrasado:true @spec:AC-212', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const itens = corpo.itens as ItemResposta[];
      const idsNaFila = new Set(itens.map((item) => item.oportunidade.id));
      expect(idsNaFila.has(cardVigenteId)).toBe(true);
      // AC-192 inalterado: a seleção continua só por `turno = vigente`, sem
      // olhar `liberada_em` — por isso nenhum item vem marcado atrasado:true.
      expect(itens.every((item) => item.atrasado === false)).toBe(true);
    });

    test('com ?atrasados=1, o toque de dia anterior volta com atrasado:true e o do turno vigente com atrasado:false @spec:AC-212', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1, '?atrasados=1'));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const itens = corpo.itens as ItemResposta[];

      const itemVigente = itens.find((item) => item.oportunidade.id === cardVigenteId);
      expect(itemVigente).toBeDefined();
      expect(itemVigente!.atrasado).toBe(false);

      const itemAtrasado = itens.find((item) => item.oportunidade.id === cardAtrasadoMesmoTurnoId);
      expect(itemAtrasado).toBeDefined();
      expect(itemAtrasado!.atrasado).toBe(true);
      expect(itemAtrasado!.atividade.id).toBe(atividadeAtrasadaMesmoTurnoId);

      // nenhum toque duplicado: cada atividade aparece uma única vez.
      const idsDasAtividades = itens.map((item) => item.atividade.id);
      expect(idsDasAtividades.length).toBe(new Set(idsDasAtividades).size);

      // ASM-061: isolamento por responsável também vale para os atrasados.
      expect(itens.some((item) => item.oportunidade.id === cardOutroResponsavelId)).toBe(false);
    });

    test('isolamento por tenant: atrasados de uma empresa nunca aparecem para outra @spec:AC-212', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(MANHA_UTIL);

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1, '?atrasados=1'));
      const corpo = await resposta.json();

      const idsNaFila = new Set((corpo.itens as ItemResposta[]).map((item) => item.oportunidade.id));
      expect(idsNaFila.has(cardOutraEmpresaId)).toBe(false);

      const respostaGerenteB = await routeModule.GET(getAtividades(cookieGerenteB, '?atrasados=1'));
      const corpoGerenteB = await respostaGerenteB.json();
      const idsGerenteB = new Set((corpoGerenteB.itens as ItemResposta[]).map((item) => item.oportunidade.id));
      expect(idsGerenteB.has(cardOutraEmpresaId)).toBe(true);
      expect(idsGerenteB.has(cardVigenteId)).toBe(false);
      expect(idsGerenteB.has(cardAtrasadoMesmoTurnoId)).toBe(false);
    });

    test('atrasados aparecem mesmo fora do horário de atendimento (fim de semana) @spec:AC-212', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // 2026-06-13 é sábado — sem turno vigente (AC-189), mas os atrasados
      // de quinta/sexta continuam pendentes e devem aparecer.
      vi.setSystemTime(new Date('2026-06-13T10:00:00-03:00'));

      const resposta = await routeModule.GET(getAtividades(cookieAtendente1, '?atrasados=1'));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      const itens = corpo.itens as ItemResposta[];
      // sem turno vigente (sábado), a única condição de seleção é
      // `liberada_em < corte` — por construção, tudo que volta é atrasado.
      expect(itens.every((item) => item.atrasado === true)).toBe(true);
      expect(itens.some((item) => item.oportunidade.id === cardAtrasadoMesmoTurnoId)).toBe(true);
    });

    test('sem sessão: 401 NAO_AUTENTICADO, mesmo com ?atrasados=1 @spec:AC-212', async () => {
      const resposta = await routeModule.GET(getAtividades(null, '?atrasados=1'));
      const corpo = await resposta.json();

      expect(resposta.status).toBe(401);
      expect(corpo.codigo).toBe('NAO_AUTENTICADO');
    });
  });
});
