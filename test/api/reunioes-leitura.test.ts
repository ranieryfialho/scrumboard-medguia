// T-184 (fase4-tarefas-agenda, US-121): GET /api/reunioes e /api/reunioes/resumo
// contra um Postgres efêmero real com dois tenants (test/support/api-anexos.ts).
// O relógio é fixado em quinta-feira, 11/06/2026, 11h em São Paulo (14h UTC).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { statusDaReuniao } from '../../src/lib/reunioes/status';

const ANA = 'dddddddd-1840-0000-0000-0000000000a1';
const BIA = 'dddddddd-1840-0000-0000-0000000000a2';
const C1 = 'dddddddd-1841-0000-0000-000000000001'; // etapa 8, Ana, R$ 1000
const C2 = 'dddddddd-1841-0000-0000-000000000002'; // etapa 8, Bia, R$ 500
const C3 = 'dddddddd-1841-0000-0000-000000000003'; // etapa 9, Bia
const R = (n: number) => `dddddddd-1842-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-184: leitura das reuniões e indicadores da agenda', () => {
  let amb: AmbienteAnexos;
  let lista: typeof import('../../src/app/api/reunioes/route');
  let resumo: typeof import('../../src/app/api/reunioes/resumo/route');

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  function reuniao(n: number, cardId: string, quando: string, extra = '', empresa = amb.tenants.empresaA) {
    const [colunas, valores] = extra ? [`, ${extra.split('=')[0]}`, `, ${extra.split('=')[1]}`] : ['', ''];
    sql(`INSERT INTO reunioes (id, oportunidade_id, empresa_id, agendada_para${colunas}) VALUES ('${R(n)}', '${cardId}', '${empresa}', '${quando}'${valores})`);
  }
  function get(cookie: string | null, query: string) {
    return lista.GET(new NextRequest(`http://localhost/api/reunioes?${query}`, { headers: cookie ? { Cookie: cookie } : {} }));
  }
  const SEMANA = 'de=2026-06-08&ate=2026-06-14';

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: C1, etapaId: 8 },
      { id: C2, etapaId: 8 },
      { id: C3, etapaId: 9 },
    ]);
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f184.com', 'Ana'), ('${BIA}', 'bia@f184.com', 'Bia');
         UPDATE oportunidades SET responsavel_id = '${ANA}', valor = 1000 WHERE id = '${C1}';
         UPDATE oportunidades SET responsavel_id = '${BIA}', valor = 500 WHERE id = '${C2}';
         UPDATE oportunidades SET responsavel_id = '${BIA}' WHERE id = '${C3}';`);
    reuniao(1, C1, '2026-06-11T15:00:00Z'); // hoje, por vir
    reuniao(2, C2, '2026-06-11T13:30:00Z'); // hoje, em andamento
    reuniao(3, C2, '2026-06-11T11:00:00Z'); // hoje, passou sem resultado
    reuniao(4, C1, '2026-06-09T13:00:00Z', `encerrada_em='2026-06-09T14:00:00Z'`); // realizada
    reuniao(5, C3, '2026-06-10T13:00:00Z', 'no_show=true'); // no-show, card segue em "No-show"
    reuniao(6, C3, '2026-06-08T13:00:00Z', 'no_show=true'); // no-show antigo, já remarcado
    reuniao(7, C3, '2026-06-12T13:00:00Z', `remarcada_de='${R(6)}'`);
    reuniao(8, amb.tenants.oportunidadeB, '2026-06-11T15:00:00Z', '', amb.tenants.empresaB);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-11T14:00:00Z'));
    lista = await import('../../src/app/api/reunioes/route');
    resumo = await import('../../src/app/api/reunioes/resumo/route');
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await amb?.parar();
  });

  test('lista só as reuniões da empresa da sessão no período, com lead, valor, etapa e closer @spec:AC-481', async () => {
    const r = await get(amb.cookieA, SEMANA);
    expect(r.status).toBe(200);
    const { reunioes } = await r.json();
    expect(reunioes.map((x: { id: string }) => x.id)).toEqual([R(6), R(4), R(5), R(3), R(2), R(1), R(7)]);
    const primeira = reunioes.find((x: { id: string }) => x.id === R(1));
    expect(primeira).toMatchObject({ valor: '1000.00', etapaId: 8, closer: { id: ANA, nome: 'Ana' }, lead: { nome: 'Lead da Empresa A' } });

    // só o dia de hoje; dia do outro lado do fuso não vaza (23h de SP ainda é o mesmo dia)
    const hoje = await (await get(amb.cookieA, 'de=2026-06-11&ate=2026-06-11')).json();
    expect(hoje.reunioes).toHaveLength(3);

    const doCloser = await (await get(amb.cookieA, `${SEMANA}&closerId=${BIA}`)).json();
    expect(doCloser.reunioes.every((x: { closer: { id: string } }) => x.closer.id === BIA)).toBe(true);
    expect(doCloser.reunioes).toHaveLength(5);

    expect((await get(amb.cookieA, 'de=2026-06-08')).status).toBe(400);
    expect((await get(amb.cookieA, 'de=2026-06-08&ate=2026-06-07')).status).toBe(400);
    expect((await get(amb.cookieA, 'de=2026-01-01&ate=2026-06-14')).status).toBe(400);
    expect((await get(amb.cookieA, `${SEMANA}&closerId=nao-uuid`)).status).toBe(400);
    expect((await get(null, SEMANA)).status).toBe(401);
    expect((await resumo.GET(new NextRequest('http://localhost/api/reunioes/resumo'))).status).toBe(401);

    const daB = await (await get(amb.cookieB, SEMANA)).json();
    expect(daB.reunioes.map((x: { id: string }) => x.id)).toEqual([R(8)]);
  });

  test('o status é derivado dos dados e o filtro por status devolve só o pedido @spec:AC-482', async () => {
    const { reunioes } = await (await get(amb.cookieA, SEMANA)).json();
    const status = Object.fromEntries(reunioes.map((x: { id: string; status: string }) => [x.id, x.status]));
    expect(status).toEqual({
      [R(1)]: 'agendada',
      [R(2)]: 'em_andamento',
      [R(3)]: 'aguardando_resultado',
      [R(4)]: 'realizada',
      [R(5)]: 'no_show',
      [R(6)]: 'remarcada',
      [R(7)]: 'agendada',
    });
    const soNoShow = await (await get(amb.cookieA, `${SEMANA}&status=no_show`)).json();
    expect(soNoShow.reunioes.map((x: { id: string }) => x.id)).toEqual([R(5)]);
    expect((await get(amb.cookieA, `${SEMANA}&status=inventado`)).status).toBe(400);

    // regra pura: 59 min depois do horário ainda é "em andamento", 61 min já aguarda resultado
    const base = { encerradaEm: null, noShow: false, temRemarcacao: false };
    const inicio = new Date('2026-06-11T14:00:00Z');
    expect(statusDaReuniao({ ...base, agendadaPara: inicio }, new Date('2026-06-11T14:59:00Z'))).toBe('em_andamento');
    expect(statusDaReuniao({ ...base, agendadaPara: inicio }, new Date('2026-06-11T15:01:00Z'))).toBe('aguardando_resultado');
  });

  test('os indicadores da semana vêm dos dados: hoje, presença, no-show e pipeline em demonstração @spec:AC-483', async () => {
    const r = await resumo.GET(new NextRequest('http://localhost/api/reunioes/resumo', { headers: { Cookie: amb.cookieA } }));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.hoje).toEqual({ total: 3, emAndamentoOuPorVir: 2 });
    expect(corpo.presenca).toEqual({ taxa: 33, realizadas: 1, noShows: 2 });
    expect(corpo.noShow).toEqual({ quantidade: 2, percentual: 67 });
    expect(corpo.pipelineEmDemonstracao).toEqual({ valor: 1500, contas: 2 });
  });

  test('o resgate de no-shows e o desempenho por closer vêm da semana @spec:AC-487', async () => {
    const corpo = await (await resumo.GET(new NextRequest('http://localhost/api/reunioes/resumo', { headers: { Cookie: amb.cookieA } }))).json();
    // R5 é a falta mais recente e não remarcada; R6 já foi remarcada
    expect(corpo.resgateDeNoShows).toHaveLength(1);
    expect(corpo.resgateDeNoShows[0]).toMatchObject({ reuniaoId: R(5), oportunidadeId: C3, closer: { id: BIA, nome: 'Bia' } });
    const porCloser = Object.fromEntries(corpo.desempenhoPorCloser.map((c: { closerId: string }) => [c.closerId, c]));
    expect(porCloser[ANA]).toMatchObject({ realizadas: 1, comResultado: 1, taxa: 100 });
    expect(porCloser[BIA]).toMatchObject({ realizadas: 0, comResultado: 2, taxa: 0 });
  });
});
