// T-228 (fase5-investimento-midia, US-148): investimento, CPL, CAC e ROAS no relatório de marketing,
// contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

const ID = (n: number) => `adadadad-5151-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const MES_ATUAL = `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date`;

describe('T-228: custo no relatório de marketing', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/relatorios/marketing/route');

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const get = (query = '', cookie: string | null = amb.cookieA) =>
    rota.GET(new NextRequest(`http://localhost/api/relatorios/marketing${query}`, { headers: cookie ? { Cookie: cookie } : {} }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    sql(`INSERT INTO leads (id, empresa_id, nome, origem) VALUES
           ('${ID(1)}', '${empresaA}', 'L1', 'Meta Ads'), ('${ID(2)}', '${empresaA}', 'L2', 'meta ads'), ('${ID(3)}', '${empresaA}', 'L3', 'Meta Ads'),
           ('${ID(4)}', '${empresaA}', 'L4', 'Google Ads'), ('${ID(5)}', '${empresaB}', 'L5', 'Meta Ads');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, valor) VALUES ('${ID(11)}', '${empresaA}', '${ID(1)}', 15, 9000);
         INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo) VALUES ('${empresaA}', '${ID(11)}', 'transicao_etapa', 15, 'sistema');
         INSERT INTO investimento_midia (empresa_id, mes, canal, valor) VALUES
           ('${empresaA}', ${MES_ATUAL}, 'Meta Ads', 900), ('${empresaA}', ${MES_ATUAL}, 'TikTok Ads', 100),
           ('${empresaA}', '2025-10-01', 'Meta Ads', 3100);`);
    rota = await import('../../src/app/api/relatorios/marketing/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('com investimento no período aparecem investimento, CPL, CAC e ROAS sobre a coorte do período @spec:AC-634', async () => {
    const corpo = await (await get()).json();
    // 5 leads (os 4 criados aqui + 1 do ambiente), 1 contrato de R$ 9.000, investimento R$ 1.000
    expect(corpo.resumo.leads).toBe(5);
    expect(corpo.custo).toEqual({ investimento: 1000, cpl: 200, cac: 1000, roas: 9 });
  });

  test('o período parcial usa o rateio por dias e o filtro de origem restringe o canal @spec:AC-635', async () => {
    const parcial = await (await get('?de=2025-10-01&ate=2025-10-10')).json();
    expect(parcial.custo.investimento).toBe(1000); // 3.100 × 10/31
    const soMeta = await (await get('?origem=Meta%20Ads')).json();
    expect(soMeta.custo.investimento).toBe(900);
  });

  test('colunas por origem; canal com investimento e sem lead aparece com traço no CPL e no CAC @spec:AC-636', async () => {
    const { porOrigem } = await (await get()).json();
    const meta = porOrigem.find((l: { origem: string }) => l.origem === 'Meta Ads');
    expect(meta).toMatchObject({ investimento: 900, cpl: 300, cac: 900, roas: 10 });
    const tiktok = porOrigem.find((l: { origem: string }) => l.origem === 'TikTok Ads');
    expect(tiktok).toMatchObject({ leads: 0, investimento: 100, cpl: null, cac: null, roas: 0 });
    const google = porOrigem.find((l: { origem: string }) => l.origem === 'Google Ads');
    expect(google).toMatchObject({ investimento: null, cpl: null });
  });

  test('sem investimento no período não há bloco de custo nem campos de custo nas linhas @spec:AC-637', async () => {
    const outroMes = await (await get('?de=2025-05-01&ate=2025-05-31')).json();
    expect(outroMes.custo).toBeNull();
    for (const l of outroMes.porOrigem) expect(l).not.toHaveProperty('investimento');
  });

  test('divisão por zero (sem lead ou sem contrato) dá nulo, nunca zero ou erro @spec:AC-638', async () => {
    const semLeads = await (await get('?de=2025-10-01&ate=2025-10-10')).json();
    expect(semLeads.resumo.leads).toBe(0);
    expect(semLeads.custo).toEqual({ investimento: 1000, cpl: null, cac: null, roas: 0 });
    const soGoogleSemContrato = await (await get('?origem=Google%20Ads')).json();
    expect(soGoogleSemContrato.custo).toBeNull();
  });
});
