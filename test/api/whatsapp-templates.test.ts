// T-249 (fase5-whatsapp-lote-base, US-160): templates de mensagem contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('T-249: templates de mensagem', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/whatsapp/templates/route');
  let rotaId: typeof import('../../src/app/api/whatsapp/templates/[id]/route');
  let gerente: string;
  let gerenteB: string;
  let atendente: string;

  const req = (url: string, cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const lista = (cookie = gerente) => rotaLista.GET(req('/api/whatsapp/templates', cookie));
  const criar = (corpo: unknown, cookie: string | null = gerente) => rotaLista.POST(req('/api/whatsapp/templates', cookie, 'POST', corpo));
  const alterar = (id: string, corpo: unknown, cookie: string | null = gerente) =>
    rotaId.PATCH(req(`/api/whatsapp/templates/${id}`, cookie, 'PATCH', corpo), { params: Promise.resolve({ id }) });
  const criado = async (nome: string, corpo = 'Olá, {{primeiro_nome}}!', cookie = gerente) => (await (await criar({ nome, corpo }, cookie)).json()) as { id: string };

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f670@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f670@teste.com', 'GERENTE', amb.tenants.empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f670@teste.com', 'ATENDENTE');
    rotaLista = await import('../../src/app/api/whatsapp/templates/route');
    rotaId = await import('../../src/app/api/whatsapp/templates/[id]/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('o gerente cria em rascunho; nome repetido, variável desconhecida, tamanho ruim e atendente são recusados @spec:AC-670', async () => {
    const r = await criar({ nome: '  Boas vindas ', corpo: 'Olá, {{primeiro_nome}}! Aqui é da clínica.' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ nome: 'Boas vindas', status: 'rascunho', aprovadoEm: null });

    const repetido = await criar({ nome: 'BOAS VINDAS', corpo: 'x' });
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).codigo).toBe('TEMPLATE_JA_EXISTE');
    expect((await criar({ nome: 'BOAS VINDAS', corpo: 'x' }, gerenteB)).status).toBe(201); // outra empresa pode repetir

    for (const [corpo, campo] of [
      [{ nome: 'Com cidade', corpo: 'Oi {{cidade}}' }, 'corpo'],
      [{ nome: 'a', corpo: 'x' }, 'nome'],
      [{ nome: 'Longo', corpo: 'x'.repeat(1001) }, 'corpo'],
      [{ nome: 'Vazio', corpo: '  ' }, 'corpo'],
    ] as Array<[Record<string, unknown>, string]>) {
      const e = await criar(corpo);
      expect(e.status, campo).toBe(400);
      expect((await e.json()).campo).toBe(campo);
    }
    expect((await criar({ nome: 'Do atendente', corpo: 'x' }, atendente)).status).toBe(403);
    expect((await criar({ nome: 'Sem sessão', corpo: 'x' }, null)).status).toBe(401);
  });

  test('aprovar grava quem e quando; editar aprovado volta a rascunho; arquivado não edita nem aprova; outra empresa é 404 @spec:AC-671', async () => {
    const { id } = await criado('Para aprovar');
    const aprovado = await (await alterar(id, { acao: 'aprovar' })).json();
    expect(aprovado).toMatchObject({ status: 'aprovado', aprovadoPorNome: expect.any(String) });
    expect(new Date(aprovado.aprovadoEm).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const editado = await (await alterar(id, { corpo: 'Texto novo para {{nome}}' })).json();
    expect(editado).toMatchObject({ status: 'rascunho', corpo: 'Texto novo para {{nome}}', aprovadoEm: null, aprovadoPorNome: null });
    await alterar(id, { acao: 'aprovar' });
    const igual = await (await alterar(id, { nome: 'Para aprovar' })).json(); // nada mudou: segue aprovado
    expect(igual.status).toBe('aprovado');

    expect((await alterar(id, { acao: 'arquivar' })).status).toBe(200);
    for (const corpo of [{ acao: 'aprovar' }, { corpo: 'x' }]) {
      const r = await alterar(id, corpo);
      expect(r.status).toBe(422);
      expect((await r.json()).codigo).toBe('TEMPLATE_ARQUIVADO');
    }
    expect((await alterar(id, { acao: 'aprovar' }, gerenteB)).status).toBe(404);
    expect((await alterar(id, { acao: 'aprovar' }, atendente)).status).toBe(403);
    expect((await alterar(id, { acao: 'voar' })).status).toBe(400);
    expect((await alterar('nao-e-uuid', { acao: 'aprovar' })).status).toBe(404);
  });

  test('o gerente vê todos da empresa; o atendente só os aprovados; ninguém vê os da outra @spec:AC-672', async () => {
    const rascunho = await criado('Lista rascunho');
    const ok = await criado('Lista aprovado');
    await alterar(ok.id, { acao: 'aprovar' });
    const arq = await criado('Lista arquivado');
    await alterar(arq.id, { acao: 'arquivar' });
    const doGerente = await (await lista()).json();
    expect(doGerente.podeGerir).toBe(true);
    const nomes = (corpo: { templates: Array<{ nome: string }> }) => corpo.templates.map((t) => t.nome);
    expect(nomes(doGerente)).toEqual(expect.arrayContaining(['Lista rascunho', 'Lista aprovado', 'Lista arquivado']));
    const doAtendente = await (await lista(atendente)).json();
    expect(doAtendente.podeGerir).toBe(false);
    expect(nomes(doAtendente)).toContain('Lista aprovado');
    expect(nomes(doAtendente)).not.toContain('Lista rascunho');
    expect(nomes(doAtendente)).not.toContain('Lista arquivado');
    const daB = await (await lista(gerenteB)).json();
    expect(nomes(daB)).toEqual(['BOAS VINDAS']);
    void rascunho;
  });
});
