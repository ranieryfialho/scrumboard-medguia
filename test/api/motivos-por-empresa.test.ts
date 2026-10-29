// T-244 (fase5-motivos-por-empresa): motivos de perda por empresa — administração, lista de escolha e
// guards da perda e do arquivamento em lote, contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ID = (n: number) => `b2b2b2b2-6600-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const SIS = ID(1); // global sistêmico
const REDE = ID(2); // global não sistêmico
const A_ATIVO = ID(3); // da empresa A
const A_INATIVO = ID(4); // da empresa A, inativo
const B_ATIVO = ID(5); // da empresa B
const CARD_AVULSO = ID(11); // empresa A, etapa 5
const CARD_LOTE = ID(12); // empresa A, etapa 5
const CARD_LOTE_OK = ID(13);

describe('T-244: motivos de perda por empresa', () => {
  let amb: AmbienteAnexos;
  let rotaAdmin: typeof import('../../src/app/api/configuracoes/motivos-perda/route');
  let rotaAdminId: typeof import('../../src/app/api/configuracoes/motivos-perda/[id]/route');
  let rotaEscolha: typeof import('../../src/app/api/motivos-perda/route');
  let rotaTransicao: typeof import('../../src/app/api/oportunidades/[id]/transicao/route');
  let rotaArquivar: typeof import('../../src/app/api/oportunidades/lote/arquivar/route');
  let gerente: string;
  let gerenteB: string;
  let atendente: string;
  let superAdmin: string;

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
  const lista = (cookie = gerente) => rotaAdmin.GET(req('/api/configuracoes/motivos-perda', cookie));
  const criar = (nome: unknown, cookie: string | null = gerente) => rotaAdmin.POST(req('/api/configuracoes/motivos-perda', cookie, 'POST', { nome }));
  const alterar = (id: string, ativo: boolean, cookie: string | null = gerente) =>
    rotaAdminId.PATCH(req(`/api/configuracoes/motivos-perda/${id}`, cookie, 'PATCH', { ativo }), { params: Promise.resolve({ id }) });
  const escolha = (cookie = gerente) => rotaEscolha.GET(req('/api/motivos-perda', cookie));
  const nomes = async (r: Response) => ((await r.json()).itens as Array<{ nome: string }>).map((i) => i.nome);
  const etapaDe = (card: string) => Number(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: CARD_AVULSO, etapaId: 5 },
      { id: CARD_LOTE, etapaId: 5 },
      { id: CARD_LOTE_OK, etapaId: 5 },
    ]);
    const { empresaA, empresaB } = amb.tenants;
    gerente = await cookieDePapel(amb, 'gerente.f660@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f660@teste.com', 'GERENTE', empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f660@teste.com', 'ATENDENTE');
    superAdmin = await cookieDePapel(amb, 'super.f660@teste.com', 'GERENTE');
    sql(`UPDATE usuarios SET is_super_admin = true WHERE email = 'super.f660@teste.com'`);
    sql(`INSERT INTO motivos_perda (id, nome, ativo, e_sistemico, empresa_id) VALUES
           ('${SIS}', 'Zz Sistêmico f660', true, true, NULL), ('${REDE}', 'Zz Da rede f660', true, false, NULL),
           ('${A_ATIVO}', 'Zz Da A ativo f660', true, false, '${empresaA}'), ('${A_INATIVO}', 'Zz Da A inativo f660', false, false, '${empresaA}'),
           ('${B_ATIVO}', 'Zz Da B ativo f660', true, false, '${empresaB}');`);
    rotaAdmin = await import('../../src/app/api/configuracoes/motivos-perda/route');
    rotaAdminId = await import('../../src/app/api/configuracoes/motivos-perda/[id]/route');
    rotaEscolha = await import('../../src/app/api/motivos-perda/route');
    rotaTransicao = await import('../../src/app/api/oportunidades/[id]/transicao/route');
    rotaArquivar = await import('../../src/app/api/oportunidades/lote/arquivar/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('o gerente cria motivo da empresa (ativo, da A, invisível para a B); o atendente não cria @spec:AC-660', async () => {
    const r = await criar('  Sem orçamento este ano  ');
    expect(r.status).toBe(201);
    const novo = await r.json();
    expect(novo).toMatchObject({ nome: 'Sem orçamento este ano', ativo: true, sistemico: false, escopo: 'empresa' });
    expect(sql(`SELECT empresa_id FROM motivos_perda WHERE id = '${novo.id}'`)).toBe(amb.tenants.empresaA);
    const daB = await (await lista(gerenteB)).json();
    expect(daB.motivos.map((m: { nome: string }) => m.nome)).not.toContain('Sem orçamento este ano');
    expect((await criar('Outro motivo', atendente)).status).toBe(403);
    expect((await criar('Outro motivo', null)).status).toBe(401);
    expect((await criar('ab')).status).toBe(400);
  });

  test('nome repetido (global ou da própria empresa) dá 409; outra empresa pode repetir o da A @spec:AC-661', async () => {
    for (const nome of ['zz da rede F660 ', 'ZZ DA A ATIVO F660', 'sem orçamento ESTE ano']) {
      const r = await criar(nome);
      expect(r.status, nome).toBe(409);
      expect((await r.json()).codigo).toBe('MOTIVO_JA_EXISTE');
    }
    expect((await criar('Zz Da A ativo f660', gerenteB)).status).toBe(201);
  });

  test('o gerente altera só o da própria empresa; global dá MOTIVO_DA_REDE, sistêmico MOTIVO_SISTEMICO, o de outra empresa é 404 @spec:AC-662', async () => {
    expect(await (await alterar(A_ATIVO, false)).json()).toMatchObject({ ativo: false, escopo: 'empresa' });
    expect(sql(`SELECT ativo::text FROM motivos_perda WHERE id = '${A_ATIVO}'`)).toBe('false');
    expect((await alterar(A_ATIVO, true)).status).toBe(200);
    const rede = await alterar(REDE, false);
    expect(rede.status).toBe(422);
    expect((await rede.json()).codigo).toBe('MOTIVO_DA_REDE');
    const sis = await alterar(SIS, false);
    expect(sis.status).toBe(422);
    expect((await sis.json()).codigo).toBe('MOTIVO_SISTEMICO');
    expect((await alterar(B_ATIVO, false)).status).toBe(404);
    expect(sql(`SELECT ativo::text FROM motivos_perda WHERE id = '${B_ATIVO}'`)).toBe('true');
    expect((await alterar(A_ATIVO, false, atendente)).status).toBe(403);
    // o super admin ainda altera o global não sistêmico
    expect((await alterar(REDE, false, superAdmin)).status).toBe(200);
    expect((await alterar(REDE, true, superAdmin)).status).toBe(200);
  });

  test('a lista da administração mostra globais e da empresa com o escopo, nunca os da outra empresa @spec:AC-663', async () => {
    const corpo = await (await lista()).json();
    const por = Object.fromEntries(corpo.motivos.map((m: { id: string }) => [m.id, m]));
    expect(por[SIS]).toMatchObject({ escopo: 'sistemico', podeEditar: false });
    expect(por[REDE]).toMatchObject({ escopo: 'rede', podeEditar: false });
    expect(por[A_ATIVO]).toMatchObject({ escopo: 'empresa', podeEditar: true });
    expect(por[A_INATIVO]).toMatchObject({ escopo: 'empresa', ativo: false });
    expect(por[B_ATIVO]).toBeUndefined();
    const doSuper = await (await lista(superAdmin)).json();
    expect(doSuper.motivos.find((m: { id: string }) => m.id === REDE).podeEditar).toBe(true);
    const daB = await (await lista(gerenteB)).json();
    expect(daB.motivos.find((m: { id: string }) => m.id === B_ATIVO)).toMatchObject({ escopo: 'empresa', podeEditar: true });
    expect(daB.motivos.find((m: { id: string }) => m.id === A_ATIVO)).toBeUndefined();
  });

  test('a lista de escolha traz globais ativos e ativos da empresa, em ordem, sem os da outra e sem inativos @spec:AC-664', async () => {
    const daA = await nomes(await escolha());
    expect(daA).toContain('Zz Sistêmico f660');
    expect(daA).toContain('Zz Da rede f660');
    expect(daA).toContain('Zz Da A ativo f660');
    expect(daA).not.toContain('Zz Da A inativo f660');
    expect(daA).not.toContain('Zz Da B ativo f660');
    expect(daA.filter((n) => n.startsWith('Zz '))).toEqual(['Zz Da A ativo f660', 'Zz Da rede f660', 'Zz Sistêmico f660']); // ordem alfabética
    const idsDaB = ((await (await escolha(gerenteB)).json()).itens as Array<{ id: string }>).map((i) => i.id);
    expect(idsDaB).toContain(B_ATIVO);
    expect(idsDaB).toContain(REDE);
    expect(idsDaB).not.toContain(A_ATIVO); // a B tem um motivo de mesmo nome (AC-661), mas não o da A
    expect((await escolha(atendente)).status).toBe(200);
  });

  test('motivo de outra empresa é recusado na perda avulsa e no arquivamento em lote; global e da própria passam @spec:AC-665', async () => {
    const versao = Number(sql(`SELECT version FROM oportunidades WHERE id = '${CARD_AVULSO}'`));
    const avulsa = (motivoPerdaId: string) =>
      rotaTransicao.POST(req(`/api/oportunidades/${CARD_AVULSO}/transicao`, gerente, 'POST', { version: Number(sql(`SELECT version FROM oportunidades WHERE id = '${CARD_AVULSO}'`)), etapaDestinoId: 14, motivoPerdaId }), {
        params: Promise.resolve({ id: CARD_AVULSO }),
      });
    void versao;
    const recusada = await avulsa(B_ATIVO);
    expect(recusada.status).toBe(400);
    expect((await recusada.json()).codigo).toBe('MOTIVO_INVALIDO');
    expect(etapaDe(CARD_AVULSO)).toBe(5);
    expect((await avulsa(A_ATIVO)).status).toBe(200);
    expect(etapaDe(CARD_AVULSO)).toBe(14);

    const lote = (motivoPerdaId: string, ids: string[]) => rotaArquivar.POST(req('/api/oportunidades/lote/arquivar', gerente, 'POST', { ids, motivoPerdaId }));
    const loteRecusado = await lote(B_ATIVO, [CARD_LOTE]);
    expect(loteRecusado.status).toBe(400);
    expect((await loteRecusado.json()).codigo).toBe('MOTIVO_INVALIDO');
    expect(etapaDe(CARD_LOTE)).toBe(5);
    const loteOk = await lote(REDE, [CARD_LOTE, CARD_LOTE_OK]);
    expect(loteOk.status).toBe(200);
    expect(etapaDe(CARD_LOTE)).toBe(14);
  });
});
