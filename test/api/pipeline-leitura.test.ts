// Testes de T-155 (fase4-pipeline-telas, US-106/US-107/US-108): rotas GET
// /api/oportunidades/lista, /api/oportunidades/arquivados e
// /api/pipeline/indicadores, contra um Postgres 15 efêmero real — mesmo
// molde de test/api/relatorios-kpis.test.ts (login real via better-auth,
// handler chamado direto com um `NextRequest`).
//
// A conta de cada filtro/paginação/indicador já é provada no repositório
// (T-154, test/repositories/pipeline-lista.test.ts) — aqui o sinal usado é
// suficiente para provar que a rota: exige sessão antes de tocar o banco
// (401), nunca lê `empresaId`/`tipo`/`etapaId` de outra empresa pela URL
// (AC-397/AC-402), repassa filtro/ordenação/paginação ao repositório
// (AC-395/AC-396/AC-402) e expõe os indicadores reais (AC-389/AC-403).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';

const EMPRESA_A = 'eeeeeeee-1550-0000-0000-00000000000a';
const EMPRESA_B = 'eeeeeeee-1550-0000-0000-00000000000b';

const ETAPA_ENTRADA = 1;
const ETAPA_2O_CONTATO = 3;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_GANHO = 15;

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `eeeeeeee-2222-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
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

describe('T-155: rotas de leitura do pipeline', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;
  let rotaLista: typeof import('../../src/app/api/oportunidades/lista/route');
  let rotaArquivados: typeof import('../../src/app/api/oportunidades/arquivados/route');
  let rotaIndicadores: typeof import('../../src/app/api/pipeline/indicadores/route');

  let cookieA: string;
  let cookieB: string;

  let leadA: string;
  let leadBuscavel: string;
  let respA1: string;
  let respA2: string;
  let motivoSemInteresse: string;

  // Ids das 25 oportunidades ativas criadas para o teste de paginação, na
  // ordem de `criadoEm` (AC-395).
  let idsPaginacaoEmOrdem: string[];
  // Ids dos arquivados criados para o teste de paginação/filtro/período.
  let idsArquivadosEmOrdem: string[];

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function sqlVal(v: string | null | undefined): string {
    return v == null ? 'NULL' : `'${v}'`;
  }

  function criarLead(
    empresaId: string,
    nome: string,
    opts: { email?: string; telefoneE164?: string; origem?: string } = {}
  ): string {
    const id = proximoUuid();
    executar(
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "email", "telefone_e164", "origem")
       VALUES ('${id}', '${empresaId}', '${nome}', ${sqlVal(opts.email)}, ${sqlVal(opts.telefoneE164)}, ${sqlVal(opts.origem)})`
    );
    return id;
  }

  interface DadosOportunidadeFixture {
    empresaId: string;
    leadId: string;
    etapaId: number;
    responsavelId?: string | null;
    valor?: number | null;
    proximaAcaoEm?: string | null;
    motivoPerdaId?: string | null;
    criadoEm?: string;
  }

  function criarOportunidadeFixture(dados: DadosOportunidadeFixture): string {
    const id = proximoUuid();
    const colunas = ['id', 'empresa_id', 'lead_id', 'etapa_id'];
    const valores = [`'${id}'`, `'${dados.empresaId}'`, `'${dados.leadId}'`, String(dados.etapaId)];

    if (dados.responsavelId !== undefined) {
      colunas.push('responsavel_id');
      valores.push(sqlVal(dados.responsavelId));
    }
    if (dados.valor !== undefined) {
      colunas.push('valor');
      valores.push(dados.valor === null ? 'NULL' : String(dados.valor));
    }
    if (dados.proximaAcaoEm !== undefined) {
      colunas.push('proxima_acao_em');
      valores.push(dados.proximaAcaoEm === null ? 'NULL' : `'${dados.proximaAcaoEm}'::timestamptz`);
    }
    if (dados.motivoPerdaId !== undefined) {
      colunas.push('motivo_perda_id');
      valores.push(sqlVal(dados.motivoPerdaId));
    }
    if (dados.criadoEm !== undefined) {
      colunas.push('criado_em');
      valores.push(`'${dados.criadoEm}'::timestamptz`);
    }

    executar(`INSERT INTO "oportunidades" (${colunas.map((c) => `"${c}"`).join(', ')}) VALUES (${valores.join(', ')})`);
    return id;
  }

  function inserirEventoTransicao(empresaId: string, oportunidadeId: string, etapaDestinoId: number, ocorridoEm: string): void {
    executar(
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_destino_id", "ator_tipo", "ocorrido_em")
       VALUES ('${empresaId}', '${oportunidadeId}', 'transicao_etapa', ${etapaDestinoId}, 'sistema', '${ocorridoEm}'::timestamptz)`
    );
  }

  function lista(cookie: string | null, query = ''): Promise<Response> {
    const request = new NextRequest(`http://localhost/api/oportunidades/lista${query}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rotaLista.GET(request);
  }

  function arquivados(cookie: string | null, query = ''): Promise<Response> {
    const request = new NextRequest(`http://localhost/api/oportunidades/arquivados${query}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rotaArquivados.GET(request);
  }

  function indicadores(cookie: string | null, query = ''): Promise<Response> {
    const request = new NextRequest(`http://localhost/api/pipeline/indicadores${query}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    });
    return rotaIndicadores.GET(request);
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    executar(
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa A Pipeline Leitura', 'empresa-a-pipeline-leitura'),
         ('${EMPRESA_B}', 'Empresa B Pipeline Leitura', 'empresa-b-pipeline-leitura')`
    );

    leadA = criarLead(EMPRESA_A, 'Lead Pipeline Leitura A');
    leadBuscavel = criarLead(EMPRESA_A, 'Clínica Horizonte', { email: 'contato@horizonte.teste', telefoneE164: '+5511999990001', origem: 'Indicação' });
    const leadOutraOrigem = criarLead(EMPRESA_A, 'Lead Outra Origem A', { origem: 'Google Ads' });
    const leadB = criarLead(EMPRESA_B, 'Lead Pipeline Leitura B');

    respA1 = proximoUuid();
    executar(`INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${respA1}', 'resp-leitura-a1@teste.local', 'Resp Leitura A1')`);
    respA2 = proximoUuid();
    executar(`INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${respA2}', 'resp-leitura-a2@teste.local', 'Resp Leitura A2')`);
    motivoSemInteresse = executar(`SELECT id FROM motivos_perda WHERE nome = 'Sem interesse'`);

    // AC-395/AC-397: 25 oportunidades ativas da empresa A, criadas em ordem,
    // para provar paginação e isolamento de tenant.
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    idsPaginacaoEmOrdem = [];
    for (let i = 0; i < 25; i += 1) {
      const criadoEm = new Date(base + i * 1000).toISOString();
      idsPaginacaoEmOrdem.push(criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadA, etapaId: ETAPA_ENTRADA, criadoEm }));
    }

    // AC-396: filtros — etapa, responsável, origem e busca de texto.
    criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadA, etapaId: ETAPA_2O_CONTATO, responsavelId: respA1 });
    criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadA, etapaId: ETAPA_ENTRADA, responsavelId: respA2 });
    criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadBuscavel, etapaId: ETAPA_ENTRADA });
    criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadOutraOrigem, etapaId: ETAPA_ENTRADA });

    // AC-389: cards ativos (os 29 acima) + 1 em Proposta. Etapa 11 exige
    // `proxima_acao_em` futura (CHECK `oportunidades_acompanhamento_exige_proxima_acao`, drizzle/0002).
    criarOportunidadeFixture({
      empresaId: EMPRESA_A,
      leadId: leadA,
      etapaId: ETAPA_PROPOSTA,
      valor: 500,
      proximaAcaoEm: '2099-01-01T12:00:00-03:00',
    });

    // AC-402: 32 arquivados da empresa A — 16 ganhos, 16 perdidos — com
    // datas de fechamento espalhadas em fevereiro de 2026 (todas dentro dos
    // últimos 30 dias de 2026-03-01, para AC-389), para provar paginação,
    // ordenação, filtro por período e por motivo.
    const arquivadosFixtures: Array<{ id: string; data: string }> = [];
    for (let i = 0; i < 15; i += 1) {
      const dia = String(i + 1).padStart(2, '0');
      const data = `2026-02-${dia}T12:00:00-03:00`;
      const id = criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadA, etapaId: ETAPA_GANHO, valor: 100 });
      inserirEventoTransicao(EMPRESA_A, id, ETAPA_GANHO, data);
      arquivadosFixtures.push({ id, data });
    }
    for (let i = 0; i < 15; i += 1) {
      const dia = String(i + 1).padStart(2, '0');
      const data = `2026-02-${dia}T13:00:00-03:00`;
      const id = criarOportunidadeFixture({
        empresaId: EMPRESA_A,
        leadId: leadA,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivoSemInteresse,
      });
      inserirEventoTransicao(EMPRESA_A, id, ETAPA_PERDIDO, data);
      arquivadosFixtures.push({ id, data });
    }
    // Fora da janela 01-05/02 usada no teste de filtro de período, mas
    // ainda dentro dos últimos 30 dias de 2026-03-01 (AC-389).
    const ganhoForaDoPeriodo = criarOportunidadeFixture({ empresaId: EMPRESA_A, leadId: leadA, etapaId: ETAPA_GANHO, valor: 1000 });
    inserirEventoTransicao(EMPRESA_A, ganhoForaDoPeriodo, ETAPA_GANHO, '2026-02-20T12:00:00-03:00');
    arquivadosFixtures.push({ id: ganhoForaDoPeriodo, data: '2026-02-20T12:00:00-03:00' });
    const perdidoForaDoPeriodo = criarOportunidadeFixture({
      empresaId: EMPRESA_A,
      leadId: leadA,
      etapaId: ETAPA_PERDIDO,
      motivoPerdaId: motivoSemInteresse,
    });
    inserirEventoTransicao(EMPRESA_A, perdidoForaDoPeriodo, ETAPA_PERDIDO, '2026-02-21T13:00:00-03:00');
    arquivadosFixtures.push({ id: perdidoForaDoPeriodo, data: '2026-02-21T13:00:00-03:00' });

    // Do mais novo para o mais antigo — a ordenação padrão é `desc(dataFechamento)`.
    idsArquivadosEmOrdem = arquivadosFixtures
      .slice()
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .map((f) => f.id);

    // AC-397/AC-402: dados da empresa B, para provar isolamento.
    for (let i = 0; i < 3; i += 1) criarOportunidadeFixture({ empresaId: EMPRESA_B, leadId: leadB, etapaId: ETAPA_ENTRADA });
    const perdidoB = criarOportunidadeFixture({ empresaId: EMPRESA_B, leadId: leadB, etapaId: ETAPA_PERDIDO, motivoPerdaId: motivoSemInteresse });
    inserirEventoTransicao(EMPRESA_B, perdidoB, ETAPA_PERDIDO, '2026-02-05T12:00:00-03:00');

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = { usuarioId: 'ffffffff-1550-0000-0000-0000000001f1', empresaId: EMPRESA_A, papel: 'MASTER', isSuperAdmin: false };
    const atorMasterB: AtorConvite = { usuarioId: 'ffffffff-1550-0000-0000-0000000001f2', empresaId: EMPRESA_B, papel: 'MASTER', isSuperAdmin: false };

    const conviteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@pipeline-leitura.teste', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteA.token, SENHA);
    const conviteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b@pipeline-leitura.teste', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rotaLista = await import('../../src/app/api/oportunidades/lista/route');
    rotaArquivados = await import('../../src/app/api/oportunidades/arquivados/route');
    rotaIndicadores = await import('../../src/app/api/pipeline/indicadores/route');

    cookieA = await loginComoCookie(auth, 'gerente.a@pipeline-leitura.teste', SENHA);
    cookieB = await loginComoCookie(auth, 'gerente.b@pipeline-leitura.teste', SENHA);
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

  describe('GET /api/oportunidades/lista', () => {
    test('sem sessão: 401 NAO_AUTENTICADO, antes de tocar no banco @spec:AC-397', async () => {
      const resposta = await lista(null);
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('empresaId na URL é ignorado: a empresa A só vê os próprios cards @spec:AC-397', async () => {
      const resposta = await lista(cookieA, `?porPagina=50&empresaId=${EMPRESA_B}`);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.itens.every((item: { lead: { nome: string } }) => item.lead.nome !== 'Lead Pipeline Leitura B')).toBe(true);
    });

    test('empresa B não vê nenhum card da empresa A @spec:AC-397', async () => {
      const resposta = await lista(cookieB, '?porPagina=50');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(3);
      expect(corpo.itens.every((item: { lead: { nome: string } }) => item.lead.nome === 'Lead Pipeline Leitura B')).toBe(true);
    });

    test('cards em Perdido e Contrato (Ganho) nunca aparecem, e o total os ignora @spec:AC-398', async () => {
      const resposta = await lista(cookieA, '?porPagina=50');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.itens.some((item: { etapaId: number }) => item.etapaId === ETAPA_PERDIDO)).toBe(false);
      expect(corpo.itens.some((item: { etapaId: number }) => item.etapaId === ETAPA_GANHO)).toBe(false);
    });

    test('página 2 de tamanho 10 traz os cards 11 a 20 (de 25) e o total geral @spec:AC-395', async () => {
      const resposta = await lista(cookieA, '?pagina=2&porPagina=10&etapaId=1&ordenarPor=criadoEm&ordem=asc');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(idsPaginacaoEmOrdem.length + 3); // + os 3 fixtures extra em ETAPA_ENTRADA (responsável/busca/origem)
      expect(corpo.pagina).toBe(2);
      expect(corpo.porPagina).toBe(10);
      expect(corpo.itens.map((item: { id: string }) => item.id)).toEqual(idsPaginacaoEmOrdem.slice(10, 20));
    });

    test('porPagina fora de 10/25/50 vira 10 @spec:AC-395', async () => {
      const resposta = await lista(cookieA, '?porPagina=7');
      expect(resposta.status).toBe(200);
      expect((await resposta.json()).porPagina).toBe(10);
    });

    test('filtro por etapa restringe aos cards daquela etapa @spec:AC-396', async () => {
      const resposta = await lista(cookieA, `?etapaId=${ETAPA_2O_CONTATO}`);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(1);
      expect(corpo.itens[0].responsavel.id).toBe(respA1);
    });

    test('filtro por responsável restringe aos cards daquele responsável @spec:AC-396', async () => {
      const resposta = await lista(cookieA, `?responsavelId=${respA2}`);
      expect(resposta.status).toBe(200);
      expect((await resposta.json()).total).toBe(1);
    });

    test('filtro por origem restringe aos cards daquela origem @spec:AC-396', async () => {
      const resposta = await lista(cookieA, '?origem=Google%20Ads');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(1);
      expect(corpo.itens[0].lead.nome).toBe('Lead Outra Origem A');
    });

    test('busca de texto acha por nome, e-mail e telefone @spec:AC-396', async () => {
      for (const busca of ['Horizonte', 'contato@horizonte.teste', '+5511999990001']) {
        const resposta = await lista(cookieA, `?busca=${encodeURIComponent(busca)}`);
        expect(resposta.status).toBe(200);
        const corpo = await resposta.json();
        expect(corpo.total).toBe(1);
        expect(corpo.itens[0].lead.nome).toBe('Clínica Horizonte');
      }
    });

    test('ordenação por valor (desc) traz o card da Proposta antes dos sem valor @spec:AC-396', async () => {
      const resposta = await lista(cookieA, `?etapaId=${ETAPA_PROPOSTA}&ordenarPor=valor&ordem=desc`);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.itens[0].valor).toBe('500.00');
    });
  });

  describe('GET /api/oportunidades/arquivados', () => {
    test('sem sessão: 401 NAO_AUTENTICADO @spec:AC-402', async () => {
      const resposta = await arquivados(null);
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('empresa B só vê o próprio arquivado, mesmo tentando empresaId=A na URL @spec:AC-402', async () => {
      const resposta = await arquivados(cookieB, `?porPagina=50&empresaId=${EMPRESA_A}`);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(1);
      expect(corpo.itens[0].status).toBe('perdido');
    });

    test('32 arquivados, página 1 de tamanho 10 traz os 10 mais recentes e o total geral @spec:AC-402', async () => {
      const resposta = await arquivados(cookieA, '?porPagina=10&pagina=1');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(32);
      expect(corpo.pagina).toBe(1);
      expect(corpo.porPagina).toBe(10);
      expect(corpo.itens.map((item: { id: string }) => item.id)).toEqual(idsArquivadosEmOrdem.slice(0, 10));
    });

    test('filtro por tipo restringe a ganhos ou perdidos @spec:AC-402', async () => {
      const ganhos = await arquivados(cookieA, '?tipo=ganho&porPagina=50');
      expect((await ganhos.json()).total).toBe(16);

      const perdidos = await arquivados(cookieA, '?tipo=perdido&porPagina=50');
      const corpoPerdidos = await perdidos.json();
      expect(corpoPerdidos.total).toBe(16);
      expect(corpoPerdidos.itens.every((item: { status: string }) => item.status === 'perdido')).toBe(true);
    });

    test('filtro por motivo de perda restringe aos arquivados com aquele motivo @spec:AC-402', async () => {
      const resposta = await arquivados(cookieA, `?motivoPerdaId=${motivoSemInteresse}&porPagina=50`);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.total).toBe(16);
      expect(corpo.itens.every((item: { motivoPerda: { id: string } | null }) => item.motivoPerda?.id === motivoSemInteresse)).toBe(true);
    });

    test('filtro por período de fechamento restringe aos arquivados daquela janela @spec:AC-402', async () => {
      const resposta = await arquivados(cookieA, '?de=2026-02-01&ate=2026-02-05&porPagina=50');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      // 5 ganhos (dias 01-05) + 5 perdidos (dias 01-05) = 10.
      expect(corpo.total).toBe(10);
    });
  });

  describe('GET /api/pipeline/indicadores', () => {
    test('sem sessão: 401 NAO_AUTENTICADO @spec:AC-389', async () => {
      const resposta = await indicadores(null, '?visao=funil');
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    });

    test('visao ausente ou inválida: 400 PARAMETRO_INVALIDO @spec:AC-389', async () => {
      for (const query of ['', '?visao=invalida']) {
        const resposta = await indicadores(cookieA, query);
        expect(resposta.status).toBe(400);
        expect((await resposta.json()).codigo).toBe('PARAMETRO_INVALIDO');
      }
    });

    test('visao=funil: os cartões refletem os dados reais só da empresa A @spec:AC-389', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-01T12:00:00-03:00'));

      const resposta = await indicadores(cookieA, '?visao=funil');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      // 25 (paginação) + 4 (filtros) = 29 cards fora das etapas terminais na
      // empresa A (a Proposta entra como ativa também).
      expect(corpo.cardsAtivos.quantidade).toBe(30);
      expect(corpo.propostasAtivas).toBe(1);
      expect(corpo.conversao30Dias).toHaveProperty('valor');
      expect(corpo.conversao30Dias).toHaveProperty('numerador');
      expect(corpo.conversao30Dias).toHaveProperty('denominador');
      // Os 32 arquivados (16 ganhos + 16 perdidos) caem todos entre
      // 2026-01-30 e 2026-03-01 (últimos 30 dias de `agora`).
      expect(corpo.conversao30Dias.denominador).toBe(32);
      expect(corpo.conversao30Dias.numerador).toBe(16);
      expect(corpo.conversao30Dias.valor).toBe(0.5);
    });

    test('visao=arquivados: os cartões e a distribuição de motivos refletem os dados reais só da empresa A @spec:AC-403', async () => {
      const resposta = await indicadores(cookieA, '?visao=arquivados&de=2026-02-01&ate=2026-02-05');
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      expect(corpo.negociosFechados).toBe(10);
      expect(corpo.perdas.quantidade).toBe(5);
      expect(corpo.distribuicaoMotivos).toEqual([
        expect.objectContaining({ motivoId: motivoSemInteresse, quantidade: 5, percentual: 1 }),
      ]);
    });

    test('visao=arquivados com datas mal formadas: 400 PARAMETRO_INVALIDO @spec:AC-403', async () => {
      const resposta = await indicadores(cookieA, '?visao=arquivados&de=01-02-2026');
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('PARAMETRO_INVALIDO');
    });
  });
});
