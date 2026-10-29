// T-239 (fase5-empresa-dados, US-153): razão social, CNPJ, endereço, plano e assentos da empresa,
// contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const CNPJ_A = '11222333000181';
const CNPJ_B = '45723174000110';

describe('T-239: dados da empresa', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/admin/empresas/route');
  let rotaId: typeof import('../../src/app/api/admin/empresas/[id]/route');
  let superAdmin: string;
  let master: string;

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
  const lista = (query = '') => rotaLista.GET(req(`/api/admin/empresas${query}`, superAdmin));
  const criar = (corpo: unknown) => rotaLista.POST(req('/api/admin/empresas', superAdmin, 'POST', corpo));
  const detalhe = (id: string) => rotaId.GET(req(`/api/admin/empresas/${id}`, superAdmin), { params: Promise.resolve({ id }) });
  const editar = (id: string, corpo: unknown, cookie: string | null = superAdmin) =>
    rotaId.PATCH(req(`/api/admin/empresas/${id}`, cookie, 'PATCH', corpo), { params: Promise.resolve({ id }) });
  const base = (n: number, extra: Record<string, unknown> = {}) => ({
    nome: `Clínica Dados ${n}`,
    slug: `clinica-dados-${n}`,
    masterNome: `Master ${n}`,
    masterEmail: `master${n}@dados.com`,
    razaoSocial: `Clínica Dados ${n} Ltda`,
    cnpj: CNPJ_A,
    plano: 'clinica',
    assentos: 5,
    ...extra,
  });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    superAdmin = await cookieDePapel(amb, 'super.f651@teste.com', 'GERENTE');
    sql(`UPDATE usuarios SET is_super_admin = true WHERE email = 'super.f651@teste.com'`);
    master = await cookieDePapel(amb, 'master.f651@teste.com', 'MASTER');
    rotaLista = await import('../../src/app/api/admin/empresas/route');
    rotaId = await import('../../src/app/api/admin/empresas/[id]/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('criar grava razão social, CNPJ só com dígitos, endereço normalizado, plano e assentos @spec:AC-651', async () => {
    const r = await criar(base(1, { cnpj: '11.222.333/0001-81', cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp' }));
    expect(r.status).toBe(201);
    const { id } = await r.json();
    expect(sql(`SELECT razao_social || '|' || cnpj || '|' || cep || '|' || logradouro || '|' || uf || '|' || plano || '|' || assentos FROM empresas WHERE id = '${id}'`)).toBe(
      `Clínica Dados 1 Ltda|${CNPJ_A}|01310100|Av. Paulista|SP|clinica|5`
    );
    const d = await (await detalhe(id)).json();
    expect(d.empresa).toMatchObject({ razaoSocial: 'Clínica Dados 1 Ltda', cnpj: CNPJ_A, cidade: 'São Paulo', plano: 'clinica', assentos: 5 });
    expect(d.assentosEmUso).toBe(1); // o master convidado
  });

  test('CNPJ inválido ou repetido, plano, assentos, UF e CEP inválidos são recusados sem criar nada @spec:AC-652', async () => {
    const antes = sql('SELECT count(*) FROM empresas');
    for (const [mudanca, campo] of [
      [{ cnpj: '11222333000182' }, 'cnpj'],
      [{ plano: 'premium' }, 'plano'],
      [{ assentos: 0 }, 'assentos'],
      [{ assentos: 10_000 }, 'assentos'],
      [{ cep: '123', logradouro: 'X', numero: '1', cidade: 'SP', uf: 'SP' }, 'cep'],
      [{ cep: '01310100', logradouro: 'X', numero: '1', cidade: 'SP', uf: 'XX' }, 'uf'],
      [{ razaoSocial: '' }, 'razaoSocial'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await criar(base(2, mudanca));
      expect(r.status, campo).toBe(400);
      expect((await r.json()).campo).toBe(campo);
    }
    const repetido = await criar(base(3)); // mesmo CNPJ da empresa criada no primeiro teste
    expect(repetido.status).toBe(409);
    expect((await repetido.json()).codigo).toBe('CNPJ_EM_USO');
    expect(sql('SELECT count(*) FROM empresas')).toBe(antes);
  });

  test('editar muda os dados, mantém o CNPJ único e não deixa os assentos abaixo do uso @spec:AC-653', async () => {
    const id = (await (await criar(base(4, { cnpj: CNPJ_B, assentos: 3 }))).json()).id;
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('b0b0b0b0-6530-0000-0000-000000000001', 'a@f653.com', 'A'), ('b0b0b0b0-6530-0000-0000-000000000002', 'b@f653.com', 'B');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel, ativo) VALUES
           ('${id}', 'b0b0b0b0-6530-0000-0000-000000000001', 'ATENDENTE', true), ('${id}', 'b0b0b0b0-6530-0000-0000-000000000002', 'ATENDENTE', true);`);
    // 3 em uso (master + 2): baixar para 2 é recusado, para 3 vale
    const abaixo = await editar(id, { assentos: 2 });
    expect(abaixo.status).toBe(409);
    expect((await abaixo.json()).codigo).toBe('ASSENTOS_ABAIXO_DO_EM_USO');
    expect((await editar(id, { assentos: 3 })).status).toBe(200);

    const ok = await editar(id, { razaoSocial: 'Nova Razão Ltda', plano: 'enterprise', cidade: 'Campinas', cep: '13010-000', logradouro: 'R. X', numero: '5', uf: 'SP' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ razaoSocial: 'Nova Razão Ltda', plano: 'enterprise', cep: '13010000', cidade: 'Campinas', assentos: 3 });

    const outraId = (await (await criar(base(5, { cnpj: '11444777000161' }))).json()).id;
    const uso = await editar(outraId, { cnpj: CNPJ_B });
    expect(uso.status).toBe(409);
    expect((await uso.json()).codigo).toBe('CNPJ_EM_USO');
    expect((await editar(id, { cnpj: CNPJ_B })).status).toBe(200); // o próprio CNPJ não conta como repetido
    expect((await editar(id, { cnpj: '123' })).status).toBe(400);
    expect((await editar(id, {}, master)).status).toBe(403);
    // limpar assentos tira o limite
    expect((await (await editar(id, { assentos: null })).json()).assentos).toBeNull();
  });

  test('detalhe e lista trazem os dados, com vazio nas empresas antigas; a lista mostra plano e assentos @spec:AC-654', async () => {
    const antiga = await (await detalhe(amb.tenants.empresaA)).json();
    expect(antiga.empresa).toMatchObject({ razaoSocial: null, cnpj: null, plano: null, assentos: null });
    const corpo = await (await lista('?busca=dados-1')).json();
    expect(corpo.empresas[0]).toMatchObject({ slug: 'clinica-dados-1', plano: 'clinica', assentos: 5, usuariosAtivos: 1 });
    const a = (await (await lista()).json()).empresas.find((e: { id: string }) => e.id === amb.tenants.empresaA);
    expect(a).toMatchObject({ plano: null, assentos: null });
  });
});
