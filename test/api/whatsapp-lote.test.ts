// T-254 (fase5-whatsapp-lote-disparo, US-162/US-164): criar, listar, detalhar e cancelar lotes contra um Postgres efêmero
// real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ID = (n: number) => `d4d4d4d4-6770-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const L_OK = ID(1);
const L_OK2 = ID(2);
const L_SEM = ID(3); // sem consentimento
const L_B = ID(4);
const C_OK = ID(11);
const C_OK2 = ID(12);
const C_SEM = ID(13);
const C_B = ID(14);
const T_APROVADO = ID(31);
const T_RASCUNHO = ID(32);
const T_DA_B = ID(33);

describe('T-254: lotes de WhatsApp (API)', () => {
  let amb: AmbienteAnexos;
  let rotaLote: typeof import('../../src/app/api/whatsapp/lote/route');
  let rotaId: typeof import('../../src/app/api/whatsapp/lote/[id]/route');
  let rotaCancelar: typeof import('../../src/app/api/whatsapp/lote/[id]/cancelar/route');
  let gerente: string;
  let gerenteB: string;
  let atendente: string;
  let loteId = '';

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const req = (url: string, cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const criar = (corpo: unknown, cookie: string | null = gerente) => rotaLote.POST(req('/api/whatsapp/lote', cookie, 'POST', corpo));
  const listar = (cookie = gerente) => rotaLote.GET(req('/api/whatsapp/lote', cookie));
  const detalhe = (id: string, cookie = gerente) => rotaId.GET(req(`/api/whatsapp/lote/${id}`, cookie), { params: Promise.resolve({ id }) });
  const cancelar = (id: string, cookie: string | null = gerente) => rotaCancelar.POST(req(`/api/whatsapp/lote/${id}/cancelar`, cookie, 'POST'), { params: Promise.resolve({ id }) });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    gerente = await cookieDePapel(amb, 'gerente.f677@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f677@teste.com', 'GERENTE', empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f677@teste.com', 'ATENDENTE');
    sql(`INSERT INTO empresa_configuracoes (empresa_id, chave, valor) VALUES ('${empresaA}', 'evolution_instance_name', '"instancia-a"'::jsonb);
         INSERT INTO leads (id, empresa_id, nome, telefone_e164, consentimento_whatsapp_em) VALUES
           ('${L_OK}', '${empresaA}', 'Dra. Ana Lima', '5511988880001', now()),
           ('${L_OK2}', '${empresaA}', 'Dr. Carlos Dias', '5511977770002', now()),
           ('${L_SEM}', '${empresaA}', 'Sem Consentimento', '5511966660003', NULL),
           ('${L_B}', '${empresaB}', 'Da Outra', '5511955550004', now());
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id) VALUES
           ('${C_OK}', '${empresaA}', '${L_OK}', 5), ('${C_OK2}', '${empresaA}', '${L_OK2}', 5),
           ('${C_SEM}', '${empresaA}', '${L_SEM}', 5), ('${C_B}', '${empresaB}', '${L_B}', 5);
         INSERT INTO whatsapp_templates (id, empresa_id, nome, corpo, status, aprovado_em) VALUES
           ('${T_APROVADO}', '${empresaA}', 'Boas-vindas', 'Olá, {{primeiro_nome}}!', 'aprovado', now()),
           ('${T_RASCUNHO}', '${empresaA}', 'Rascunho', 'x', 'rascunho', NULL),
           ('${T_DA_B}', '${empresaB}', 'Da B', 'Oi', 'aprovado', now());`);
    rotaLote = await import('../../src/app/api/whatsapp/lote/route');
    rotaId = await import('../../src/app/api/whatsapp/lote/[id]/route');
    rotaCancelar = await import('../../src/app/api/whatsapp/lote/[id]/cancelar/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('recusas na criação: template não aprovado ou de outra empresa, sem destinatários, WhatsApp não configurado — nada é gravado @spec:AC-678', async () => {
    const naoGravou = () => expect(sql('SELECT count(*) FROM whatsapp_lotes')).toBe('0');
    const rascunho = await criar({ templateId: T_RASCUNHO, oportunidadeIds: [C_OK] });
    expect(rascunho.status).toBe(422);
    expect((await rascunho.json()).codigo).toBe('TEMPLATE_NAO_APROVADO');
    expect((await criar({ templateId: T_DA_B, oportunidadeIds: [C_OK] })).status).toBe(404);
    expect((await criar({ templateId: ID(99), oportunidadeIds: [C_OK] })).status).toBe(404);
    const vazio = await criar({ templateId: T_APROVADO, oportunidadeIds: [C_SEM, C_B] });
    expect(vazio.status).toBe(422);
    expect((await vazio.json()).codigo).toBe('SEM_DESTINATARIOS');
    // a empresa B não tem instância do WhatsApp
    const semInstancia = await criar({ templateId: T_DA_B, leadIds: [L_B] }, gerenteB);
    expect(semInstancia.status).toBe(409);
    expect((await semInstancia.json()).codigo).toBe('WHATSAPP_NAO_CONFIGURADO');
    expect((await criar({ templateId: T_APROVADO, oportunidadeIds: [] })).status).toBe(400);
    naoGravou();
    expect(sql('SELECT count(*) FROM whatsapp_lote_itens')).toBe('0');
  });

  test('criar grava o lote só com os elegíveis e a mensagem já preenchida; atendente 403, sem sessão 401 @spec:AC-677', async () => {
    expect((await criar({ templateId: T_APROVADO, oportunidadeIds: [C_OK] }, atendente)).status).toBe(403);
    expect((await criar({ templateId: T_APROVADO, oportunidadeIds: [C_OK] }, null)).status).toBe(401);

    const r = await criar({ templateId: T_APROVADO, oportunidadeIds: [C_OK, C_SEM, C_OK2] });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    loteId = corpo.loteId;
    expect(corpo).toMatchObject({ total: 2, duracaoEstimadaSegundos: 30 });
    expect(corpo.excluidos).toEqual([{ leadId: L_SEM, nome: 'Sem Consentimento', motivo: 'SEM_CONSENTIMENTO' }]);
    expect(sql(`SELECT status || '|' || total || '|' || template_nome FROM whatsapp_lotes WHERE id = '${loteId}'`)).toBe('em_andamento|2|Boas-vindas');
    expect(sql(`SELECT string_agg(ordem || ':' || status || ':' || mensagem, ' / ' ORDER BY ordem) FROM whatsapp_lote_itens WHERE lote_id = '${loteId}'`)).toBe('1:pendente:Olá, Dra.! / 2:pendente:Olá, Dr.!');
  });

  test('só um lote por empresa em andamento: o segundo dá 409 LOTE_EM_ANDAMENTO @spec:AC-678', async () => {
    const r = await criar({ templateId: T_APROVADO, oportunidadeIds: [C_OK] });
    expect(r.status).toBe(409);
    expect((await r.json()).codigo).toBe('LOTE_EM_ANDAMENTO');
    expect(sql('SELECT count(*) FROM whatsapp_lotes')).toBe('1');
  });

  test('a lista e o detalhe mostram só a empresa, com contagens e destinatários; atendente 403, outra empresa 404 @spec:AC-683', async () => {
    sql(`UPDATE whatsapp_lote_itens SET status = 'enviado', enviado_em = now() WHERE lote_id = '${loteId}' AND ordem = 1`);
    const lista = await (await listar()).json();
    expect(lista.lotes).toHaveLength(1);
    expect(lista.lotes[0]).toMatchObject({ id: loteId, templateNome: 'Boas-vindas', status: 'em_andamento', total: 2, enviados: 1, falhas: 0, pendentes: 1, cancelados: 0 });
    expect(lista.lotes[0].criadoPorNome).toBeTruthy();
    expect((await (await listar(gerenteB)).json()).lotes).toEqual([]);

    const d = await (await detalhe(loteId)).json();
    expect(d.itens.map((i: { nome: string; status: string }) => [i.nome, i.status])).toEqual([['Dra. Ana Lima', 'enviado'], ['Dr. Carlos Dias', 'pendente']]);
    expect((await detalhe(loteId, gerenteB)).status).toBe(404);
    expect((await detalhe('nao-uuid')).status).toBe(404);
    expect((await listar(atendente)).status).toBe(403);
    expect((await detalhe(loteId, atendente)).status).toBe(403);
  });

  test('cancelar converte os pendentes e encerra o lote, sem desfazer o que saiu; repetir dá 422 @spec:AC-684', async () => {
    expect((await cancelar(loteId, gerenteB)).status).toBe(404);
    expect((await cancelar(loteId, atendente)).status).toBe(403);
    const r = await cancelar(loteId);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'cancelado', enviados: 1, pendentes: 0, cancelados: 1 });
    expect(sql(`SELECT string_agg(status, ',' ORDER BY ordem) FROM whatsapp_lote_itens WHERE lote_id = '${loteId}'`)).toBe('enviado,cancelado');
    const de_novo = await cancelar(loteId);
    expect(de_novo.status).toBe(422);
    expect((await de_novo.json()).codigo).toBe('LOTE_ENCERRADO');

    // com o lote encerrado já cabe outro, e a lista vem do mais novo para o mais antigo
    expect((await criar({ templateId: T_APROVADO, oportunidadeIds: [C_OK2] })).status).toBe(201);
    const lista = await (await listar()).json();
    expect(lista.lotes).toHaveLength(2);
    expect(lista.lotes[0].status).toBe('em_andamento');
    expect(lista.lotes[1].id).toBe(loteId);
  });
});
