// T-301 (fase4-tarefas-agenda, US-122): a integração com o Google Meet — conectar a conta da empresa (OAuth) e a sala do Meet de cada reunião
// (criar, mudar de horário, apagar) — contra um Postgres efêmero real, dois tenants e um Google falso local (test/support/google-falso.ts).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { subirGoogleFalso, type GoogleFalso } from '../support/google-falso';

const SEGREDO = 'segredo-de-teste-para-configuracoes-1234567890';
const AMANHA = () => new Date(Date.now() + 24 * 3600_000).toISOString();
const DEPOIS = () => new Date(Date.now() + 3 * 24 * 3600_000).toISOString();

describe('T-301: Google Meet na agenda', () => {
  let amb: AmbienteAnexos;
  let google: GoogleFalso;
  let atendente: string;
  let rotas: {
    status: typeof import('../../src/app/api/integracoes/google/route');
    conectar: typeof import('../../src/app/api/integracoes/google/conectar/route');
    callback: typeof import('../../src/app/api/integracoes/google/callback/route');
    meetStatus: typeof import('../../src/app/api/reunioes/meet/route');
    agendar: typeof import('../../src/app/api/reunioes/route');
    gerar: typeof import('../../src/app/api/reunioes/[id]/meet/route');
    reagendar: typeof import('../../src/app/api/reunioes/[id]/reagendar/route');
    cancelar: typeof import('../../src/app/api/reunioes/[id]/cancelar/route');
  };
  const ambienteOriginal = { ...process.env };
  let contador = 0;

  const sql = (texto: string) => {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const req = (caminho: string, cookie: string | null, init: { method?: string; corpo?: unknown; extraCookie?: string } = {}) =>
    new NextRequest(`http://localhost${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(cookie ? { Cookie: init.extraCookie ? `${cookie}; ${init.extraCookie}` : cookie } : {}),
        ...(init.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    });
  const comId = (id: string) => ({ params: Promise.resolve({ id }) });

  /** Um card em "Qualificado p/ reunião" da empresa A, com o gerente A como closer. */
  function novoCard(email: string | null = 'dra.ana@clinica.com.br'): { card: string; lead: string } {
    contador += 1;
    const card = `dddddddd-5555-4000-8000-${contador.toString(16).padStart(12, '0')}`;
    const lead = `dddddddd-6666-4000-8000-${contador.toString(16).padStart(12, '0')}`;
    sql(`INSERT INTO leads (id, empresa_id, nome, email) VALUES ('${lead}', '${amb.tenants.empresaA}', 'Clínica ${contador}', ${email ? `'${email}'` : 'NULL'})`);
    sql(`INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, responsavel_id)
         VALUES ('${card}', '${amb.tenants.empresaA}', '${lead}', 6, (SELECT id FROM usuarios WHERE email = 'gerente.a@teste.com'))`);
    return { card, lead };
  }
  async function agendar(card: string, quando = AMANHA(), cookie: string = amb.cookieA) {
    return rotas.agendar.POST(req('/api/reunioes', cookie, { method: 'POST', corpo: { oportunidadeId: card, agendadaPara: quando } }));
  }
  /** Conecta a conta como o usuário faria: `conectar` gera o state, o Google devolve o `code` e o `callback` guarda a conta. */
  async function conectar(cookie: string = amb.cookieA) {
    const inicio = await rotas.conectar.GET(req('/api/integracoes/google/conectar', cookie));
    const state = new URL(inicio.headers.get('location')!).searchParams.get('state')!;
    return rotas.callback.GET(req(`/api/integracoes/google/callback?code=codigo-do-google&state=${state}`, cookie, { extraCookie: `crm_google_state=${state}` }));
  }
  const chamadasAoCalendario = (metodo: string) => google.chamadas.filter((c) => c.metodo === metodo && c.caminho.startsWith('/calendar/'));
  const reuniao = (id: string, coluna: string) => sql(`SELECT coalesce(${coluna}::text, '') FROM reunioes WHERE id = '${id}'`);

  beforeAll(async () => {
    google = await subirGoogleFalso();
    process.env.SEGREDO_CONFIGURACOES = SEGREDO;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cliente-de-teste';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'segredo-do-cliente';
    process.env.GOOGLE_AUTH_URL = 'https://accounts.example/auth';
    process.env.GOOGLE_TOKEN_URL = `${google.url}/token`;
    process.env.GOOGLE_REVOKE_URL = `${google.url}/revoke`;
    process.env.GOOGLE_API_URL = google.url;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';

    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.meet@teste.com', 'ATENDENTE');
    rotas = {
      status: await import('../../src/app/api/integracoes/google/route'),
      conectar: await import('../../src/app/api/integracoes/google/conectar/route'),
      callback: await import('../../src/app/api/integracoes/google/callback/route'),
      meetStatus: await import('../../src/app/api/reunioes/meet/route'),
      agendar: await import('../../src/app/api/reunioes/route'),
      gerar: await import('../../src/app/api/reunioes/[id]/meet/route'),
      reagendar: await import('../../src/app/api/reunioes/[id]/reagendar/route'),
      cancelar: await import('../../src/app/api/reunioes/[id]/cancelar/route'),
    };
  }, 180_000);
  afterAll(async () => {
    await google?.fechar();
    await amb?.parar();
    for (const chave of Object.keys(process.env)) if (!(chave in ambienteOriginal)) delete process.env[chave];
    Object.assign(process.env, ambienteOriginal);
  });
  beforeEach(() => {
    google.falharCalendario = false;
    google.recusarTroca = false;
    google.semRefreshToken = false;
    google.contaDoToken = 'contato@medguia.com.br';
  });

  test('conectar leva ao Google com o state num cookie, e só o retorno correto guarda a conta, com o token cifrado @spec:AC-765', async () => {
    const inicio = await rotas.conectar.GET(req('/api/integracoes/google/conectar', amb.cookieA));
    expect(inicio.status).toBe(302);
    const destino = new URL(inicio.headers.get('location')!);
    expect(destino.origin + destino.pathname).toBe('https://accounts.example/auth');
    expect(destino.searchParams.get('client_id')).toBe('cliente-de-teste');
    expect(destino.searchParams.get('redirect_uri')).toBe('http://localhost/api/integracoes/google/callback');
    expect(destino.searchParams.get('access_type')).toBe('offline');
    expect(destino.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events');
    const state = destino.searchParams.get('state')!;
    expect(inicio.headers.get('set-cookie')).toContain(`crm_google_state=${state}`);

    const volta = (consulta: string, cookie = `crm_google_state=${state}`) =>
      rotas.callback.GET(req(`/api/integracoes/google/callback?${consulta}`, amb.cookieA, { extraCookie: cookie }));
    const destinoDe = (r: Response) => new URL(r.headers.get('location')!).search;

    expect(destinoDe(await volta('code=x&state=outro'))).toBe('?erro=estado');
    expect(destinoDe(await volta('code=x&state=' + state, 'sem=cookie'))).toBe('?erro=estado');
    expect(destinoDe(await volta('error=access_denied&state=' + state))).toBe('?erro=negado');
    google.recusarTroca = true;
    expect(destinoDe(await volta(`code=x&state=${state}`))).toBe('?erro=falha');
    google.recusarTroca = false;
    google.semRefreshToken = true;
    expect(destinoDe(await volta(`code=x&state=${state}`))).toBe('?erro=falha');
    google.semRefreshToken = false;
    expect(sql(`SELECT count(*) FROM empresa_configuracoes WHERE chave LIKE 'google_%'`)).toBe('0');

    const ok = await volta(`code=x&state=${state}`);
    expect(destinoDe(ok)).toBe('?conectado=1');
    expect(sql(`SELECT valor #>> '{}' FROM empresa_configuracoes WHERE empresa_id = '${amb.tenants.empresaA}' AND chave = 'google_conta_email'`)).toBe('contato@medguia.com.br');
    const guardado = sql(`SELECT valor #>> '{}' FROM empresa_configuracoes WHERE empresa_id = '${amb.tenants.empresaA}' AND chave = 'google_refresh_token'`);
    expect(guardado.startsWith('v1:')).toBe(true);
    expect(guardado).not.toContain('refresh-do-google');
  });

  test('o estado do Meet aparece para qualquer papel, o da gestão só para gerente, sem token, e cada empresa vê só o seu @spec:AC-766', async () => {
    const publico = await (await rotas.meetStatus.GET(req('/api/reunioes/meet', atendente))).json();
    expect(publico).toEqual({ conectado: true, conta: 'contato@medguia.com.br' });
    expect((await rotas.meetStatus.GET(req('/api/reunioes/meet', null))).status).toBe(401);
    expect(await (await rotas.meetStatus.GET(req('/api/reunioes/meet', amb.cookieB))).json()).toEqual({ conectado: false, conta: null });

    const gestao = await rotas.status.GET(req('/api/integracoes/google', amb.cookieA));
    const texto = await gestao.text();
    expect(JSON.parse(texto)).toEqual({ configuradoNoServidor: true, conectado: true, conta: 'contato@medguia.com.br' });
    expect(texto).not.toContain('refresh');
    expect((await rotas.status.GET(req('/api/integracoes/google', atendente))).status).toBe(403);
    expect((await rotas.status.GET(req('/api/integracoes/google', null))).status).toBe(401);
    expect((await rotas.conectar.GET(req('/api/integracoes/google/conectar', atendente))).status).toBe(403);
  });

  test('agendar com o Google conectado cria o evento com a sala do Meet, convida o lead e o closer e guarda o link @spec:AC-767', async () => {
    const { card } = novoCard('dra.ana@clinica.com.br');
    const r = await agendar(card);
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.meetUrl).toMatch(/^https:\/\/meet\.google\.com\/aaa-bbbb-\d{3}$/);

    const troca = google.chamadas.filter((c) => c.caminho === '/token').at(-1)!;
    expect(troca.corpo).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-do-google-1234567890' });
    const criacao = chamadasAoCalendario('POST').at(-1)!;
    expect(criacao.caminho).toBe('/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all');
    expect(criacao.autorizacao).toBe('Bearer acesso-de-refresh-do-google-1234567890');
    const evento = criacao.corpo as {
      summary: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string };
      attendees: { email: string }[];
      conferenceData: { createRequest: { requestId: string; conferenceSolutionKey: { type: string } } };
    };
    expect(evento.summary).toMatch(/^Demonstração MedGuia — Clínica \d+$/);
    expect(evento.attendees.map((a) => a.email).sort()).toEqual(['dra.ana@clinica.com.br', 'gerente.a@teste.com']);
    expect(evento.conferenceData.createRequest).toEqual({ requestId: corpo.id, conferenceSolutionKey: { type: 'hangoutsMeet' } });
    expect(new Date(evento.end.dateTime).getTime() - new Date(evento.start.dateTime).getTime()).toBe(60 * 60_000);
    expect(evento.start.timeZone).toBe('America/Sao_Paulo');
    expect(reuniao(corpo.id, 'meet_url')).toBe(corpo.meetUrl);
    expect(reuniao(corpo.id, 'calendar_event_id')).toMatch(/^evento-\d+$/);
  });

  test('lead sem e-mail convida só o closer; lead com o mesmo e-mail do closer e a própria conta não são convidados duas vezes @spec:AC-767', async () => {
    const semEmail = novoCard(null);
    await agendar(semEmail.card);
    expect((chamadasAoCalendario('POST').at(-1)!.corpo.attendees as { email: string }[]).map((a) => a.email)).toEqual(['gerente.a@teste.com']);

    const igual = novoCard('gerente.a@teste.com');
    await agendar(igual.card);
    expect((chamadasAoCalendario('POST').at(-1)!.corpo.attendees as { email: string }[]).map((a) => a.email)).toEqual(['gerente.a@teste.com']);

    const daConta = novoCard('contato@medguia.com.br');
    await agendar(daConta.card);
    expect((chamadasAoCalendario('POST').at(-1)!.corpo.attendees as { email: string }[]).map((a) => a.email)).toEqual(['gerente.a@teste.com']);

    const invalido = novoCard('isto-nao-e-email');
    await agendar(invalido.card);
    expect((chamadasAoCalendario('POST').at(-1)!.corpo.attendees as { email: string }[]).map((a) => a.email)).toEqual(['gerente.a@teste.com']);
  });

  test('se o Google falhar na hora de agendar a reunião vale do mesmo jeito, sem link, e "Gerar link do Meet" refaz depois @spec:AC-770', async () => {
    const { card } = novoCard();
    google.falharCalendario = true;
    const r = await agendar(card);
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.meetUrl).toBeNull();
    expect(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`)).toBe('8');
    expect(reuniao(corpo.id, 'meet_url')).toBe('');

    const falha = await rotas.gerar.POST(req(`/api/reunioes/${corpo.id}/meet`, amb.cookieA, { method: 'POST', corpo: {} }), comId(corpo.id));
    expect(falha.status).toBe(502);
    expect((await falha.json()).codigo).toBe('FALHA_NO_GOOGLE');

    google.falharCalendario = false;
    const ok = await rotas.gerar.POST(req(`/api/reunioes/${corpo.id}/meet`, amb.cookieA, { method: 'POST', corpo: {} }), comId(corpo.id));
    expect(ok.status).toBe(200);
    const link = (await ok.json()).meetUrl as string;
    expect(link).toMatch(/^https:\/\/meet\.google\.com\//);
    const criados = chamadasAoCalendario('POST').length;

    const repetido = await rotas.gerar.POST(req(`/api/reunioes/${corpo.id}/meet`, amb.cookieA, { method: 'POST', corpo: {} }), comId(corpo.id));
    expect((await repetido.json()).meetUrl).toBe(link);
    expect(chamadasAoCalendario('POST')).toHaveLength(criados); // reunião que já tem sala não cria outra
  });

  test('"Gerar link" respeita sessão, empresa, estado da reunião e a conexão do Google @spec:AC-767', async () => {
    const { card } = novoCard();
    const corpo = await (await agendar(card)).json();
    const gerar = (id: string, cookie: string | null) => rotas.gerar.POST(req(`/api/reunioes/${id}/meet`, cookie, { method: 'POST', corpo: {} }), comId(id));

    expect((await gerar(corpo.id, null)).status).toBe(401);
    expect((await gerar(corpo.id, amb.cookieB)).status).toBe(404);
    expect((await gerar('nao-e-uuid', amb.cookieA)).status).toBe(404);
    expect((await gerar('aaaaaaaa-1111-4111-8111-00000000ffff', amb.cookieA)).status).toBe(404);
    expect((await gerar(corpo.id, atendente)).status).toBe(404); // atendente só age nos próprios cards

    sql(`UPDATE reunioes SET encerrada_em = now() WHERE id = '${corpo.id}'`);
    const realizada = await gerar(corpo.id, amb.cookieA);
    expect(realizada.status).toBe(422);
    expect((await realizada.json()).codigo).toBe('REUNIAO_NAO_PODE_GERAR_MEET');
  });

  test('reagendar move o evento do Calendar (a sala é a mesma) e passa o evento para a reunião nova @spec:AC-768', async () => {
    const { card } = novoCard();
    const original = await (await agendar(card)).json();
    const eventosAntes = google.eventos.size;
    sql(`UPDATE reunioes SET agendada_para = now() - interval '2 hours' WHERE id = '${original.id}'`); // a reunião passou e o lead faltou
    sql(`UPDATE reunioes SET no_show = true WHERE id = '${original.id}'`);
    sql(`UPDATE oportunidades SET etapa_id = 9 WHERE id = '${card}'`);

    const nova = AMANHA();
    const r = await rotas.reagendar.POST(req(`/api/reunioes/${original.id}/reagendar`, amb.cookieA, { method: 'POST', corpo: { agendadaPara: nova } }), comId(original.id));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    const mudanca = chamadasAoCalendario('PATCH').at(-1)!;
    expect(mudanca.caminho).toBe(`/calendar/v3/calendars/primary/events/${reuniao(original.id, 'calendar_event_id')}?sendUpdates=all`);
    expect((mudanca.corpo.start as { dateTime: string }).dateTime).toBe(new Date(nova).toISOString());
    expect(google.eventos.size).toBe(eventosAntes); // nenhum evento novo
    expect(corpo.meetUrl).toBe(original.meetUrl);
    expect(reuniao(corpo.id, 'calendar_event_id')).toBe(reuniao(original.id, 'calendar_event_id'));
  });

  test('reagendar uma reunião que nunca teve sala cria o evento para a nova @spec:AC-768', async () => {
    const { card } = novoCard();
    google.falharCalendario = true;
    const original = await (await agendar(card)).json();
    google.falharCalendario = false;
    expect(original.meetUrl).toBeNull();
    sql(`UPDATE reunioes SET agendada_para = now() + interval '2 hours' WHERE id = '${original.id}'`);

    const r = await rotas.reagendar.POST(req(`/api/reunioes/${original.id}/reagendar`, amb.cookieA, { method: 'POST', corpo: { agendadaPara: DEPOIS() } }), comId(original.id));
    expect(r.status).toBe(200);
    expect((await r.json()).meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
  });

  test('cancelar apaga o evento do Calendar; se o Google estiver fora, a reunião é cancelada do mesmo jeito @spec:AC-769', async () => {
    const a = await (await agendar(novoCard().card)).json();
    const eventoA = reuniao(a.id, 'calendar_event_id');
    expect(google.eventos.has(eventoA)).toBe(true);
    const cancelarReuniao = (id: string) => rotas.cancelar.POST(req(`/api/reunioes/${id}/cancelar`, amb.cookieA, { method: 'POST', corpo: {} }), comId(id));

    expect((await cancelarReuniao(a.id)).status).toBe(200);
    expect(google.eventos.has(eventoA)).toBe(false);
    expect(chamadasAoCalendario('DELETE').at(-1)!.caminho).toBe(`/calendar/v3/calendars/primary/events/${eventoA}?sendUpdates=all`);
    expect(sql(`SELECT count(*) FROM reunioes WHERE id = '${a.id}'`)).toBe('0');

    const b = await (await agendar(novoCard().card)).json();
    google.falharCalendario = true;
    expect((await cancelarReuniao(b.id)).status).toBe(200);
    expect(sql(`SELECT count(*) FROM reunioes WHERE id = '${b.id}'`)).toBe('0');
  });

  test('desconectar tira a permissão no Google, apaga o token e as reuniões novas ficam sem sala; sem o segredo do servidor nada é guardado @spec:AC-766', async () => {
    const r = await rotas.status.DELETE(req('/api/integracoes/google', amb.cookieA, { method: 'DELETE' }));
    expect(await r.json()).toEqual({ conectado: false, conta: null });
    expect(google.chamadas.some((c) => c.caminho === '/revoke' && c.corpo.token === 'refresh-do-google-1234567890')).toBe(true);
    expect(sql(`SELECT count(*) FROM empresa_configuracoes WHERE empresa_id = '${amb.tenants.empresaA}' AND chave LIKE 'google_%'`)).toBe('0');
    expect((await rotas.status.DELETE(req('/api/integracoes/google', atendente, { method: 'DELETE' }))).status).toBe(403);

    const chamadasAntes = google.chamadas.length;
    const semGoogle = await (await agendar(novoCard().card)).json();
    expect(semGoogle.meetUrl).toBeNull();
    expect(google.chamadas.length).toBe(chamadasAntes); // sem conexão não há nem pedido de token

    delete process.env.SEGREDO_CONFIGURACOES;
    const semSegredo = await conectar();
    expect(new URL(semSegredo.headers.get('location')!).search).toBe('?erro=segredo');
    process.env.SEGREDO_CONFIGURACOES = SEGREDO;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(new URL((await rotas.conectar.GET(req('/api/integracoes/google/conectar', amb.cookieA))).headers.get('location')!).search).toBe('?erro=nao_configurado');
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'segredo-do-cliente';
    expect(sql(`SELECT count(*) FROM empresa_configuracoes WHERE chave LIKE 'google_%'`)).toBe('0');
  });
});
