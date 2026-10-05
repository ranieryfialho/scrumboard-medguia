// Testes de T-057 (fase2c-anexos, US-036): o anexo como evidência na rota
// POST /api/oportunidades/:id/transicao — destino "Reunião realizada" (etapa
// 10, exige evidência), origem "Reunião agendada" (etapa 8).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';

const ETAPA_REUNIAO_AGENDADA = 8;
const ETAPA_REUNIAO_REALIZADA = 10;

const CARD_OK = 'ffffffff-0000-0000-0000-0000000000b1';
const CARD_OUTRO_ANEXO = 'ffffffff-0000-0000-0000-0000000000b2';
const CARD_ANEXO_ALHEIO = 'ffffffff-0000-0000-0000-0000000000b3';
const CARD_INEXISTENTE = 'ffffffff-0000-0000-0000-0000000000b4';

describe('T-057: anexo como evidência na transição', () => {
  let amb: AmbienteAnexos;
  let rotaUpload: typeof import('../../src/app/api/anexos/route');
  let rotaTransicao: typeof import('../../src/app/api/oportunidades/[id]/transicao/route');

  async function enviarAnexo(cookie: string, oportunidadeId: string): Promise<string> {
    const form = new FormData();
    form.set('oportunidadeId', oportunidadeId);
    form.set('arquivo', new File([preencher(PNG, 256) as BlobPart], 'print.png', { type: 'image/png' }));
    const resposta = await rotaUpload.POST(
      new NextRequest('http://localhost/api/anexos', { method: 'POST', headers: { Cookie: cookie }, body: form })
    );
    expect(resposta.status).toBe(201);
    return (await resposta.json()).anexoId;
  }

  function moverPara10(cardId: string, anexoId: unknown) {
    const request = new NextRequest(`http://localhost/api/oportunidades/${cardId}/transicao`, {
      method: 'POST',
      headers: { Cookie: amb.cookieA, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, etapaDestinoId: ETAPA_REUNIAO_REALIZADA, anexoId }),
    });
    return rotaTransicao.POST(request, { params: Promise.resolve({ id: cardId }) });
  }

  function etapaDe(cardId: string) {
    return amb.pg
      .psqlComo('crm_migrator', `SELECT "etapa_id", "version" FROM "oportunidades" WHERE "id" = '${cardId}'`)
      .stdout.trim();
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: CARD_OK, etapaId: ETAPA_REUNIAO_AGENDADA },
      { id: CARD_OUTRO_ANEXO, etapaId: ETAPA_REUNIAO_AGENDADA },
      { id: CARD_ANEXO_ALHEIO, etapaId: ETAPA_REUNIAO_AGENDADA },
      { id: CARD_INEXISTENTE, etapaId: ETAPA_REUNIAO_AGENDADA },
    ]);
    rotaUpload = await import('../../src/app/api/anexos/route');
    rotaTransicao = await import('../../src/app/api/oportunidades/[id]/transicao/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('anexo do próprio card: a transição para "Reunião realizada" é aceita @spec:AC-105', async () => {
    const anexoId = await enviarAnexo(amb.cookieA, CARD_OK);

    const resposta = await moverPara10(CARD_OK, anexoId);

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).etapaId).toBe(ETAPA_REUNIAO_REALIZADA);
    expect(etapaDe(CARD_OK)).toBe(`${ETAPA_REUNIAO_REALIZADA}|2`);
  });

  test('anexo de outro card, de outro tenant ou inexistente: 422 EVIDENCIA_OBRIGATORIA, card inalterado @spec:AC-106', async () => {
    const anexoDeOutroCard = await enviarAnexo(amb.cookieA, amb.tenants.oportunidadeA);
    // Empresa B anexa ao card dela; empresa A tenta usar esse anexo como evidência.
    const anexoDeOutroTenant = await enviarAnexo(amb.cookieB, amb.tenants.oportunidadeB);

    const tentativas: [string, unknown][] = [
      [CARD_OUTRO_ANEXO, anexoDeOutroCard],
      [CARD_ANEXO_ALHEIO, anexoDeOutroTenant],
      [CARD_INEXISTENTE, 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ];
    for (const [card, anexo] of tentativas) {
      const resposta = await moverPara10(card, anexo);
      expect(resposta.status).toBe(422);
      expect((await resposta.json()).codigo).toBe('EVIDENCIA_OBRIGATORIA');
      expect(etapaDe(card)).toBe(`${ETAPA_REUNIAO_AGENDADA}|1`);
    }

    // Lixo que nem é uuid também não vale (e não derruba a rota).
    const lixo = await moverPara10(CARD_OUTRO_ANEXO, 'nao-e-uuid');
    expect(lixo.status).toBe(422);

    const eventos = amb.pg.psqlComo(
      'crm_migrator',
      `SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" IN ('${CARD_OUTRO_ANEXO}', '${CARD_ANEXO_ALHEIO}', '${CARD_INEXISTENTE}')`
    );
    expect(eventos.stdout.trim()).toBe('0');
  });
});
