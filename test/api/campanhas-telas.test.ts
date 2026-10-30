// T-196 (fase4-campanhas, US-129/US-130/US-131): lista com contagens e indicadores,
// prévia de destinatários, origem por várias etapas, edição e detalhe, contra um
// Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { criarAuth } from '../../src/lib/auth/server';
import { convidarUsuario } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const ANA = 'abababab-1960-0000-0000-0000000000a1';
const ID = (n: number) => `abababab-1961-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const C_RASCUNHO = ID(1);
const C_ENVIANDO = ID(2);
const C_CONCLUIDA = ID(3);
const C_OUTRA = ID(4);

describe('T-196: API de campanhas para as telas', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/campanhas/route');
  let rotaDetalhe: typeof import('../../src/app/api/campanhas/[id]/route');
  let rotaPrevia: typeof import('../../src/app/api/campanhas/previa-destinatarios/route');
  let cookieAtendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const req = (url: string, cookie: string | null, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const lista = (query = '', cookie: string | null = amb.cookieA) => rotaLista.GET(req(`/api/campanhas${query}`, cookie));
  const previa = (query: string, cookie: string | null = amb.cookieA) => rotaPrevia.GET(req(`/api/campanhas/previa-destinatarios${query}`, cookie));

  function envios(campanha: string, status: string, quantidade: number, enviado: boolean, empresa = amb.tenants.empresaA) {
    for (let i = 0; i < quantidade; i += 1) {
      sql(`INSERT INTO envios_campanha (empresa_id, campanha_id, nome_destinatario, email_destinatario, status, enviado_em)
           VALUES ('${empresa}', '${campanha}', 'Pessoa ${status} ${i}', '${status.toLowerCase()}${i}@${campanha.slice(-2)}.com', '${status}', ${enviado ? 'now()' : 'NULL'})`);
    }
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB, leadA, oportunidadeA } = amb.tenants;
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f196.com', 'Ana Criadora');
         INSERT INTO campanhas (id, empresa_id, nome, assunto, corpo_html, status, criado_por, criado_em) VALUES
           ('${C_RASCUNHO}', '${empresaA}', 'Alfa Institucional', 'Assunto alfa', '<p>oi</p>', 'RASCUNHO', '${ANA}', now() - interval '1 day'),
           ('${C_ENVIANDO}', '${empresaA}', 'Beta Reativação', 'Assunto beta', '<p>beta</p>', 'PROCESSANDO', '${ANA}', now() - interval '2 days'),
           ('${C_CONCLUIDA}', '${empresaA}', 'Gama Antiga', 'Outro assunto', '<p>gama</p>', 'FINALIZADA', NULL, now() - interval '40 days'),
           ('${C_OUTRA}', '${empresaB}', 'Da Outra Empresa', 'x', '<p>x</p>', 'RASCUNHO', NULL, now());`);
    envios(C_RASCUNHO, 'RASCUNHO', 2, false);
    envios(C_ENVIANDO, 'ENVIADO', 3, true);
    envios(C_ENVIANDO, 'ABERTO', 1, true);
    envios(C_ENVIANDO, 'CLICADO', 1, true);
    envios(C_ENVIANDO, 'ERRO', 1, false);
    envios(C_ENVIANDO, 'PENDENTE', 2, false);
    sql(`INSERT INTO envios_campanha (empresa_id, campanha_id, nome_destinatario, email_destinatario, status, enviado_em)
         VALUES ('${empresaA}', '${C_CONCLUIDA}', 'Antigo 1', 'antigo1@x.com', 'ENVIADO', now() - interval '40 days'),
                ('${empresaA}', '${C_CONCLUIDA}', 'Antigo 2', 'antigo2@x.com', 'ENVIADO', now() - interval '40 days')`);
    envios(C_OUTRA, 'ENVIADO', 4, true, empresaB);

    // leads para a prévia (etapas 7, 9, 10)
    sql(`INSERT INTO leads (id, empresa_id, nome, email) VALUES
           ('${ID(11)}', '${empresaA}', 'Lead Um', 'a@x.com'),
           ('${ID(12)}', '${empresaA}', 'Lead Dois', 'b@x.com'),
           ('${ID(13)}', '${empresaA}', 'Lead Três', 'B@X.com'),
           ('${ID(14)}', '${empresaA}', 'Lead Inválido', 'semarroba'),
           ('${ID(15)}', '${empresaA}', 'Lead Sem Email', NULL),
           ('${ID(16)}', '${empresaB}', 'Lead Da B', 'c@x.com');
         INSERT INTO oportunidades (empresa_id, lead_id, etapa_id, valor, proxima_acao_em) VALUES
           ('${empresaA}', '${ID(11)}', 7, 1000, now() + interval '1 day'), ('${empresaA}', '${ID(12)}', 9, 500, NULL), ('${empresaA}', '${ID(13)}', 10, 200, NULL),
           ('${empresaA}', '${ID(14)}', 7, 9999, now() + interval '1 day'), ('${empresaA}', '${ID(15)}', 7, 9999, now() + interval '1 day'), ('${empresaB}', '${ID(16)}', 7, 7777, now() + interval '1 day');`);
    void leadA; void oportunidadeA;

    const db = amb.db;
    const auth = criarAuth(db);
    const convite = await convidarUsuario(db, { usuarioId: 'ffffffff-0000-0000-0000-0000000000f1', empresaId: empresaA, papel: 'MASTER', isSuperAdmin: false }, { email: 'atendente.f196@teste.com', papel: 'ATENDENTE' });
    await definirSenhaComToken(db, convite.token, 'senha-correta-123');
    const resposta = await auth.api.signInEmail({ body: { email: 'atendente.f196@teste.com', password: 'senha-correta-123' }, asResponse: true });
    cookieAtendente = (resposta.headers.getSetCookie?.() ?? []).find((c) => c.includes('better-auth.session_token='))!.split(';')[0];

    rotaLista = await import('../../src/app/api/campanhas/route');
    rotaDetalhe = await import('../../src/app/api/campanhas/[id]/route');
    rotaPrevia = await import('../../src/app/api/campanhas/previa-destinatarios/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('a lista traz as contagens, os filtros e a paginação, só da empresa e só para gerente e master @spec:AC-533', async () => {
    const r = await lista();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.campanhas.map((c: { nome: string }) => c.nome)).toEqual(['Alfa Institucional', 'Beta Reativação', 'Gama Antiga']);
    expect(corpo.total).toBe(3);
    const beta = corpo.campanhas[1];
    expect(beta).toMatchObject({ id: C_ENVIANDO, status: 'PROCESSANDO', totalDestinatarios: 8, contagens: { enviado: 3, aberto: 1, clicado: 1, erro: 1, pendente: 2, rascunho: 0 } });
    expect(beta.criadoEm).toBeTruthy();

    const soEnviando = await (await lista('?status=enviando')).json();
    expect(soEnviando.campanhas.map((c: { id: string }) => c.id)).toEqual([C_ENVIANDO]);
    const busca = await (await lista('?busca=assunto%20alfa')).json();
    expect(busca.campanhas.map((c: { id: string }) => c.id)).toEqual([C_RASCUNHO]);
    const recentes = await (await lista('?dias=30')).json();
    expect(recentes.campanhas).toHaveLength(2);
    const pagina = await (await lista('?pagina=2&porPagina=2')).json();
    expect(pagina.campanhas.map((c: { id: string }) => c.id)).toEqual([C_CONCLUIDA]);
    expect(pagina.total).toBe(3);

    expect((await lista('?status=inventado')).status).toBe(400);
    expect((await lista('?dias=15')).status).toBe(400);
    expect((await lista('?pagina=0&porPagina=10')).status).toBe(400);
    expect((await lista('', null)).status).toBe(401);
    expect((await lista('', cookieAtendente)).status).toBe(403);
    expect((await (await lista('', amb.cookieB)).json()).campanhas.map((c: { id: string }) => c.id)).toEqual([C_OUTRA]);
  });

  test('os indicadores são os disparos do mês e as taxas de entrega, abertura e cliques @spec:AC-534', async () => {
    const { resumo } = await (await lista()).json();
    // enviados (ENVIADO+ABERTO+CLICADO) = 5 + 2 antigos = 7; falhas = 1
    expect(resumo).toEqual({ disparosNoMes: 5, taxaEntrega: 87.5, taxaAbertura: 28.6, taxaCliques: 14.3 });
    const daB = (await (await lista('', amb.cookieB)).json()).resumo;
    expect(daB).toEqual({ disparosNoMes: 4, taxaEntrega: 100, taxaAbertura: 0, taxaCliques: 0 });
  });

  test('a prévia conta os destinatários por etapa, o total único e o valor em pipeline, só da empresa @spec:AC-540', async () => {
    const r = await previa('?etapaIds=7,9,10');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ porEtapa: [{ etapaId: 7, total: 1 }, { etapaId: 9, total: 1 }, { etapaId: 10, total: 1 }], total: 2, valorEmPipeline: 1700, descadastrados: 0 });
    expect((await (await previa('?etapaIds=7', amb.cookieB)).json()).total).toBe(1);
    expect((await previa('')).status).toBe(400);
    expect((await previa('?etapaIds=abc')).status).toBe(400);
    expect((await previa('?etapaIds=99')).status).toBe(400);
    expect((await previa('?etapaIds=7', null)).status).toBe(401);
    expect((await previa('?etapaIds=7', cookieAtendente)).status).toBe(403);
  });

  test('criar com várias etapas junta os leads com e-mail, sem repetir, e a origem de uma etapa segue valendo @spec:AC-541', async () => {
    const criar = (origem: unknown) =>
      rotaLista.POST(req('/api/campanhas', amb.cookieA, { method: 'POST', body: { nome: 'Multi', assunto: 'Assunto', corpoHtml: '<p>oi</p>', origem } }));
    const r = await criar({ tipo: 'etapas', etapaIds: [7, 9, 10, 7] });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ totalDestinatarios: 2, descartadosInvalidos: 1, descartadosRepetidos: 1 });

    const uma = await criar({ tipo: 'etapa', etapaId: 9 });
    expect((await uma.json()).totalDestinatarios).toBe(1);
    expect((await criar({ tipo: 'etapas', etapaIds: [] })).status).toBe(400);
    expect((await criar({ tipo: 'etapas', etapaIds: [7, 'x'] })).status).toBe(400);
    expect((await criar({ tipo: 'etapas' })).status).toBe(400);
  });

  test('editar só vale no rascunho e o detalhe traz quem criou @spec:AC-544 @spec:AC-547', async () => {
    const patch = (id: string) =>
      rotaDetalhe.PATCH(req(`/api/campanhas/${id}`, amb.cookieA, { method: 'PATCH', body: { nome: 'Novo nome', assunto: 'Novo assunto', corpoHtml: '<p>novo</p>' } }), { params: Promise.resolve({ id }) });
    expect((await patch(C_RASCUNHO)).status).toBe(200);
    const bloqueada = await patch(C_ENVIANDO);
    expect(bloqueada.status).toBe(409);
    expect((await bloqueada.json()).codigo).toBe('CAMPANHA_NAO_EDITAVEL');

    const detalhe = await rotaDetalhe.GET(req(`/api/campanhas/${C_RASCUNHO}`, amb.cookieA), { params: Promise.resolve({ id: C_RASCUNHO }) });
    const corpo = await detalhe.json();
    expect(corpo.campanha).toMatchObject({ nome: 'Novo nome', assunto: 'Novo assunto', criadoPorNome: 'Ana Criadora' });
    expect(corpo.contagemPorStatus).toEqual({ RASCUNHO: 2 });

    const semCriador = await (await rotaDetalhe.GET(req(`/api/campanhas/${C_CONCLUIDA}`, amb.cookieA), { params: Promise.resolve({ id: C_CONCLUIDA }) })).json();
    expect(semCriador.campanha.criadoPorNome).toBeNull();

    const alheia = await rotaDetalhe.GET(req(`/api/campanhas/${C_OUTRA}`, amb.cookieA), { params: Promise.resolve({ id: C_OUTRA }) });
    expect(alheia.status).toBe(404);
  });
});
