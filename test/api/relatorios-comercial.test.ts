// T-203 (fase4-analises, US-135): GET /api/relatorios/comercial — receita fechada,
// pipeline, ciclo, win rate, ranking e motivos de perda, contra um Postgres efêmero
// real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDeAtendente } from '../support/atendente';

const ANA = 'aeaeaeae-2030-0000-0000-0000000000a1';
const BIA = 'aeaeaeae-2030-0000-0000-0000000000a2';
const MOTIVO_PRECO = 'aeaeaeae-2031-0000-0000-0000000000b1';
const ID = (n: number) => `aeaeaeae-2032-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-203: relatório comercial', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/relatorios/comercial/route');
  let cookieAtendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const evento = (card: string, etapa: number, quando = 'now()', empresa = amb.tenants.empresaA) =>
    sql(`INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo, ocorrido_em)
         VALUES ('${empresa}', '${card}', 'transicao_etapa', ${etapa}, 'sistema', ${quando})`);
  const get = (query = '', cookie: string | null = amb.cookieA) =>
    rota.GET(new NextRequest(`http://localhost/api/relatorios/comercial${query}`, { headers: cookie ? { Cookie: cookie } : {} }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB, leadA, leadB } = amb.tenants;
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f203.com', 'Ana Closer'), ('${BIA}', 'bia@f203.com', 'Bia Closer');
         INSERT INTO motivos_perda (id, nome) VALUES ('${MOTIVO_PRECO}', 'Preço');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, responsavel_id, valor, criado_em, motivo_perda_id, proxima_acao_em) VALUES
           ('${ID(1)}', '${empresaA}', '${leadA}', 15, '${ANA}', 1000, now() - interval '10 days', NULL, now() + interval '1 day'),
           ('${ID(2)}', '${empresaA}', '${leadA}', 15, '${ANA}', 3000, now() - interval '20 days', NULL, now() + interval '1 day'),
           ('${ID(3)}', '${empresaA}', '${leadA}', 14, '${BIA}', 800, now() - interval '5 days', '${MOTIVO_PRECO}', now() + interval '1 day'),
           ('${ID(4)}', '${empresaA}', '${leadA}', 2, '${BIA}', 500, now() - interval '5 days', NULL, now() + interval '1 day'),
           ('${ID(5)}', '${empresaA}', '${leadA}', 11, '${BIA}', 2000, now(), NULL, now() + interval '1 day'),
           ('${ID(6)}', '${empresaA}', '${leadA}', 13, '${ANA}', 4000, now(), NULL, now() + interval '1 day'),
           ('${ID(7)}', '${empresaA}', '${leadA}', 15, '${BIA}', 9999, now() - interval '200 days', NULL, now() + interval '1 day'),
           ('${ID(8)}', '${empresaB}', '${leadB}', 15, NULL, 7777, now() - interval '3 days', NULL, now() + interval '1 day');`);
    for (const etapa of [10, 11, 15]) evento(ID(1), etapa);
    for (const etapa of [10, 11, 15]) evento(ID(2), etapa);
    for (const etapa of [10, 14]) evento(ID(3), etapa);
    evento(ID(4), 14);
    evento(ID(5), 11);
    evento(ID(7), 15, "now() - interval '150 days'");
    evento(ID(8), 15, 'now()', empresaB);
    cookieAtendente = await cookieDeAtendente(amb, 'atendente.f203@teste.com');
    rota = await import('../../src/app/api/relatorios/comercial/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('o resumo traz MRR, ticket, pipeline, ciclo e win rate do período, só da empresa @spec:AC-569', async () => {
    const r = await get('?de=2026-01-01&ate=2099-12-31');
    // período longo demais é recusado; usa os últimos 366 dias
    expect(r.status).toBe(400);

    const hoje = new Date();
    const de = new Date(hoje.getTime() - 100 * 86_400_000).toISOString().slice(0, 10);
    const ate = new Date(hoje.getTime() + 86_400_000).toISOString().slice(0, 10);
    const corpo = await (await get(`?de=${de}&ate=${ate}`)).json();
    expect(corpo.resumo.mrrNovo).toBe(4000);
    expect(corpo.resumo.contratos).toBe(2);
    expect(corpo.resumo.ticketMedio).toBe(2000);
    expect(corpo.resumo.pipelineEmNegociacao).toEqual({ valor: 6000, propostas: 2, ponderado: 3000 });
    expect(corpo.resumo.cicloMedioDias).toBe(15);
    expect(corpo.resumo.winRate).toEqual({ valor: 0.5, ganhos: 2, perdas: 2 });
    expect(corpo.totalPerdas).toBe(2);
  });

  test('a evolução semanal, o ranking e os motivos de perda saem do histórico do período @spec:AC-569', async () => {
    const hoje = new Date();
    const de = new Date(hoje.getTime() - 20 * 86_400_000).toISOString().slice(0, 10);
    const ate = new Date(hoje.getTime() + 86_400_000).toISOString().slice(0, 10);
    const corpo = await (await get(`?de=${de}&ate=${ate}`)).json();

    expect(corpo.semanal.reduce((s: number, i: { valorFechado: number }) => s + i.valorFechado, 0)).toBe(4000);
    expect(corpo.semanal.reduce((s: number, i: { pipelineCriado: number }) => s + i.pipelineCriado, 0)).toBe(6000);
    expect(corpo.semanal.length).toBeGreaterThanOrEqual(3);

    expect(corpo.ranking[0]).toMatchObject({ responsavelId: ANA, nome: 'Ana Closer', reunioesRealizadas: 2, propostas: 2, contratos: 2, perdas: 0, winRate: 1, cicloMedioDias: 15, ticketMedio: 2000, valorFechado: 4000 });
    const bia = corpo.ranking.find((l: { responsavelId: string }) => l.responsavelId === BIA);
    expect(bia).toMatchObject({ nome: 'Bia Closer', reunioesRealizadas: 1, propostas: 1, contratos: 0, perdas: 2, winRate: 0, cicloMedioDias: null, ticketMedio: null, valorFechado: 0 });

    expect(corpo.motivosPerda).toEqual([
      { motivo: 'Preço', quantidade: 1, percentual: 50 },
      { motivo: 'Sem motivo informado', quantidade: 1, percentual: 50 },
    ]);

    const soBia = await (await get(`?de=${de}&ate=${ate}&responsavelId=${BIA}`)).json();
    expect(soBia.resumo.contratos).toBe(0);
    expect(soBia.ranking).toHaveLength(1);

    const vazio = await (await get('?de=2000-01-01&ate=2000-01-31')).json();
    expect(vazio.resumo).toMatchObject({ mrrNovo: 0, contratos: 0, ticketMedio: null, cicloMedioDias: null, winRate: { valor: null, ganhos: 0, perdas: 0 } });
    expect(vazio.ranking).toEqual([]);
    expect(vazio.motivosPerda).toEqual([]);

    const daB = await (await get(`?de=${de}&ate=${ate}`, amb.cookieB)).json();
    expect(daB.resumo.mrrNovo).toBe(7777);
    expect(daB.resumo.contratos).toBe(1);
  });

  test('parâmetro inválido é 400, sem sessão é 401 e atendente é 403 @spec:AC-569', async () => {
    expect((await get('?de=abc')).status).toBe(400);
    expect((await get('?responsavelId=x')).status).toBe(400);
    expect((await get('', null)).status).toBe(401);
    expect((await get('', cookieAtendente)).status).toBe(403);
  });
});
