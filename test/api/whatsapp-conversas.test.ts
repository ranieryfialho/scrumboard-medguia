// T-189 (fase4-whatsapp, US-124): lista de conversas e "marcar todas como
// lidas", contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { listarConversas } from '../../src/repositories/whatsapp-conversas';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const BIA = 'ffffffff-1890-0000-0000-0000000000b1';
const L2 = 'ffffffff-1891-0000-0000-000000000002';
const L3 = 'ffffffff-1891-0000-0000-000000000003';
const C2 = 'ffffffff-1892-0000-0000-000000000002';

describe('T-189: conversas da caixa de entrada', () => {
  let amb: AmbienteAnexos;
  let rotaConversas: typeof import('../../src/app/api/whatsapp/conversas/route');
  let rotaLidas: typeof import('../../src/app/api/whatsapp/lidas/route');
  let gerenteId: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  function msg(empresa: string, lead: string | null, numero: string, texto: string, direcao: 'enviada' | 'recebida', lida: boolean, atras = '0 minutes') {
    sql(`INSERT INTO whatsapp_mensagens (empresa_id, lead_id, numero, mensagem, direcao, lida_em, criado_em)
         VALUES ('${empresa}', ${lead ? `'${lead}'` : 'NULL'}, '${numero}', '${texto}', '${direcao}', ${lida ? "now()" : 'NULL'}, now() - interval '${atras}')`);
  }
  const get = (cookie: string | null, query = '') =>
    rotaConversas.GET(new NextRequest(`http://localhost/api/whatsapp/conversas${query}`, { headers: cookie ? { Cookie: cookie } : {} }));
  const lidas = (cookie: string | null, corpo: unknown) =>
    rotaLidas.POST(
      new NextRequest('http://localhost/api/whatsapp/lidas', {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
    );

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB, leadA, leadB, oportunidadeA } = amb.tenants;
    gerenteId = sql(`SELECT id FROM usuarios WHERE email = 'gerente.a@teste.com'`);
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${BIA}', 'bia@f189.com', 'Bia');
         INSERT INTO leads (id, empresa_id, nome) VALUES ('${L2}', '${empresaA}', 'Maria Souza'), ('${L3}', '${empresaA}', 'João Sem Card');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, responsavel_id, valor) VALUES ('${C2}', '${empresaA}', '${L2}', 5, '${BIA}', 2500);
         UPDATE oportunidades SET responsavel_id = '${gerenteId}' WHERE id = '${oportunidadeA}';`);
    msg(empresaA, leadA, '5511911110001', 'oi 1', 'recebida', false, '10 minutes');
    msg(empresaA, leadA, '5511911110001', 'oi 2', 'recebida', false, '5 minutes');
    msg(empresaA, L2, '5511922220002', 'bom dia', 'recebida', true, '30 hours');
    msg(empresaA, L2, '5511922220002', 'bom dia, tudo bem?', 'enviada', true, '29 hours');
    msg(empresaA, L3, '5511933330003', 'quero saber mais', 'recebida', false, '3 minutes');
    msg(empresaA, null, '5511988880001', 'olá avulso', 'enviada', true, '8 minutes');
    msg(empresaA, null, '551188880001', 'respondeu', 'recebida', false, '1 minutes');
    msg(empresaB, leadB, '5511900000009', 'da outra empresa', 'recebida', false);
    process.env.DATABASE_URL = amb.pg.appUrl;
    rotaConversas = await import('../../src/app/api/whatsapp/conversas/route');
    rotaLidas = await import('../../src/app/api/whatsapp/lidas/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista uma conversa por lead ou número (nono dígito junto), da mais recente à mais antiga, só da empresa @spec:AC-500', async () => {
    const r = await get(amb.cookieA);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.conversas.map((c: { nome: string | null }) => c.nome)).toEqual([null, 'João Sem Card', 'Lead da Empresa A', 'Maria Souza']);
    const avulsa = corpo.conversas[0];
    expect(avulsa).toMatchObject({ leadId: null, naoLidas: 1, respondida: true, ultimaMensagem: 'respondeu', ultimaDirecao: 'recebida', card: null });
    const doLead = corpo.conversas.find((c: { nome: string }) => c.nome === 'Lead da Empresa A');
    expect(doLead).toMatchObject({ naoLidas: 2, ultimaMensagem: 'oi 2', card: { etapaId: 1, responsavel: { id: gerenteId } } });
    const maria = corpo.conversas.find((c: { nome: string }) => c.nome === 'Maria Souza');
    expect(maria).toMatchObject({ naoLidas: 0, card: { valor: '2500.00', responsavel: { nome: 'Bia' } } });
    expect(corpo.contagens).toEqual({ naoLidas: 3, minhas: 1, todas: 4 });
    expect(corpo.resumo).toEqual({ ativasHoje: 3, naoLidas: 4, mensagensHoje: { recebidas: 4, enviadas: 1 } });

    expect((await (await get(amb.cookieA, '?filtro=nao_lidas')).json()).conversas).toHaveLength(3);
    expect((await (await get(amb.cookieA, '?filtro=minhas')).json()).conversas.map((c: { nome: string }) => c.nome)).toEqual(['Lead da Empresa A']);
    expect((await (await get(amb.cookieA, '?filtro=avulsas&limite=4')).json()).conversas).toHaveLength(1);
    expect((await (await get(amb.cookieA, '?busca=maria')).json()).conversas).toHaveLength(1);
    expect((await (await get(amb.cookieA, '?busca=8888')).json()).conversas[0].leadId).toBeNull();
    expect((await get(amb.cookieA, '?filtro=inventado')).status).toBe(400);
    expect((await get(amb.cookieA, '?responsavelId=nao-uuid')).status).toBe(400);
    expect((await get(null)).status).toBe(401);

    const daB = await (await get(amb.cookieB)).json();
    expect(daB.conversas).toHaveLength(1);
    expect(daB.conversas[0].ultimaMensagem).toBe('da outra empresa');
  });

  test('o atendente só vê as dos próprios cards, as avulsas e as de leads sem card; o gerente filtra por pessoa @spec:AC-501', async () => {
    const atendente: ContextoTenant = { usuarioId: BIA, empresaId: amb.tenants.empresaA, papel: 'ATENDENTE', isSuperAdmin: false };
    const dele = await listarConversas(amb.db, atendente, { filtro: 'todas', somenteDoUsuario: true, responsavelId: gerenteId, agora: new Date() });
    expect(dele.conversas.map((c) => c.nome).sort()).toEqual([null, 'João Sem Card', 'Maria Souza'].sort());
    expect(dele.contagens.minhas).toBe(1);

    const filtrado = await (await get(amb.cookieA, `?responsavelId=${BIA}`)).json();
    expect(filtrado.conversas.map((c: { nome: string }) => c.nome)).toEqual(['Maria Souza']);
  });

  test('"todas" marca como lidas só as recebidas da empresa da sessão e zera a lista @spec:AC-505', async () => {
    expect((await lidas(null, { todas: true })).status).toBe(401);
    expect((await lidas(amb.cookieA, { todas: true, leadId: amb.tenants.leadA })).status).toBe(400);
    expect((await lidas(amb.cookieA, {})).status).toBe(400);

    const r = await lidas(amb.cookieA, { todas: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ marcadas: 4 });

    const depois = await (await get(amb.cookieA)).json();
    expect(depois.resumo.naoLidas).toBe(0);
    expect(depois.contagens.naoLidas).toBe(0);
    // a outra empresa não foi tocada
    expect((await (await get(amb.cookieB)).json()).resumo.naoLidas).toBe(1);
    expect(await (await lidas(amb.cookieA, { todas: true })).json()).toEqual({ marcadas: 0 });
  });

  test('os indicadores do topo são conversas ativas hoje e mensagens não lidas, sem tempo nem taxa de resposta @spec:AC-506', async () => {
    const corpo = await (await get(amb.cookieA)).json();
    expect(Object.keys(corpo.resumo).sort()).toEqual(['ativasHoje', 'mensagensHoje', 'naoLidas']);
    expect(corpo.resumo.ativasHoje).toBe(3);
  });
});
