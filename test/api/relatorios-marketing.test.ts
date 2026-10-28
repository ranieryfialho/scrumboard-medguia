// T-202 (fase4-analises, US-134): GET /api/relatorios/marketing — leads por origem,
// série e conversão, contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDeAtendente } from '../support/atendente';
import { agrupamentoPadrao, intervalos } from '../../src/repositories/analises-marketing';

const ID = (n: number) => `adadadad-2020-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-202: relatório de marketing', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/relatorios/marketing/route');
  let cookieAtendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const evento = (card: string, tipo: string, etapa: number | null = null, payload = '{}', empresa = amb.tenants.empresaA) =>
    sql(`INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo, payload)
         VALUES ('${empresa}', '${card}', '${tipo}', ${etapa ?? 'NULL'}, 'sistema', '${payload}'::jsonb)`);
  const get = (query = '', cookie: string | null = amb.cookieA) =>
    rota.GET(new NextRequest(`http://localhost/api/relatorios/marketing${query}`, { headers: cookie ? { Cookie: cookie } : {} }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    const lead = (n: number, origem: string | null, empresa = empresaA, criado = 'now()') =>
      `('${ID(n)}', '${empresa}', 'Lead ${n}', ${origem === null ? 'NULL' : `'${origem}'`}, ${criado})`;
    sql(`INSERT INTO leads (id, empresa_id, nome, origem, criado_em) VALUES
           ${lead(1, 'Google Ads')}, ${lead(2, 'Google Ads')}, ${lead(3, 'Indicação')}, ${lead(4, null)},
           ${lead(5, 'Google Ads', empresaA, "now() - interval '90 days'")}, ${lead(6, 'Meta Ads', empresaB)};
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, valor) VALUES
           ('${ID(11)}', '${empresaA}', '${ID(1)}', 15, 1000), ('${ID(12)}', '${empresaA}', '${ID(2)}', 8, 500),
           ('${ID(13)}', '${empresaA}', '${ID(3)}', 2, NULL), ('${ID(15)}', '${empresaA}', '${ID(5)}', 15, 9000),
           ('${ID(16)}', '${empresaB}', '${ID(6)}', 15, 7000);`);
    evento(ID(11), 'atividade_concluida', null, '{"resultado":"conectou"}');
    for (const etapa of [8, 10, 15]) evento(ID(11), 'transicao_etapa', etapa);
    evento(ID(12), 'transicao_etapa', 8);
    evento(ID(13), 'atividade_concluida', null, '{"resultado":"conectou"}');
    evento(ID(15), 'transicao_etapa', 15);
    evento(ID(16), 'transicao_etapa', 15, '{}', empresaB);
    cookieAtendente = await cookieDeAtendente(amb, 'atendente.f202@teste.com');
    rota = await import('../../src/app/api/relatorios/marketing/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('devolve o resumo, a série e o desempenho por origem do período, só da empresa @spec:AC-563', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.resumo).toEqual({ leads: 5, conectados: 2, reunioesRealizadas: 1, contratos: 1, conversaoFinal: 0.2 });
    expect(corpo.porOrigem).toEqual([
      { origem: 'Google Ads', leads: 2, conectados: 1, reunioesRealizadas: 1, contratos: 1, conversaoFinal: 0.5, valorGanho: 1000 },
      { origem: 'Sem origem', leads: 2, conectados: 0, reunioesRealizadas: 0, contratos: 0, conversaoFinal: 0, valorGanho: 0 },
      { origem: 'Indicação', leads: 1, conectados: 1, reunioesRealizadas: 0, contratos: 0, conversaoFinal: 0, valorGanho: 0 },
    ]);
    expect(corpo.origens).toEqual(['Google Ads', 'Indicação', 'Sem origem']);

    // série por dia do mês corrente, sem pular dias
    const hoje = new Date();
    const diasDoMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0)).getUTCDate();
    expect(corpo.agrupar).toBe('dia');
    expect(corpo.serie).toHaveLength(diasDoMes);
    expect(corpo.serie.reduce((s: number, i: { leads: number }) => s + i.leads, 0)).toBe(5);
    expect(corpo.serie.reduce((s: number, i: { reunioes: number }) => s + i.reunioes, 0)).toBe(2);

    const soGoogle = await (await get('?origem=Google%20Ads')).json();
    expect(soGoogle.resumo.leads).toBe(2);
    expect(soGoogle.porOrigem).toHaveLength(1);
    const porMes = await (await get('?agrupar=mes')).json();
    expect(porMes.serie).toHaveLength(1);
    expect(porMes.serie[0].leads).toBe(5);
    const porSemana = await (await get('?agrupar=semana')).json();
    expect(porSemana.serie.length).toBeGreaterThanOrEqual(4);
    expect(porSemana.serie.reduce((s: number, i: { leads: number }) => s + i.leads, 0)).toBe(5);

    const antigo = await (await get('?de=2000-01-01&ate=2000-01-31')).json();
    expect(antigo.resumo).toEqual({ leads: 0, conectados: 0, reunioesRealizadas: 0, contratos: 0, conversaoFinal: null });
    expect(antigo.porOrigem).toEqual([]);

    const daB = await (await get('', amb.cookieB)).json();
    expect(daB.porOrigem.map((o: { origem: string }) => o.origem)).toEqual(['Meta Ads', 'Sem origem']);
  });

  test('o agrupamento padrão e os intervalos não pulam nenhum dia, semana ou mês @spec:AC-563', () => {
    expect(agrupamentoPadrao('2026-10-01', '2026-10-31')).toBe('dia');
    expect(agrupamentoPadrao('2026-07-01', '2026-10-15')).toBe('semana');
    expect(agrupamentoPadrao('2026-01-01', '2026-12-31')).toBe('mes');
    expect(intervalos('2026-10-29', '2026-11-02', 'dia')).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(intervalos('2026-10-28', '2026-11-10', 'semana')).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(intervalos('2026-10-15', '2026-12-20', 'mes')).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
  });

  test('parâmetro inválido é 400, sem sessão é 401 e atendente é 403 @spec:AC-563', async () => {
    expect((await get('?agrupar=ano')).status).toBe(400);
    expect((await get('?de=2026-02-30')).status).toBe(400);
    expect((await get('', null)).status).toBe(401);
    expect((await get('', cookieAtendente)).status).toBe(403);
  });
});
