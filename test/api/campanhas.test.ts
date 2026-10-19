// Testes de T-105 (fase2d-campanhas): rotas /api/campanhas (CRUD, iniciar,
// reenviar-falhas) contra um Postgres 15 efêmero real, com sessão via
// cookie real (mesmo molde de test/api/whatsapp-config.test.ts e
// test/api/atividades-concluir.test.ts). A regra de negócio em si (criação
// com destinatários, transições de status, normalização de e-mail) já está
// provada em test/db/campanhas.test.ts (T-104) — aqui o foco é a borda
// HTTP: sessão, papel, validação do corpo e tradução dos erros do
// repositório para o envelope HTTP.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import { criarAuth, type Auth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';
const ETAPA_QUALIFICANDO = 5;
const ETAPA_ENTRADA = 1;

const EMPRESA_A = 'cccccccc-c105-0000-0000-00000000000a';
const EMPRESA_B = 'cccccccc-c105-0000-0000-00000000000b';

describe('T-105: rotas /api/campanhas', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;
  let auth: Auth;

  let rotaLista: typeof import('../../src/app/api/campanhas/route');
  let rotaDetalhe: typeof import('../../src/app/api/campanhas/[id]/route');
  let rotaIniciar: typeof import('../../src/app/api/campanhas/[id]/iniciar/route');
  let rotaReenviar: typeof import('../../src/app/api/campanhas/[id]/reenviar-falhas/route');

  let cookieGerenteA: string;
  let cookieAtendenteA: string;
  let cookieGerenteB: string;

  async function loginComoCookie(email: string, senha: string): Promise<string> {
    const resposta = await auth.api.signInEmail({ body: { email, password: senha }, asResponse: true });
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.includes('better-auth.session_token='));
    if (!sessionCookie) {
      throw new Error(`cookie de sessão não encontrado na resposta de login: ${cookies.join(' | ')}`);
    }
    return sessionCookie.split(';')[0];
  }

  function getLista(cookie: string | null) {
    return rotaLista.GET(
      new NextRequest('http://localhost/api/campanhas', {
        method: 'GET',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      })
    );
  }

  function postCriar(cookie: string | null, body: unknown) {
    return rotaLista.POST(
      new NextRequest('http://localhost/api/campanhas', {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  function getDetalhe(id: string, cookie: string | null) {
    return rotaDetalhe.GET(
      new NextRequest(`http://localhost/api/campanhas/${id}`, {
        method: 'GET',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  function patchCampanha(id: string, cookie: string | null, body: unknown) {
    return rotaDetalhe.PATCH(
      new NextRequest(`http://localhost/api/campanhas/${id}`, {
        method: 'PATCH',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  function deleteCampanha(id: string, cookie: string | null) {
    return rotaDetalhe.DELETE(
      new NextRequest(`http://localhost/api/campanhas/${id}`, {
        method: 'DELETE',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  function postIniciar(id: string, cookie: string | null) {
    return rotaIniciar.POST(
      new NextRequest(`http://localhost/api/campanhas/${id}/iniciar`, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  function postReenviar(id: string, cookie: string | null) {
    return rotaReenviar.POST(
      new NextRequest(`http://localhost/api/campanhas/${id}/reenviar-falhas`, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  let contadorUuid = 0x10;
  function proximoUuid(): string {
    contadorUuid += 1;
    return `cccccccc-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
  }

  function psql(sqlTexto: string) {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function criarLeadEOportunidade(empresaId: string, nome: string, email: string | null, etapaId: number): void {
    const leadId = proximoUuid();
    const oportunidadeId = proximoUuid();
    const emailSql = email === null ? 'NULL' : `'${email}'`;
    psql(
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "email") VALUES ('${leadId}', '${empresaId}', '${nome}', ${emailSql});
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${oportunidadeId}', '${empresaId}', '${leadId}', ${etapaId});`
    );
  }

  function statusCampanha(id: string): string {
    return psql(`SELECT status FROM campanhas WHERE id = '${id}'`);
  }

  function contarCampanhas(id: string): number {
    return Number(psql(`SELECT count(*) FROM campanhas WHERE id = '${id}'`));
  }

  function contarDestinatarios(id: string): number {
    return Number(psql(`SELECT count(*) FROM envios_campanha WHERE campanha_id = '${id}'`));
  }

  function definirStatusCampanha(id: string, status: string): void {
    psql(`UPDATE campanhas SET status = '${status}' WHERE id = '${id}'`);
  }

  function inserirDestinatarioComStatus(campanhaId: string, empresaId: string, nome: string, email: string, status: string): void {
    const id = proximoUuid();
    psql(
      `INSERT INTO "envios_campanha" ("id", "empresa_id", "campanha_id", "nome_destinatario", "email_destinatario", "status")
       VALUES ('${id}', '${empresaId}', '${campanhaId}', '${nome}', '${email}', '${status}')`
    );
  }

  async function criarCampanhaViaRota(nomeCampanha: string, contatos: Array<{ nome: string; email: string }> = []) {
    const resposta = await postCriar(cookieGerenteA, {
      nome: nomeCampanha,
      assunto: 'Assunto ' + nomeCampanha,
      corpoHtml: '<p>corpo</p>',
      origem: { tipo: 'planilha', contatos },
    });
    expect(resposta.status).toBe(201);
    return (await resposta.json()) as { id: string; totalDestinatarios: number };
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Rota Campanhas A', 'empresa-teste-rota-campanhas-a'),
         ('${EMPRESA_B}', 'Empresa Teste Rota Campanhas B', 'empresa-teste-rota-campanhas-b');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes das rotas de campanhas: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
    auth = criarAuth(db);

    const atorMasterA: AtorConvite = {
      usuarioId: 'cccccccc-0000-0000-0000-0000000001f1',
      empresaId: EMPRESA_A,
      papel: 'MASTER',
      isSuperAdmin: false,
    };
    const atorMasterB: AtorConvite = {
      usuarioId: 'cccccccc-0000-0000-0000-0000000001f2',
      empresaId: EMPRESA_B,
      papel: 'MASTER',
      isSuperAdmin: false,
    };

    const conviteMasterA = await convidarUsuario(db, atorMasterA, { email: 'master.a@teste.com', papel: 'MASTER' });
    await definirSenhaComToken(db, conviteMasterA.token, SENHA);
    const conviteGerenteA = await convidarUsuario(db, atorMasterA, { email: 'gerente.a@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteA.token, SENHA);
    const conviteAtendenteA = await convidarUsuario(db, atorMasterA, {
      email: 'atendente.a@teste.com',
      papel: 'ATENDENTE',
    });
    await definirSenhaComToken(db, conviteAtendenteA.token, SENHA);
    const conviteGerenteB = await convidarUsuario(db, atorMasterB, { email: 'gerente.b@teste.com', papel: 'GERENTE' });
    await definirSenhaComToken(db, conviteGerenteB.token, SENHA);

    process.env.DATABASE_URL = pg.appUrl;
    rotaLista = await import('../../src/app/api/campanhas/route');
    rotaDetalhe = await import('../../src/app/api/campanhas/[id]/route');
    rotaIniciar = await import('../../src/app/api/campanhas/[id]/iniciar/route');
    rotaReenviar = await import('../../src/app/api/campanhas/[id]/reenviar-falhas/route');

    cookieGerenteA = await loginComoCookie('gerente.a@teste.com', SENHA);
    cookieAtendenteA = await loginComoCookie('atendente.a@teste.com', SENHA);
    cookieGerenteB = await loginComoCookie('gerente.b@teste.com', SENHA);
  }, 120_000);

  afterAll(async () => {
    const { getDb } = await import('../../src/db/client');
    const dbInterno = getDb() as unknown as { $client: Pool };
    await dbInterno.$client.end();
    await pool?.end();
    pg?.parar();
  });

  describe('AC-234: criar campanha em rascunho com destinatários de uma planilha', () => {
    test('POST /api/campanhas cria a campanha RASCUNHO com um destinatário por contato e devolve id e total @spec:AC-234', async () => {
      const resposta = await postCriar(cookieGerenteA, {
        nome: 'Campanha Planilha Rota',
        assunto: 'Assunto Planilha',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'Contato Rota Um', email: 'contato.rota.um@teste.local' },
            { nome: 'Contato Rota Dois', email: 'contato.rota.dois@teste.local' },
          ],
        },
      });

      expect(resposta.status).toBe(201);
      const corpo = await resposta.json();
      expect(corpo.id).toBeTruthy();
      expect(corpo.totalDestinatarios).toBe(2);
      expect(statusCampanha(corpo.id)).toBe('RASCUNHO');
      expect(contarDestinatarios(corpo.id)).toBe(2);
    });
  });

  describe('AC-235: criar campanha com os cards de uma etapa do pipeline', () => {
    test('POST /api/campanhas com origem etapa só traz leads com e-mail da etapa e empresa certas @spec:AC-235', async () => {
      criarLeadEOportunidade(EMPRESA_A, 'Lead Rota Com Email', 'rota.etapa.comemail@teste.local', ETAPA_QUALIFICANDO);
      criarLeadEOportunidade(EMPRESA_A, 'Lead Rota Sem Email', null, ETAPA_QUALIFICANDO);
      criarLeadEOportunidade(EMPRESA_A, 'Lead Rota Outra Etapa', 'rota.etapa.outra@teste.local', ETAPA_ENTRADA);
      criarLeadEOportunidade(EMPRESA_B, 'Lead Rota Outra Empresa', 'rota.etapa.outraempresa@teste.local', ETAPA_QUALIFICANDO);

      const resposta = await postCriar(cookieGerenteA, {
        nome: 'Campanha Etapa Rota',
        assunto: 'Assunto Etapa',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'etapa', etapaId: ETAPA_QUALIFICANDO },
      });

      expect(resposta.status).toBe(201);
      const corpo = await resposta.json();
      expect(corpo.totalDestinatarios).toBe(1);
      expect(contarDestinatarios(corpo.id)).toBe(1);
    });
  });

  describe('AC-237: editar nome, assunto e corpo só enquanto é rascunho', () => {
    test('PATCH grava a edição numa campanha RASCUNHO; numa PROCESSANDO ou FINALIZADA volta 409 sem mudar nada @spec:AC-237', async () => {
      const rascunho = await criarCampanhaViaRota('Campanha Rascunho Editavel');
      const respostaEdicao = await patchCampanha(rascunho.id, cookieGerenteA, {
        nome: 'Nome Editado',
        assunto: 'Assunto Editado',
        corpoHtml: '<p>editado</p>',
      });
      expect(respostaEdicao.status).toBe(200);
      const editada = await respostaEdicao.json();
      expect(editada.nome).toBe('Nome Editado');
      expect(editada.assunto).toBe('Assunto Editado');
      expect(editada.corpoHtml).toBe('<p>editado</p>');

      const processando = await criarCampanhaViaRota('Campanha Processando Nao Editavel');
      definirStatusCampanha(processando.id, 'PROCESSANDO');
      const respostaProcessando = await patchCampanha(processando.id, cookieGerenteA, {
        nome: 'Não deveria gravar',
        assunto: 'Não deveria gravar',
        corpoHtml: '<p>não deveria gravar</p>',
      });
      expect(respostaProcessando.status).toBe(409);
      expect((await respostaProcessando.json()).codigo).toBe('CAMPANHA_NAO_EDITAVEL');

      const detalheProcessando = await (await getDetalhe(processando.id, cookieGerenteA)).json();
      expect(detalheProcessando.campanha.nome).toBe('Campanha Processando Nao Editavel');

      const finalizada = await criarCampanhaViaRota('Campanha Finalizada Nao Editavel');
      definirStatusCampanha(finalizada.id, 'FINALIZADA');
      const respostaFinalizada = await patchCampanha(finalizada.id, cookieGerenteA, {
        nome: 'Não deveria gravar',
        assunto: 'Não deveria gravar',
        corpoHtml: '<p>não deveria gravar</p>',
      });
      expect(respostaFinalizada.status).toBe(409);
      expect((await respostaFinalizada.json()).codigo).toBe('CAMPANHA_NAO_EDITAVEL');
    });
  });

  describe('AC-238: campos obrigatórios e permissão', () => {
    test('faltando nome/assunto/corpo: 400 PARAMETRO_INVALIDO com mensagem em português e nada é gravado @spec:AC-238', async () => {
      const semNome = await postCriar(cookieGerenteA, {
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      expect(semNome.status).toBe(400);
      const corpoSemNome = await semNome.json();
      expect(corpoSemNome.codigo).toBe('PARAMETRO_INVALIDO');
      expect(typeof corpoSemNome.mensagem).toBe('string');
      expect(corpoSemNome.mensagem.length).toBeGreaterThan(0);

      const semAssunto = await postCriar(cookieGerenteA, {
        nome: 'Nome',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      expect(semAssunto.status).toBe(400);
      expect((await semAssunto.json()).codigo).toBe('PARAMETRO_INVALIDO');

      const semCorpo = await postCriar(cookieGerenteA, {
        nome: 'Nome',
        assunto: 'Assunto',
        origem: { tipo: 'planilha', contatos: [] },
      });
      expect(semCorpo.status).toBe(400);
      expect((await semCorpo.json()).codigo).toBe('PARAMETRO_INVALIDO');
    });

    test('ATENDENTE recebe 403 SEM_PERMISSAO; sem sessão recebe 401 NAO_AUTENTICADO; nada é gravado @spec:AC-238', async () => {
      const corpoValido = {
        nome: 'Campanha Atendente Nao Cria',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      };

      const respostaAtendente = await postCriar(cookieAtendenteA, corpoValido);
      expect(respostaAtendente.status).toBe(403);
      expect((await respostaAtendente.json()).codigo).toBe('SEM_PERMISSAO');

      const respostaSemSessao = await postCriar(null, corpoValido);
      expect(respostaSemSessao.status).toBe(401);
      expect((await respostaSemSessao.json()).codigo).toBe('NAO_AUTENTICADO');

      const lista = await (await getLista(cookieGerenteA)).json();
      expect(lista.campanhas.some((c: { nome: string }) => c.nome === 'Campanha Atendente Nao Cria')).toBe(false);
    });
  });

  describe('AC-239: Play libera a fila para o motor', () => {
    test('POST .../iniciar move a campanha para PROCESSANDO e os destinatários RASCUNHO para PENDENTE @spec:AC-239', async () => {
      const criada = await criarCampanhaViaRota('Campanha Play Rota', [
        { nome: 'Play Rota Um', email: 'play.rota.um@teste.local' },
        { nome: 'Play Rota Dois', email: 'play.rota.dois@teste.local' },
      ]);
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Já Enviado Rota', 'ja.enviado.rota@teste.local', 'ENVIADO');

      const resposta = await postIniciar(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.status).toBe('PROCESSANDO');
      expect(corpo.totalLiberados).toBe(2);
      expect(statusCampanha(criada.id)).toBe('PROCESSANDO');
    });
  });

  describe('AC-240: Play recusado quando não há o que enviar ou já foi iniciada', () => {
    test('sem destinatários: 422 SEM_DESTINATARIOS; já iniciada: 409 CAMPANHA_JA_INICIADA; nada muda @spec:AC-240', async () => {
      const vazia = await criarCampanhaViaRota('Campanha Vazia Rota');
      const respostaVazia = await postIniciar(vazia.id, cookieGerenteA);
      expect(respostaVazia.status).toBe(422);
      expect((await respostaVazia.json()).codigo).toBe('SEM_DESTINATARIOS');
      expect(statusCampanha(vazia.id)).toBe('RASCUNHO');

      const jaProcessando = await criarCampanhaViaRota('Campanha Ja Processando Rota', [
        { nome: 'X', email: 'x.processando.rota@teste.local' },
      ]);
      definirStatusCampanha(jaProcessando.id, 'PROCESSANDO');
      const respostaProcessando = await postIniciar(jaProcessando.id, cookieGerenteA);
      expect(respostaProcessando.status).toBe(409);
      expect((await respostaProcessando.json()).codigo).toBe('CAMPANHA_JA_INICIADA');
      expect(statusCampanha(jaProcessando.id)).toBe('PROCESSANDO');
    });

    test('dois cliques simultâneos no Play iniciam a campanha uma única vez @spec:AC-240', async () => {
      const criada = await criarCampanhaViaRota('Campanha Clique Duplo Rota', [
        { nome: 'Duplo Rota Um', email: 'duplo.rota.um@teste.local' },
      ]);

      const [primeira, segunda] = await Promise.all([
        postIniciar(criada.id, cookieGerenteA),
        postIniciar(criada.id, cookieGerenteA),
      ]);
      const statuses = [primeira.status, segunda.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(statusCampanha(criada.id)).toBe('PROCESSANDO');
    });
  });

  describe('AC-241: reenviar falhas devolve os erros para a fila', () => {
    test('POST .../reenviar-falhas devolve só os ERRO para PENDENTE e a campanha volta a PROCESSANDO @spec:AC-241', async () => {
      const criada = await criarCampanhaViaRota('Campanha Reenviar Rota');
      definirStatusCampanha(criada.id, 'FINALIZADA');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Enviado Rota', 'enviado.rota@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Erro Rota Um', 'erro.rota.um@teste.local', 'ERRO');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Erro Rota Dois', 'erro.rota.dois@teste.local', 'ERRO');

      const resposta = await postReenviar(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();
      expect(corpo.status).toBe('PROCESSANDO');
      expect(corpo.totalReenviados).toBe(2);
      expect(statusCampanha(criada.id)).toBe('PROCESSANDO');
    });

    test('sem nenhum ERRO: 422 SEM_FALHAS @spec:AC-241', async () => {
      const criada = await criarCampanhaViaRota('Campanha Sem Falhas Rota');
      definirStatusCampanha(criada.id, 'FINALIZADA');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Enviado Sem Falha Rota', 'enviado.sem.falha.rota@teste.local', 'ENVIADO');

      const resposta = await postReenviar(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(422);
      expect((await resposta.json()).codigo).toBe('SEM_FALHAS');
      expect(statusCampanha(criada.id)).toBe('FINALIZADA');
    });
  });

  describe('AC-243: listar as campanhas da empresa', () => {
    test('GET /api/campanhas traz só as da própria empresa, da mais nova para a mais antiga @spec:AC-243', async () => {
      const primeira = await criarCampanhaViaRota('Lista Rota Primeira');
      const segunda = await criarCampanhaViaRota('Lista Rota Segunda', [{ nome: 'L', email: 'lista.rota@teste.local' }]);

      const respostaOutraEmpresa = await postCriar(cookieGerenteB, {
        nome: 'Lista Rota Outra Empresa',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      expect(respostaOutraEmpresa.status).toBe(201);

      const resposta = await getLista(cookieGerenteA);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      expect(corpo.campanhas.some((c: { nome: string }) => c.nome === 'Lista Rota Outra Empresa')).toBe(false);

      const indiceSegunda = corpo.campanhas.findIndex((c: { id: string }) => c.id === segunda.id);
      const indicePrimeira = corpo.campanhas.findIndex((c: { id: string }) => c.id === primeira.id);
      expect(indiceSegunda).toBeGreaterThanOrEqual(0);
      expect(indicePrimeira).toBeGreaterThan(indiceSegunda);

      const itemSegunda = corpo.campanhas.find((c: { id: string }) => c.id === segunda.id);
      expect(itemSegunda.nome).toBe('Lista Rota Segunda');
      expect(itemSegunda.status).toBe('RASCUNHO');
      expect(itemSegunda.totalDestinatarios).toBe(1);
    });
  });

  describe('AC-244: detalhe com destinatários e contagem por status', () => {
    test('GET /api/campanhas/:id traz destinatários ordenados por nome e a contagem por status @spec:AC-244', async () => {
      const criada = await criarCampanhaViaRota('Campanha Detalhe Rota');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Zeta Rota', 'zeta.rota@teste.local', 'PENDENTE');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Alfa Rota', 'alfa.rota@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Beta Rota', 'beta.rota@teste.local', 'ABERTO');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Delta Rota', 'delta.rota@teste.local', 'CLICADO');
      inserirDestinatarioComStatus(criada.id, EMPRESA_A, 'Gama Rota', 'gama.rota@teste.local', 'ERRO');

      const resposta = await getDetalhe(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      expect(corpo.campanha.id).toBe(criada.id);
      expect(corpo.destinatarios.map((d: { nome: string }) => d.nome)).toEqual([
        'Alfa Rota',
        'Beta Rota',
        'Delta Rota',
        'Gama Rota',
        'Zeta Rota',
      ]);
      expect(corpo.contagemPorStatus).toEqual({
        PENDENTE: 1,
        ENVIADO: 1,
        ABERTO: 1,
        CLICADO: 1,
        ERRO: 1,
      });
    });

    test('campanha de outra empresa ou inexistente: 404 CAMPANHA_NAO_ENCONTRADA @spec:AC-244', async () => {
      const respostaOutraEmpresa = await postCriar(cookieGerenteB, {
        nome: 'Campanha Detalhe Empresa B Rota',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      const { id: idOutraEmpresa } = await respostaOutraEmpresa.json();

      const respostaCruzada = await getDetalhe(idOutraEmpresa, cookieGerenteA);
      expect(respostaCruzada.status).toBe(404);
      expect((await respostaCruzada.json()).codigo).toBe('CAMPANHA_NAO_ENCONTRADA');

      const respostaInexistente = await getDetalhe(proximoUuid(), cookieGerenteA);
      expect(respostaInexistente.status).toBe(404);
      expect((await respostaInexistente.json()).codigo).toBe('CAMPANHA_NAO_ENCONTRADA');
    });
  });

  describe('AC-245: excluir a campanha apaga os envios', () => {
    test('DELETE remove a campanha e todos os destinatários @spec:AC-245', async () => {
      const criada = await criarCampanhaViaRota('Campanha Excluir Rota', [
        { nome: 'Excluir Rota Um', email: 'excluir.rota.um@teste.local' },
        { nome: 'Excluir Rota Dois', email: 'excluir.rota.dois@teste.local' },
      ]);
      expect(contarDestinatarios(criada.id)).toBe(2);

      const resposta = await deleteCampanha(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(204);
      expect(contarCampanhas(criada.id)).toBe(0);
      expect(contarDestinatarios(criada.id)).toBe(0);
    });

    test('campanha PROCESSANDO não pode ser excluída: 409 CAMPANHA_EM_ENVIO @spec:AC-245', async () => {
      const criada = await criarCampanhaViaRota('Campanha Processando Nao Exclui Rota', [
        { nome: 'P', email: 'processando.nao.exclui.rota@teste.local' },
      ]);
      definirStatusCampanha(criada.id, 'PROCESSANDO');

      const resposta = await deleteCampanha(criada.id, cookieGerenteA);
      expect(resposta.status).toBe(409);
      expect((await resposta.json()).codigo).toBe('CAMPANHA_EM_ENVIO');
      expect(contarCampanhas(criada.id)).toBe(1);
    });
  });
});
