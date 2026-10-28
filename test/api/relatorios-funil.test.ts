// T-201 (fase4-analises, US-133): GET /api/relatorios/funil — funil por etapa e
// desempenho por responsável, contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDeAtendente } from '../support/atendente';

const ANA = 'acacacac-2010-0000-0000-0000000000a1';
const BIA = 'acacacac-2010-0000-0000-0000000000a2';
const ID = (n: number) => `acacacac-2011-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-201: funil e desempenho por responsável', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/relatorios/funil/route');
  let cookieAtendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const evento = (card: string, tipo: string, etapa: number | null = null, payload = '{}', empresa = amb.tenants.empresaA) =>
    sql(`INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo, payload)
         VALUES ('${empresa}', '${card}', '${tipo}', ${etapa ?? 'NULL'}, 'sistema', '${payload}'::jsonb)`);
  const get = (query = '', cookie: string | null = amb.cookieA) =>
    rota.GET(new NextRequest(`http://localhost/api/relatorios/funil${query}`, { headers: cookie ? { Cookie: cookie } : {} }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB, leadA, leadB } = amb.tenants;
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f201.com', 'Ana Closer'), ('${BIA}', 'bia@f201.com', 'Bia SDR');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel) VALUES ('${empresaA}', '${ANA}', 'GERENTE'), ('${empresaA}', '${BIA}', 'ATENDENTE');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, responsavel_id, valor, criado_em) VALUES
           ('${ID(1)}', '${empresaA}', '${leadA}', 15, '${ANA}', 1000, now()),
           ('${ID(2)}', '${empresaA}', '${leadA}', 2, '${ANA}', 500, now()),
           ('${ID(3)}', '${empresaA}', '${leadA}', 9, '${BIA}', 700, now()),
           ('${ID(4)}', '${empresaA}', '${leadA}', 1, NULL, 300, now()),
           ('${ID(5)}', '${empresaA}', '${leadA}', 15, '${BIA}', 5000, now() - interval '90 days'),
           ('${ID(6)}', '${empresaB}', '${leadB}', 15, NULL, 9000, now());`);
    evento(ID(1), 'cadencia_iniciada');
    evento(ID(1), 'atividade_concluida', null, '{"resultado":"conectou"}');
    for (const etapa of [8, 10, 11, 15]) evento(ID(1), 'transicao_etapa', etapa);
    evento(ID(2), 'cadencia_iniciada');
    evento(ID(2), 'cadencia_esgotada');
    evento(ID(3), 'atividade_concluida', null, '{"resultado":"conectou"}');
    for (const etapa of [8, 9]) evento(ID(3), 'transicao_etapa', etapa);
    evento(ID(5), 'transicao_etapa', 15);
    evento(ID(6), 'transicao_etapa', 15, '{}', empresaB);
    cookieAtendente = await cookieDeAtendente(amb, 'atendente.f201@teste.com');
    rota = await import('../../src/app/api/relatorios/funil/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('devolve o funil por etapa e o desempenho de cada responsável, só da empresa e só da coorte do período @spec:AC-557', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.funil).toEqual({ entrada: 5, conectados: 2, agendadas: 2, realizadas: 1, propostas: 1, ganhos: 1 });

    expect(corpo.porResponsavel[0]).toMatchObject({
      responsavelId: ANA, nome: 'Ana Closer', papel: 'GERENTE', atendidos: 2, cadenciaIniciada: 2, cadenciaEsgotada: 1,
      agendadas: 1, noShows: 0, propostas: 1, contratos: 1, winRate: 1, receitaGanha: 1000,
    });
    const bia = corpo.porResponsavel.find((p: { responsavelId: string | null }) => p.responsavelId === BIA);
    expect(bia).toMatchObject({ nome: 'Bia SDR', papel: 'ATENDENTE', atendidos: 1, agendadas: 1, noShows: 1, propostas: 0, contratos: 0, winRate: null, receitaGanha: 0 });
    const semDono = corpo.porResponsavel.find((p: { responsavelId: string | null }) => p.responsavelId === null);
    expect(semDono).toMatchObject({ nome: null, atendidos: 2 }); // o card do cenário e o card sem dono
    expect(corpo.porResponsavel).toHaveLength(3);

    const filtrado = await (await get(`?responsavelId=${BIA}`)).json();
    expect(filtrado.funil.entrada).toBe(1);
    expect(filtrado.porResponsavel).toHaveLength(1);

    // um período antigo pega só o card antigo
    const antigo = await (await get(`?de=2000-01-01&ate=2000-01-31`)).json();
    expect(antigo.funil).toEqual({ entrada: 0, conectados: 0, agendadas: 0, realizadas: 0, propostas: 0, ganhos: 0 });
    expect(antigo.porResponsavel).toEqual([]);

    const daB = await (await get('', amb.cookieB)).json();
    expect(daB.funil.entrada).toBe(2);
    expect(daB.funil.ganhos).toBe(1);
  });

  test('parâmetro inválido é 400, sem sessão é 401 e atendente é 403 @spec:AC-557', async () => {
    expect((await get('?de=2026-13-01')).status).toBe(400);
    expect((await get('?de=2026-02-10&ate=2026-02-01')).status).toBe(400);
    expect((await get('?de=2020-01-01&ate=2026-01-01')).status).toBe(400);
    expect((await get('?responsavelId=nao-uuid')).status).toBe(400);
    expect((await get('', null)).status).toBe(401);
    expect((await get('', cookieAtendente)).status).toBe(403);
  });
});
