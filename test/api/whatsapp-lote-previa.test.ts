// T-249 (fase5-whatsapp-lote-base, US-161): regras e prévia do lote contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ID = (n: number) => `c3c3c3c3-6740-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const LEAD_OK = ID(1);
const LEAD_SEM_CONSENTIMENTO = ID(2);
const LEAD_SEM_TELEFONE = ID(3);
const LEAD_REPETIDO = ID(4); // mesmo número do OK, sem o nono dígito
const LEAD_DA_B = ID(5);
const T_APROVADO = ID(31);
const T_RASCUNHO = ID(32);
const T_ARQUIVADO = ID(33);
const T_DA_B = ID(34);

describe('T-249: regras e prévia do lote', () => {
  let amb: AmbienteAnexos;
  let rotaRegras: typeof import('../../src/app/api/whatsapp/lote/regras/route');
  let rotaPrevia: typeof import('../../src/app/api/whatsapp/lote/previa/route');
  let atendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
  }
  const previa = (corpo: unknown, cookie: string | null = atendente) =>
    rotaPrevia.POST(new NextRequest('http://localhost/api/whatsapp/lote/previa', { method: 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    atendente = await cookieDePapel(amb, 'atendente.f674@teste.com', 'ATENDENTE');
    sql(`INSERT INTO leads (id, empresa_id, nome, telefone_e164, consentimento_whatsapp_em) VALUES
           ('${LEAD_OK}', '${empresaA}', 'Dra. Ana Paula Lima', '5511988880001', now()),
           ('${LEAD_SEM_CONSENTIMENTO}', '${empresaA}', 'Sem Consentimento', '5511977770002', NULL),
           ('${LEAD_SEM_TELEFONE}', '${empresaA}', 'Sem Telefone', NULL, now()),
           ('${LEAD_REPETIDO}', '${empresaA}', 'Repetido', '551188880001', now()),
           ('${LEAD_DA_B}', '${empresaB}', 'Da Outra', '5511966660003', now());
         INSERT INTO whatsapp_templates (id, empresa_id, nome, corpo, status, aprovado_em) VALUES
           ('${T_APROVADO}', '${empresaA}', 'Aprovado', 'Olá, {{primeiro_nome}}! Falo com {{nome}}?', 'aprovado', now()),
           ('${T_RASCUNHO}', '${empresaA}', 'Rascunho', 'x', 'rascunho', NULL),
           ('${T_ARQUIVADO}', '${empresaA}', 'Arquivado', 'x', 'arquivado', NULL),
           ('${T_DA_B}', '${empresaB}', 'Da B', 'x', 'aprovado', now());`);
    rotaRegras = await import('../../src/app/api/whatsapp/lote/regras/route');
    rotaPrevia = await import('../../src/app/api/whatsapp/lote/previa/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('as regras são 50 por disparo e 15 a 45 segundos; sem sessão dá 401 @spec:AC-674', async () => {
    const r = await rotaRegras.GET(new NextRequest('http://localhost/api/whatsapp/lote/regras', { headers: { Cookie: atendente } }));
    expect(await r.json()).toEqual({ limitePorDisparo: 50, intervalo: { minimoSegundos: 15, maximoSegundos: 45 } });
    expect((await rotaRegras.GET(new NextRequest('http://localhost/api/whatsapp/lote/regras'))).status).toBe(401);
  });

  test('a prévia separa elegíveis de excluídos, com mensagem preenchida e motivo de cada exclusão @spec:AC-675', async () => {
    const r = await previa({ templateId: T_APROVADO, leadIds: [LEAD_OK, LEAD_SEM_CONSENTIMENTO, LEAD_SEM_TELEFONE, LEAD_REPETIDO, LEAD_DA_B] });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.template).toEqual({ id: T_APROVADO, nome: 'Aprovado' });
    expect(corpo.elegiveis).toEqual([{ leadId: LEAD_OK, nome: 'Dra. Ana Paula Lima', telefone: '5511988880001', mensagem: 'Olá, Dra.! Falo com Dra. Ana Paula Lima?' }]);
    expect(corpo.excluidos).toEqual([
      { leadId: LEAD_SEM_CONSENTIMENTO, nome: 'Sem Consentimento', motivo: 'SEM_CONSENTIMENTO' },
      { leadId: LEAD_SEM_TELEFONE, nome: 'Sem Telefone', motivo: 'SEM_TELEFONE' },
      { leadId: LEAD_REPETIDO, nome: 'Repetido', motivo: 'TELEFONE_REPETIDO' },
      { leadId: LEAD_DA_B, nome: null, motivo: 'LEAD_NAO_ENCONTRADO' },
    ]);
    expect(corpo).toMatchObject({ limite: 50, intervalo: { minimoSegundos: 15, maximoSegundos: 45 }, duracaoEstimadaSegundos: 0 });

    expect((await previa({ templateId: T_APROVADO, leadIds: [] })).status).toBe(400);
    expect((await previa({ templateId: T_APROVADO, leadIds: ['nao-uuid'] })).status).toBe(400);
    expect((await previa({ templateId: T_APROVADO, leadIds: Array.from({ length: 501 }, () => LEAD_OK) })).status).toBe(400);
  });

  test('só template aprovado da empresa: rascunho e arquivado 422, de outra empresa e inexistente 404, sem sessão 401 @spec:AC-676', async () => {
    for (const templateId of [T_RASCUNHO, T_ARQUIVADO]) {
      const r = await previa({ templateId, leadIds: [LEAD_OK] });
      expect(r.status, templateId).toBe(422);
      expect((await r.json()).codigo).toBe('TEMPLATE_NAO_APROVADO');
    }
    for (const templateId of [T_DA_B, ID(99), 'nao-uuid']) expect((await previa({ templateId, leadIds: [LEAD_OK] })).status, templateId).toBe(404);
    expect((await previa({ templateId: T_APROVADO, leadIds: [LEAD_OK] }, null)).status).toBe(401);
  });
});
