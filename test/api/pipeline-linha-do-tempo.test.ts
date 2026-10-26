// Testes de T-157 (fase4-pipeline-telas, US-109): rota
// `GET /api/oportunidades/:id/linha-do-tempo` (AC-408), contra um Postgres
// 15 efêmero real — mesmo molde de test/api/pipeline-escrita.test.ts (login
// real via better-auth, handler chamado direto com um `NextRequest`). A
// AC-407 entra aqui só na parte de telefones do lead: o detalhe reaproveita
// `GET /api/leads/:id/telefones` (T-073), sem rota nova — o teste prova que
// essa rota já atende ao card do pipeline.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'eeeeeeee-1570-0000-0000-00000000000a';
const EMPRESA_B = 'eeeeeeee-1570-0000-0000-00000000000b';

const ETAPA_ENTRADA = 1;
const ETAPA_QUALIFICANDO = 5;

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `eeeeeeee-2277-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
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

describe('T-157: linha do tempo do card', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rotaLinhaDoTempo: typeof import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');
  let rotaTelefones: typeof import('../../src/app/api/leads/[id]/telefones/route');

  let cookieMasterA: string;
  let cookieMasterB: string;
  let masterAId: string;

  let leadA: string;
  let leadB: string;
  let cardComHistorico: string;
  let cardSemHistorico: string;
  let cardDaEmpresaB: string;

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function criarOportunidade(empresaId: string, leadId: string, etapaId: number): string {
    const id = proximoUuid();
    executar(
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${etapaId})`
    );
    return id;
  }

  function getLinhaDoTempo(id: string, cookie: string | null, query = '') {
    const request = new NextRequest(`http://localhost/api/oportunidades/${id}/linha-do-tempo${query}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rotaLinhaDoTempo.GET(request, { params: Promise.resolve({ id }) });
  }

  function getTelefones(leadId: string, cookie: string | null) {
    const request = new NextRequest(`http://localhost/api/leads/${leadId}/telefones`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rotaTelefones.GET(request, { params: Promise.resolve({ id: leadId }) });
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    executar(
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Linha do Tempo', 'empresa-a-linha-do-tempo'),
         ('${EMPRESA_B}', 'Empresa B Linha do Tempo', 'empresa-b-linha-do-tempo')`
    );

    leadA = proximoUuid();
    executar(
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "telefone_e164") VALUES ('${leadA}', '${EMPRESA_A}', 'Lead Linha do Tempo A', '+5511999990000')`
    );
    leadB = proximoUuid();
    executar(`INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${leadB}', '${EMPRESA_B}', 'Lead Linha do Tempo B')`);

    cardComHistorico = criarOportunidade(EMPRESA_A, leadA, ETAPA_QUALIFICANDO);
    cardSemHistorico = criarOportunidade(EMPRESA_A, leadA, ETAPA_ENTRADA);
    cardDaEmpresaB = criarOportunidade(EMPRESA_B, leadB, ETAPA_ENTRADA);

    executar(
      `INSERT INTO "lead_telefones" ("empresa_id", "lead_id", "numero", "rotulo")
       VALUES ('${EMPRESA_A}', '${leadA}', '+5511988880000', 'Recepção')`
    );

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-1570-0000-0000-0000000001f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'ffffffff-1570-0000-0000-0000000001f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a@linha-do-tempo.teste', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    masterAId = conviteMasterA.usuarioId;
    const conviteMasterB = await convidarUsuario(db, atorMasterB, { email: 'master.b@linha-do-tempo.teste', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterB.token, SENHA);

    // Histórico real do card: entrou na entrada, avançou para qualificando
    // (transicao_etapa), recebeu uma anotação e teve a cadência iniciada —
    // um de cada tipo gravado hoje no sistema (AC-408).
    executar(
      `INSERT INTO "oportunidade_eventos"
         ("empresa_id", "oportunidade_id", "tipo", "etapa_origem_id", "etapa_destino_id", "ator_id", "ator_tipo", "payload", "ocorrido_em")
       VALUES
         ('${EMPRESA_A}', '${cardComHistorico}', 'transicao_etapa', ${ETAPA_ENTRADA}, ${ETAPA_QUALIFICANDO}, '${masterAId}', 'usuario', NULL, now() - interval '2 hours'),
         ('${EMPRESA_A}', '${cardComHistorico}', 'anotacao', NULL, NULL, '${masterAId}', 'usuario', '{"texto": "Liguei e confirmei o interesse"}'::jsonb, now() - interval '1 hour'),
         ('${EMPRESA_A}', '${cardComHistorico}', 'cadencia_iniciada', NULL, NULL, NULL, 'sistema', NULL, now())`
    );

    process.env.DATABASE_URL = pg.appUrl;
    rotaLinhaDoTempo = await import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');
    rotaTelefones = await import('../../src/app/api/leads/[id]/telefones/route');

    cookieMasterA = await loginComoCookie(auth, 'master.a@linha-do-tempo.teste', SENHA);
    cookieMasterB = await loginComoCookie(auth, 'master.b@linha-do-tempo.teste', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('GET /api/oportunidades/:id/linha-do-tempo', () => {
    test('sem sessão: 401 NAO_AUTENTICADO, antes de tocar no banco', async () => {
      const resposta = await getLinhaDoTempo(cardComHistorico, null);
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('lista os eventos do mais novo para o mais antigo, com tipo, texto, autor e data @spec:AC-408', async () => {
      const resposta = await getLinhaDoTempo(cardComHistorico, cookieMasterA);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.itens).toHaveLength(3);

      expect(corpo.itens[0].tipo).toBe('cadencia_iniciada');
      expect(corpo.itens[0].autorNome).toBe('Sistema');
      expect(typeof corpo.itens[0].texto).toBe('string');
      expect(corpo.itens[0].texto.length).toBeGreaterThan(0);

      expect(corpo.itens[1].tipo).toBe('anotacao');
      expect(corpo.itens[1].texto).toBe('Liguei e confirmei o interesse');
      expect(corpo.itens[1].autorNome).toBe('master.a@linha-do-tempo.teste');

      expect(corpo.itens[2].tipo).toBe('transicao_etapa');
      expect(corpo.itens[2].texto).toContain('Entrada de leads');
      expect(corpo.itens[2].texto).toContain('Qualificando');

      const datas = corpo.itens.map((item: { ocorridoEm: string }) => new Date(item.ocorridoEm).getTime());
      expect(datas[0]).toBeGreaterThanOrEqual(datas[1]);
      expect(datas[1]).toBeGreaterThanOrEqual(datas[2]);
    });

    test('a contagem de interações acompanha o total do card, independente do filtro de tipo @spec:AC-408', async () => {
      const resposta = await getLinhaDoTempo(cardComHistorico, cookieMasterA, '?tipo=anotacao');
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.totalInteracoes).toBe(3);
      expect(corpo.itens).toHaveLength(1);
      expect(corpo.itens[0].tipo).toBe('anotacao');
    });

    test('sem eventos: lista vazia e contagem zero (estado vazio) @spec:AC-408', async () => {
      const resposta = await getLinhaDoTempo(cardSemHistorico, cookieMasterA);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.itens).toEqual([]);
      expect(corpo.totalInteracoes).toBe(0);
    });

    test('card de outra empresa: 404, sem vazar dado', async () => {
      const resposta = await getLinhaDoTempo(cardDaEmpresaB, cookieMasterA);
      expect(resposta.status).toBe(404);
    });

    test('card inexistente: 404', async () => {
      const resposta = await getLinhaDoTempo(proximoUuid(), cookieMasterA);
      expect(resposta.status).toBe(404);
    });
  });

  describe('GET /api/leads/:id/telefones (reaproveitado pelo detalhe do card, AC-407)', () => {
    test('o detalhe do card encontra o principal e os extras do lead pela rota já existente @spec:AC-407', async () => {
      const resposta = await getTelefones(leadA, cookieMasterA);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(200);
      expect(corpo.telefones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ numero: '5511999990000', principal: true }),
          expect.objectContaining({ numero: '+5511988880000', rotulo: 'Recepção', principal: false }),
        ])
      );
    });

    test('lead de outra empresa: 404, sem vazar dado @spec:AC-407', async () => {
      const resposta = await getTelefones(leadA, cookieMasterB);
      expect(resposta.status).toBe(404);
    });
  });
});
