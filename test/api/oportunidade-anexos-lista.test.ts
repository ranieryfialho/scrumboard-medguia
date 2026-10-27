// Testes de T-169 (fase4-card-abas, US-112): GET /api/oportunidades/:id/anexos
// — listagem dos anexos do card (aba "Anexos & Evidências", tela 12), contra
// um Postgres 15 efêmero real.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PDF_CABECALHO, PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';

const CARD_INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ETAPA_DESTINO = 10; // "Reunião realizada" (drizzle/0005_seeds.sql)

describe('T-169: listagem dos anexos do card (servidor)', () => {
  let amb: AmbienteAnexos;
  let rotaUpload: typeof import('../../src/app/api/anexos/route');
  let rotaLista: typeof import('../../src/app/api/oportunidades/[id]/anexos/route');

  async function enviarAnexo(cookie: string, oportunidadeId: string, arquivo: Uint8Array, nome: string, mime: string) {
    const form = new FormData();
    form.set('oportunidadeId', oportunidadeId);
    form.set('arquivo', new File([arquivo as BlobPart], nome, { type: mime }));
    const resposta = await rotaUpload.POST(
      new NextRequest('http://localhost/api/anexos', { method: 'POST', headers: { Cookie: cookie }, body: form })
    );
    expect(resposta.status).toBe(201);
    return (await resposta.json()).anexoId as string;
  }

  function get(cookie: string | null, cardId: string) {
    const headers = cookie ? { Cookie: cookie } : undefined;
    const request = new NextRequest(`http://localhost/api/oportunidades/${cardId}/anexos`, { headers });
    return rotaLista.GET(request, { params: Promise.resolve({ id: cardId }) });
  }

  function definirCriadoEm(anexoId: string, isoDate: string) {
    const resultado = amb.pg.psqlComo(
      'crm_migrator',
      `UPDATE "anexos" SET "criado_em" = '${isoDate}' WHERE "id" = '${anexoId}'`
    );
    if (resultado.status !== 0) throw new Error(`Falha ao ajustar criado_em: ${resultado.stderr}`);
  }

  function gravarEventoComEvidencia(cardId: string, empresaId: string, anexoId: string) {
    const resultado = amb.pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidade_eventos"
         ("empresa_id", "oportunidade_id", "tipo", "etapa_destino_id", "ator_tipo", "payload")
       VALUES
         ('${empresaId}', '${cardId}', 'transicao_etapa', ${ETAPA_DESTINO}, 'sistema', '{"anexoId":"${anexoId}"}'::jsonb)`
    );
    if (resultado.status !== 0) throw new Error(`Falha ao gravar evento de evidência: ${resultado.stderr}`);
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    rotaUpload = await import('../../src/app/api/anexos/route');
    rotaLista = await import('../../src/app/api/oportunidades/[id]/anexos/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('lista os anexos do card do mais novo ao mais antigo, com nome, mime, tamanho, hash, quem enviou e quando @spec:AC-423', async () => {
    const anexo1 = await enviarAnexo(amb.cookieA, amb.tenants.oportunidadeA, preencher(PNG, 64), 'print-1.png', 'image/png');
    definirCriadoEm(anexo1, '2026-10-20T10:00:00Z');
    const anexo2 = await enviarAnexo(
      amb.cookieA,
      amb.tenants.oportunidadeA,
      preencher(PDF_CABECALHO, 64),
      'Proposta Comercial v1.2.pdf',
      'application/pdf'
    );
    definirCriadoEm(anexo2, '2026-10-21T10:00:00Z');

    const resposta = await get(amb.cookieA, amb.tenants.oportunidadeA);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    expect(corpo.anexos).toHaveLength(2);
    expect(corpo.anexos.map((a: { id: string }) => a.id)).toEqual([anexo2, anexo1]);

    const maisNovo = corpo.anexos[0];
    expect(maisNovo.nome).toBe('Proposta Comercial v1.2.pdf');
    expect(maisNovo.mime).toBe('application/pdf');
    expect(typeof maisNovo.tamanho).toBe('number');
    expect(typeof maisNovo.hash).toBe('string');
    expect(maisNovo.hash.length).toBeGreaterThan(0);
    expect(maisNovo.enviadoPorNome).toBeTruthy();
    expect(maisNovo.criadoEm).toBe('2026-10-21T10:00:00.000Z');
    expect(maisNovo.evidencia).toBeNull();
  });

  test('não traz anexos de outro card nem de outro tenant @spec:AC-423', async () => {
    await enviarAnexo(amb.cookieB, amb.tenants.oportunidadeB, preencher(PNG, 64), 'alheio.png', 'image/png');

    const resposta = await get(amb.cookieA, amb.tenants.oportunidadeA);
    const corpo = await resposta.json();

    expect(corpo.anexos.every((a: { nome: string | null }) => a.nome !== 'alheio.png')).toBe(true);
  });

  test('card de outra empresa responde 404 @spec:AC-423', async () => {
    const resposta = await get(amb.cookieB, amb.tenants.oportunidadeA);
    expect(resposta.status).toBe(404);
    expect((await resposta.json()).codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');
  });

  test('card inexistente responde 404 @spec:AC-423', async () => {
    const resposta = await get(amb.cookieA, CARD_INEXISTENTE);
    expect(resposta.status).toBe(404);
  });

  test('sem sessão responde 401 @spec:AC-423', async () => {
    const resposta = await get(null, amb.tenants.oportunidadeA);
    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  test('anexo sem nome (anterior à migration 0013) aparece com nome nulo, não string vazia @spec:AC-424', async () => {
    amb.pg.psqlComo(
      'crm_migrator',
      `UPDATE "anexos" SET "nome" = NULL WHERE "oportunidade_id" = '${amb.tenants.oportunidadeA}' AND "mime" = 'image/png'`
    );

    const resposta = await get(amb.cookieA, amb.tenants.oportunidadeA);
    const corpo = await resposta.json();
    const semNome = corpo.anexos.find((a: { mime: string }) => a.mime === 'image/png');

    expect(semNome.nome).toBeNull();
  });

  test('anexo usado como evidência numa mudança de etapa mostra o selo com o nome da etapa @spec:AC-424', async () => {
    const anexoEvidencia = await enviarAnexo(
      amb.cookieA,
      amb.tenants.oportunidadeA,
      preencher(PNG, 64),
      'evidencia.png',
      'image/png'
    );
    gravarEventoComEvidencia(amb.tenants.oportunidadeA, amb.tenants.empresaA, anexoEvidencia);

    const resposta = await get(amb.cookieA, amb.tenants.oportunidadeA);
    const corpo = await resposta.json();
    const item = corpo.anexos.find((a: { id: string }) => a.id === anexoEvidencia);

    expect(item.evidencia).toEqual({ etapaId: ETAPA_DESTINO, etapaNome: 'Reunião realizada' });
  });
});
