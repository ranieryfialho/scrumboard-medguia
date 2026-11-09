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

  test('quem cria (gerente ou atendente) já deixa o template aprovado; nome repetido, variável desconhecida e tamanho ruim são recusados @spec:AC-670', async () => {
    const r = await criar({ nome: '  Boas vindas ', corpo: 'Olá, {{primeiro_nome}}! Aqui é da clínica.' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ nome: 'Boas vindas', status: 'aprovado' });

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
    const doAtendente = await criar({ nome: 'Do atendente', corpo: 'x' }, atendente);
    expect(doAtendente.status).toBe(201);
    expect(await doAtendente.json()).toMatchObject({ nome: 'Do atendente', status: 'aprovado' });
    expect((await criar({ nome: 'Sem sessão', corpo: 'x' }, null)).status).toBe(401);
  });

  test('aprovar grava quem e quando; editar um aprovado não o tira de uso; arquivado não edita nem aprova; outra empresa é 404 @spec:AC-671', async () => {
    const { id } = await criado('Para aprovar');
    const aprovado = await (await alterar(id, { acao: 'aprovar' })).json();
    expect(aprovado).toMatchObject({ status: 'aprovado', aprovadoPorNome: expect.any(String) });
    expect(new Date(aprovado.aprovadoEm).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const editado = await (await alterar(id, { corpo: 'Texto novo para {{nome}}' })).json();
    expect(editado).toMatchObject({ status: 'aprovado', corpo: 'Texto novo para {{nome}}', aprovadoPorNome: expect.any(String) });
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

  test('o atendente edita o template que ele criou, mas não o de outra pessoa; aprovar e arquivar seguem só do gestor @spec:AC-671', async () => {
    const meu = await criado('Meu template', 'Oi, {{primeiro_nome}}!', atendente);
    const doGerente = await criado('Template do gerente');

    const editado = await alterar(meu.id, { nome: 'Meu template v2', corpo: 'Olá, {{primeiro_nome}}!' }, atendente);
    expect(editado.status).toBe(200);
    expect(await editado.json()).toMatchObject({ nome: 'Meu template v2', corpo: 'Olá, {{primeiro_nome}}!', status: 'aprovado' }); // segue em uso

    expect((await alterar(doGerente.id, { corpo: 'invadido' }, atendente)).status).toBe(403);
    expect((await alterar(meu.id, { acao: 'arquivar' }, atendente)).status).toBe(403);
    expect((await alterar(meu.id, { acao: 'aprovar' }, atendente)).status).toBe(403);
    expect((await alterar(meu.id, { corpo: 'Oi {{cidade}}' }, atendente)).status).toBe(400); // a validação vale igual
    expect((await alterar(meu.id, { corpo: 'x' }, gerenteB)).status).toBe(404);

    const doAtendente = await (await lista(atendente)).json();
    const porNome = (n: string) => doAtendente.templates.find((t: { nome: string }) => t.nome === n);
    expect(porNome('Meu template v2').podeEditar).toBe(true);
    expect(porNome('Template do gerente').podeEditar).toBe(false);
  });

  test('o gerente vê todos da empresa; o atendente só os não arquivados; ninguém vê os da outra @spec:AC-672', async () => {
    await criado('Lista do gerente');
    const ok = await criado('Lista aprovado');
    await alterar(ok.id, { acao: 'aprovar' });
    const arq = await criado('Lista arquivado');
    await alterar(arq.id, { acao: 'arquivar' });
    const doGerente = await (await lista()).json();
    expect(doGerente.podeGerir).toBe(true);
    const nomes = (corpo: { templates: Array<{ nome: string }> }) => corpo.templates.map((t) => t.nome);
    expect(nomes(doGerente)).toEqual(expect.arrayContaining(['Lista do gerente', 'Lista aprovado', 'Lista arquivado']));
    const doAtendente = await (await lista(atendente)).json();
    expect(doAtendente.podeGerir).toBe(false);
    expect(nomes(doAtendente)).toEqual(expect.arrayContaining(['Lista aprovado', 'Lista do gerente']));
        expect(nomes(doAtendente)).not.toContain('Lista arquivado');
    const daB = await (await lista(gerenteB)).json();
    expect(nomes(daB)).toEqual(['BOAS VINDAS']);
  });
});
