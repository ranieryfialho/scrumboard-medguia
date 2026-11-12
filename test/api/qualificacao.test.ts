// fase6-qualificacao-comercial (US-198, AC-831) e funil/lista (US-199, AC-834/AC-835): a qualificação do card contra um Postgres efêmero
// real com dois tenants (mesmo harness de test/api/dados-comerciais.test.ts).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { listarLista } from '../../src/repositories/pipeline-lista';
import { lerResumosDeQualificacao } from '../../src/repositories/qualificacao';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const CARD_2 = 'eeeeeeee-0f6a-0000-0000-000000000002';
const CARD_3 = 'eeeeeeee-0f6a-0000-0000-000000000003';

describe('fase6-qualificacao-comercial: API e consultas', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/oportunidades/[id]/qualificacao/route');
  let atendente: string;
  let gerenteB: string;

  const req = (id: string, cookie: string | null, metodo: 'GET' | 'PUT', corpo?: unknown) =>
    new NextRequest(`http://localhost/api/oportunidades/${id}/qualificacao`, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  const ler = (id: string, cookie: string | null = atendente) => rota.GET(req(id, cookie, 'GET'), { params: Promise.resolve({ id }) });
  const gravar = (id: string, corpo: unknown, cookie: string | null = atendente) => rota.PUT(req(id, cookie, 'PUT', corpo), { params: Promise.resolve({ id }) });
  const cardA = () => amb.tenants.oportunidadeA;
  const contextoA = (): ContextoTenant => ({ usuarioId: 'aaaaaaaa-0000-0000-0000-000000000001', empresaId: amb.tenants.empresaA, papel: 'GERENTE', isSuperAdmin: false });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: CARD_2, etapaId: 1 },
      { id: CARD_3, etapaId: 1 },
    ]);
    atendente = await cookieDePapel(amb, 'atendente.qualif@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.qualif@teste.com', 'GERENTE', amb.tenants.empresaB);
    rota = await import('../../src/app/api/oportunidades/[id]/qualificacao/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('card nunca avaliado devolve tudo vazio e faixa nula; sem sessão é 401 @spec:AC-831', async () => {
    expect((await ler(cardA(), null)).status).toBe(401);
    const r = await ler(cardA());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ faixa: null, score: 0, estagio: null, bloqueios: [], avaliadoPor: null, atualizadoEm: null });
  });

  test('o servidor calcula nota e faixa, ignora os valores enviados, guarda quem avaliou e devolve na leitura @spec:AC-831', async () => {
    const corpo = { respostas: { dor: 25, complexidade: 20, decisao: 15, gatilho: 10, abertura: 10, aderencia: 5 }, bloqueios: [], estagio: 'residente', score: 1, faixa: 'baixo' };
    const r = await gravar(cardA(), corpo);
    expect(r.status).toBe(200);
    const salvo = await r.json();
    expect(salvo).toMatchObject({ score: 85, faixa: 'A', estagio: 'residente', respostas: { dor: 25, aderencia: 5 } });
    expect(salvo.avaliadoPor).toBeTruthy();
    expect(salvo.atualizadoEm).toBeTruthy();

    // regravar substitui (uma linha por card) e o eliminatório prevalece
    const de_novo = await (await gravar(cardA(), { respostas: { dor: 25 }, bloqueios: ['decisor'] })).json();
    expect(de_novo).toMatchObject({ score: 25, faixa: 'revisao', bloqueios: ['decisor'] });
    expect(de_novo.respostas.complexidade).toBeNull();
    expect((await (await ler(cardA())).json()).faixa).toBe('revisao');
  });

  test('pontuação ou eliminatório desconhecidos dão 400 QUALIFICACAO_INVALIDA e nada é gravado @spec:AC-831', async () => {
    const antes = await (await ler(CARD_2)).json();
    const ruim = await gravar(CARD_2, { respostas: { dor: 7 } });
    expect(ruim.status).toBe(400);
    expect(await ruim.json()).toEqual({ codigo: 'QUALIFICACAO_INVALIDA', campo: 'dor' });
    expect((await gravar(CARD_2, { bloqueios: ['x'] })).status).toBe(400);
    expect(await (await ler(CARD_2)).json()).toEqual(antes);
  });

  test('card de outra empresa é 404 na leitura e na gravação, e a outra empresa não enxerga a avaliação @spec:AC-831', async () => {
    expect((await ler(cardA(), gerenteB)).status).toBe(404);
    expect((await gravar(cardA(), { respostas: { dor: 25 } }, gerenteB)).status).toBe(404);
    expect((await ler(amb.tenants.oportunidadeB, gerenteB)).status).toBe(200);
    expect((await ler(amb.tenants.oportunidadeB, atendente)).status).toBe(404);
  });

  test('o funil traz a faixa e a nota só dos cards avaliados @spec:AC-834', async () => {
    await gravar(CARD_2, { respostas: { dor: 25, complexidade: 20, decisao: 15, gatilho: 15, abertura: 15, aderencia: 10 } });
    await gravar(CARD_3, { respostas: { dor: 0 } });
    const mapa = await lerResumosDeQualificacao(amb.db, contextoA(), [cardA(), CARD_2, CARD_3]);
    expect(mapa.get(CARD_2)).toEqual({ faixa: 'A', score: 100 });
    expect(mapa.get(CARD_3)).toEqual({ faixa: 'baixo', score: 0 });
    expect(mapa.get(cardA())).toEqual({ faixa: 'revisao', score: 25 });
    expect((await lerResumosDeQualificacao(amb.db, contextoA(), [amb.tenants.oportunidadeB])).size).toBe(0); // outra empresa
  });

  test('a lista mostra a qualificação e filtra por faixa e por "nenhuma", sem misturar empresas @spec:AC-835', async () => {
    amb.pg.psqlComo('crm_migrator', `DELETE FROM oportunidade_qualificacao WHERE oportunidade_id = '${CARD_3}'`);
    const ids = async (qualificacao?: 'A' | 'revisao' | 'nenhuma') => (await listarLista(amb.db, contextoA(), { qualificacao })).itens.map((i) => i.id).sort();

    expect(await ids()).toEqual([cardA(), CARD_2, CARD_3].sort());
    expect(await ids('A')).toEqual([CARD_2]);
    expect(await ids('revisao')).toEqual([cardA()]);
    expect(await ids('nenhuma')).toEqual([CARD_3]);

    const pagina = await listarLista(amb.db, contextoA(), { qualificacao: 'A' });
    expect(pagina.total).toBe(1);
    expect(pagina.itens[0].qualificacao).toEqual({ faixa: 'A', score: 100 });
    expect((await listarLista(amb.db, contextoA(), { qualificacao: 'nenhuma' })).itens[0].qualificacao).toBeNull();
  });
});
