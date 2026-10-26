// Testes de T-165 (fase4-pipeline-telas, US-106): `POST /api/oportunidades`
// estendido para criar um lead novo e o card dele em "Entrada de leads" num
// só passo (AC-391), e para a cadência de 18 toques poder ser iniciada em
// seguida na mesma chamada do fluxo "Salvar e Iniciar Cadência" (AC-392,
// encadeando a rota já existente de `cadencia/iniciar`). Mesmos moldes de
// test/api/oportunidades.test.ts: Postgres 15 efêmero real, dois tenants
// seedados (test/support/seed-tenants.ts).
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

const RESPONSAVEL_VALIDO_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESPONSAVEL_INATIVO_A = 'aaaaaaaa-0000-0000-0000-000000000002';
const RESPONSAVEL_OUTRA_EMPRESA_B = 'aaaaaaaa-0000-0000-0000-000000000003';

async function loginComoCookie(auth: Auth, email: string, senha: string): Promise<string> {
  const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!sessionCookie) {
    throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
  }
  return sessionCookie.split(';')[0];
}

function postNovoLead(cookie: string, corpo: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/oportunidades', {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

describe('T-165: POST /api/oportunidades cria lead e card em um passo', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let tenants: TenantsSeedados;
  let routeModule: typeof import('../../src/app/api/oportunidades/route');
  let cadenciaRouteModule: typeof import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');
  let cookieA: string;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    tenants = seedarDoisTenants(pg);

    const extras = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "usuarios" ("id", "email", "nome", "ativo") VALUES
         ('${RESPONSAVEL_VALIDO_A}', 'responsavel.valido.a@teste.com', 'Responsável Válido A', true),
         ('${RESPONSAVEL_INATIVO_A}', 'responsavel.inativo.a@teste.com', 'Responsável Inativo A', false),
         ('${RESPONSAVEL_OUTRA_EMPRESA_B}', 'responsavel.b@teste.com', 'Responsável Empresa B', true);
       INSERT INTO "empresas_usuarios" ("empresa_id", "usuario_id", "papel", "ativo") VALUES
         ('${tenants.empresaA}', '${RESPONSAVEL_VALIDO_A}', 'ATENDENTE', true),
         ('${tenants.empresaA}', '${RESPONSAVEL_INATIVO_A}', 'ATENDENTE', true),
         ('${tenants.empresaB}', '${RESPONSAVEL_OUTRA_EMPRESA_B}', 'ATENDENTE', true);`
    );
    if (extras.status !== 0) {
      throw new Error(`Falha ao preparar fixtures extras: ${extras.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'ffffffff-2222-0000-0000-0000000000f1',
      empresaId: tenants.empresaA,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteA = await convidarUsuario(db, atorMasterA, {
      email: 'gerente.novolead.a@teste.com',
      papel: 'GERENTE',
    });
    await definirSenhaComToken(db, conviteA.token, SENHA);

    // A rota lê `getDb()` (singleton) — precisa apontar pro Postgres efêmero
    // ANTES do módulo da rota ser importado pela primeira vez.
    process.env.DATABASE_URL = pg.appUrl;
    routeModule = await import('../../src/app/api/oportunidades/route');
    cadenciaRouteModule = await import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');

    cookieA = await loginComoCookie(auth, 'gerente.novolead.a@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  // `db` (role `crm_app`) exige `app.empresa_id` setado (RLS) para
  // qualquer SELECT — fora de uma transação de `comTenant`, só
  // `crm_migrator` (sem RLS) consegue contar linhas livremente.
  async function contarLeadsComEmail(email: string): Promise<number> {
    const resultado = pg.psqlComo('crm_migrator', `SELECT count(*) FROM "leads" WHERE "email" = '${email}'`);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao contar leads por e-mail: ${resultado.stderr}`);
    }
    return Number(resultado.stdout.trim());
  }

  describe('AC-391: o modal "Novo Lead" cria o card na entrada', () => {
    test('nome, telefone e origem preenchidos: cria lead e card na "Entrada de leads" @spec:AC-391', async () => {
      const request = postNovoLead(cookieA, {
        novoLead: {
          nome: 'Lead Novo Um Passo',
          telefone: '(11) 98888-7777',
          email: 'lead.umpasso.1@teste.com',
          origem: 'Google Ads',
        },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.etapaId).toBe(1);
      expect(corpo.version).toBe(1);
      expect(corpo.empresaId).toBe(tenants.empresaA);
      expect(corpo.responsavelId).toBeNull();
      expect(typeof corpo.leadId).toBe('string');

      const linha = pg.psqlComo(
        'crm_migrator',
        `SELECT nome, telefone_e164, origem, empresa_id FROM "leads" WHERE "id" = '${corpo.leadId}'`
      );
      if (linha.status !== 0) throw new Error(`Falha ao buscar o lead criado: ${linha.stderr}`);
      const [nome, telefoneE164, origem, empresaId] = linha.stdout.trim().split('|');
      expect(nome).toBe('Lead Novo Um Passo');
      expect(telefoneE164).toBe('5511988887777');
      expect(origem).toBe('Google Ads');
      expect(empresaId).toBe(tenants.empresaA);
    });

    test('valor e responsavelId informados: o card nasce com os dois @spec:AC-391', async () => {
      const request = postNovoLead(cookieA, {
        novoLead: {
          nome: 'Lead Com Responsável',
          telefone: '11977776666',
          origem: 'Indicação',
        },
        valor: '4200.00',
        responsavelId: RESPONSAVEL_VALIDO_A,
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.etapaId).toBe(1);
      expect(corpo.valor).toBe('4200.00');
      expect(corpo.responsavelId).toBe(RESPONSAVEL_VALIDO_A);
    });

    test('sem responsável: o card nasce sem responsável @spec:AC-391', async () => {
      const request = postNovoLead(cookieA, {
        novoLead: {
          nome: 'Lead Sem Responsável',
          telefone: '11966665555',
          origem: 'Outro',
        },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.responsavelId).toBeNull();
    });

    test('campo obrigatório vazio (nome) impede o envio e devolve o erro no campo @spec:AC-391', async () => {
      const email = 'lead.semnome@teste.com';
      const request = postNovoLead(cookieA, {
        novoLead: { nome: '  ', telefone: '11955554444', email, origem: 'Google Ads' },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('CAMPO_OBRIGATORIO');
      expect(corpo.campo).toBe('nome');
      expect(await contarLeadsComEmail(email)).toBe(0);
    });

    test('campo obrigatório vazio (telefone) impede o envio e devolve o erro no campo @spec:AC-391', async () => {
      const email = 'lead.semtelefone@teste.com';
      const request = postNovoLead(cookieA, {
        novoLead: { nome: 'Lead Sem Telefone', telefone: '', email, origem: 'Google Ads' },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('CAMPO_OBRIGATORIO');
      expect(corpo.campo).toBe('telefone');
      expect(await contarLeadsComEmail(email)).toBe(0);
    });

    test('campo obrigatório vazio (origem) impede o envio e devolve o erro no campo @spec:AC-391', async () => {
      const email = 'lead.semorigem@teste.com';
      const request = postNovoLead(cookieA, {
        novoLead: { nome: 'Lead Sem Origem', telefone: '11944443333', email, origem: '' },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('CAMPO_OBRIGATORIO');
      expect(corpo.campo).toBe('origem');
      expect(await contarLeadsComEmail(email)).toBe(0);
    });

    test('responsavelId de usuário inativo é recusado e nada é gravado @spec:AC-391', async () => {
      const email = 'lead.responsavelinativo@teste.com';
      const request = postNovoLead(cookieA, {
        novoLead: { nome: 'Lead Resp Inativo', telefone: '11933332222', email, origem: 'Google Ads' },
        responsavelId: RESPONSAVEL_INATIVO_A,
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('RESPONSAVEL_INVALIDO');
      expect(await contarLeadsComEmail(email)).toBe(0);
    });

    test('responsavelId de usuário de outra empresa é recusado e nada é gravado @spec:AC-391', async () => {
      const email = 'lead.responsaveloutraempresa@teste.com';
      const request = postNovoLead(cookieA, {
        novoLead: { nome: 'Lead Resp Outra Empresa', telefone: '11922221111', email, origem: 'Google Ads' },
        responsavelId: RESPONSAVEL_OUTRA_EMPRESA_B,
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(400);
      expect(corpo.codigo).toBe('RESPONSAVEL_INVALIDO');
      expect(await contarLeadsComEmail(email)).toBe(0);
    });

    test('"Criar Card na Entrada" cria só o card: sem cadência iniciada @spec:AC-392', async () => {
      const request = postNovoLead(cookieA, {
        novoLead: { nome: 'Lead Só Card', telefone: '11911110000', origem: 'Google Ads' },
      });
      const resposta = await routeModule.POST(request);
      const corpo = await resposta.json();

      expect(resposta.status).toBe(201);
      expect(corpo.etapaId).toBe(1);
      expect(corpo.cadenciaDia).toBeNull();
    });
  });

  describe('AC-392: "Salvar e iniciar cadência" cria o card e já inicia a cadência', () => {
    test('card criado em um passo pode ter a cadência iniciada pela API já existente @spec:AC-392', async () => {
      const criacao = await routeModule.POST(
        postNovoLead(cookieA, {
          novoLead: { nome: 'Lead Com Cadência', telefone: '11900009999', origem: 'Google Ads' },
        })
      );
      const cardCriado = await criacao.json();
      expect(criacao.status).toBe(201);
      expect(cardCriado.cadenciaDia).toBeNull();

      const iniciarRequest = new NextRequest(
        `http://localhost/api/oportunidades/${cardCriado.id}/cadencia/iniciar`,
        {
          method: 'POST',
          headers: { Cookie: cookieA, 'content-type': 'application/json' },
          body: JSON.stringify({ version: cardCriado.version }),
        }
      );
      const respostaCadencia = await cadenciaRouteModule.POST(iniciarRequest, {
        params: Promise.resolve({ id: cardCriado.id as string }),
      });
      const corpoCadencia = await respostaCadencia.json();

      expect(respostaCadencia.status).toBe(200);
      expect(corpoCadencia.oportunidade.cadenciaDia).toBe(1);
      expect(corpoCadencia.toques).toHaveLength(3);
    });
  });
});
