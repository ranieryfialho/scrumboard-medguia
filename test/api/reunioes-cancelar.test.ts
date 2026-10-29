// T-234 (fase5-acoes-rapidas, US-150): cancelar reunião contra um Postgres efêmero real com dois
// tenants. Relógio fixado em 11/06/2026, 11h em São Paulo.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDeAtendente } from '../support/atendente';

const ID = (n: number) => `eeeeeeee-6400-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const C_OK = ID(1); // etapa 8, reunião futura
const C_ANDAMENTO = ID(2); // etapa 8, reunião em andamento
const C_NOSHOW = ID(3); // etapa 9, reunião com no-show
const C_REMARCADA = ID(4); // etapa 8, reunião remarcada
const C_ALHEIO = ID(5); // etapa 8, responsável outra pessoa
const C_B = ID(6); // etapa 8 da empresa B
const R_OK = ID(21);
const R_ANDAMENTO = ID(22);
const R_NOSHOW = ID(23);
const R_REMARCADA = ID(24);
const R_NOVA = ID(25);
const R_ALHEIA = ID(26);
const R_B = ID(27);
const OUTRA_PESSOA = 'eeeeeeee-6400-0000-0000-0000000000f9';

describe('T-234: cancelar reunião', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/reunioes/[id]/cancelar/route');
  let atendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const etapaDe = (card: string) => Number(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`));
  const existe = (reuniao: string) => sql(`SELECT count(*) FROM reunioes WHERE id = '${reuniao}'`) === '1';
  const cancelar = (id: string, cookie: string | null = amb.cookieA) =>
    rota.POST(new NextRequest(`http://localhost/api/reunioes/${id}/cancelar`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ id }) });

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: C_OK, etapaId: 8 },
      { id: C_ANDAMENTO, etapaId: 8 },
      { id: C_NOSHOW, etapaId: 9 },
      { id: C_REMARCADA, etapaId: 8 },
      { id: C_ALHEIO, etapaId: 8 },
    ]);
    const { empresaA, empresaB, leadB } = amb.tenants;
    atendente = await cookieDeAtendente(amb, 'atendente.f640@teste.com');
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${OUTRA_PESSOA}', 'outra@f640.com', 'Outra Pessoa');
         UPDATE oportunidades SET responsavel_id = '${OUTRA_PESSOA}' WHERE id = '${C_ALHEIO}';
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id) VALUES ('${C_B}', '${empresaB}', '${leadB}', 8);
         INSERT INTO reunioes (id, oportunidade_id, empresa_id, agendada_para, no_show) VALUES
           ('${R_OK}', '${C_OK}', '${empresaA}', '2026-06-15T17:00:00Z', false),
           ('${R_ANDAMENTO}', '${C_ANDAMENTO}', '${empresaA}', '2026-06-11T13:30:00Z', false),
           ('${R_NOSHOW}', '${C_NOSHOW}', '${empresaA}', '2026-06-10T12:00:00Z', true),
           ('${R_REMARCADA}', '${C_REMARCADA}', '${empresaA}', '2026-06-18T12:00:00Z', false),
           ('${R_ALHEIA}', '${C_ALHEIO}', '${empresaA}', '2026-06-16T12:00:00Z', false),
           ('${R_B}', '${C_B}', '${empresaB}', '2026-06-16T12:00:00Z', false);
         INSERT INTO reunioes (id, oportunidade_id, empresa_id, agendada_para, remarcada_de) VALUES
           ('${R_NOVA}', '${C_REMARCADA}', '${empresaA}', '2026-06-19T12:00:00Z', '${R_REMARCADA}');`);
    rota = await import('../../src/app/api/reunioes/[id]/cancelar/route');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-11T14:00:00Z'));
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await amb?.parar();
  });

  test('cancelar apaga a reunião, devolve o card para "Qualificado p/ reunião" e registra a mudança @spec:AC-640 @spec:AC-644', async () => {
    const r = await cancelar(R_OK);
    expect(r.status).toBe(200);
    expect(existe(R_OK)).toBe(false);
    expect(etapaDe(C_OK)).toBe(6);
    expect(sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${C_OK}' AND tipo = 'transicao_etapa' AND etapa_destino_id = 6`)).toBe('1');
    // a transição 8 → 6 existe no grafo para os três papéis, sem justificativa
    expect(sql(`SELECT exige_justificativa::text || ':' || array_length(papeis_permitidos, 1) FROM pipeline_transicoes WHERE etapa_origem_id = 8 AND etapa_destino_id = 6`)).toBe('false:3');
  });

  test('só reunião agendada cancela: em andamento, com no-show e remarcada são recusadas sem mudar nada @spec:AC-641', async () => {
    for (const [reuniao, card, etapa] of [[R_ANDAMENTO, C_ANDAMENTO, 8], [R_NOSHOW, C_NOSHOW, 9], [R_REMARCADA, C_REMARCADA, 8]] as const) {
      const r = await cancelar(reuniao);
      expect(r.status, reuniao).toBe(422);
      expect((await r.json()).codigo).toBe('REUNIAO_NAO_PODE_CANCELAR');
      expect(existe(reuniao)).toBe(true);
      expect(etapaDe(card)).toBe(etapa);
    }
  });

  test('atendente só cancela o próprio card; reunião de outra empresa e id inválido são "não encontrada"; sem sessão dá 401 @spec:AC-642', async () => {
    expect((await cancelar(R_ALHEIA, atendente)).status).toBe(404);
    expect(existe(R_ALHEIA)).toBe(true);
    expect((await cancelar(R_B)).status).toBe(404);
    expect(existe(R_B)).toBe(true);
    expect((await cancelar('nao-e-uuid')).status).toBe(404);
    expect((await cancelar(R_ALHEIA, null)).status).toBe(401);
    // o gerente cancela o de outra pessoa
    expect((await cancelar(R_ALHEIA)).status).toBe(200);
    expect(etapaDe(C_ALHEIO)).toBe(6);
  });
});
