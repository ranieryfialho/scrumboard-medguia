// T-296 (fase4-pipeline-lote, fase2b-cadencia): entrar em "1º dia de contato" inicia a cadência (AC-758) e "Iniciar Cadência em Massa"
// (AC-759/AC-760), contra um Postgres efêmero real com dois tenants. As asserções não dependem do turno (a rota usa o relógio real):
// só da existência dos 3 toques, do ponteiro do card e dos eventos.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;
const ETAPA_FOLLOW = 7;
const INEXISTENTE = 'aaaaaaaa-1111-4111-8111-00000000ffff';

describe('T-296: cadência ao entrar em "1º dia de contato" e em massa', () => {
  let amb: AmbienteAnexos;
  let transicao: typeof import('../../src/app/api/oportunidades/[id]/transicao/route');
  let lote: typeof import('../../src/app/api/oportunidades/lote/iniciar-cadencia/route');
  let loteMover: typeof import('../../src/app/api/oportunidades/lote/mover/route');
  let atendente: string;
  let contador = 0;

  const sql = (texto: string) => {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };

  /** Um card novo da empresa A (ou B) na etapa dada; o Follow exige próxima ação no futuro. */
  function novoCard(etapaId: number, empresaId = amb.tenants.empresaA): string {
    contador += 1;
    const id = `cccccccc-3333-4000-8000-${contador.toString(16).padStart(12, '0')}`;
    const lead = `cccccccc-4444-4000-8000-${contador.toString(16).padStart(12, '0')}`;
    sql(`INSERT INTO leads (id, empresa_id, nome) VALUES ('${lead}', '${empresaId}', 'Lead ${contador}')`);
    sql(`INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, proxima_acao_em)
         VALUES ('${id}', '${empresaId}', '${lead}', ${etapaId}, ${etapaId === ETAPA_FOLLOW ? "now() + interval '10 days'" : 'NULL'})`);
    return id;
  }
  const versao = (id: string) => Number(sql(`SELECT version FROM oportunidades WHERE id = '${id}'`));
  const toques = (id: string) => sql(`SELECT coalesce(string_agg(sequencia::text, ',' ORDER BY sequencia), '') FROM cadencia_atividades WHERE oportunidade_id = '${id}'`);
  const eventos = (id: string, tipo: string) => sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${id}' AND tipo = '${tipo}'`);

  const mover = (id: string, corpo: Record<string, unknown>, cookie: string | null = atendente) =>
    transicao.POST(
      new NextRequest(`http://localhost/api/oportunidades/${id}/transicao`, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      }),
      { params: Promise.resolve({ id }) }
    );
  const emMassa = (corpo: unknown, cookie: string | null = atendente) =>
    lote.POST(
      new NextRequest('http://localhost/api/oportunidades/lote/iniciar-cadencia', {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
    );

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.cadencia@teste.com', 'ATENDENTE');
    transicao = await import('../../src/app/api/oportunidades/[id]/transicao/route');
    lote = await import('../../src/app/api/oportunidades/lote/iniciar-cadencia/route');
    loteMover = await import('../../src/app/api/oportunidades/lote/mover/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('mover de "Entrada de leads" para "1º dia de contato" inicia a cadência: 3 toques, ponteiro e evento @spec:AC-758', async () => {
    const card = novoCard(ETAPA_ENTRADA);
    const r = await mover(card, { version: versao(card), etapaDestinoId: ETAPA_1_DIA });

    expect(r.status).toBe(200);
    expect((await r.json()).etapaId).toBe(ETAPA_1_DIA);
    expect(['1,2,3', '4,5,6']).toContain(toques(card)); // manhã ou tarde, conforme a hora em que o teste roda
    expect(sql(`SELECT cadencia_dia IS NOT NULL AND cadencia_turno IS NOT NULL FROM oportunidades WHERE id = '${card}'`)).toBe('t');
    expect(eventos(card, 'cadencia_iniciada')).toBe('1');
    expect(eventos(card, 'transicao_etapa')).toBe('1');
  });

  test('voltar do Follow de longo prazo, sem toques, também inicia; com toques de uma cadência anterior, só muda de etapa @spec:AC-758', async () => {
    const semToques = novoCard(ETAPA_FOLLOW);
    expect((await mover(semToques, { version: versao(semToques), etapaDestinoId: ETAPA_1_DIA })).status).toBe(200);
    expect(toques(semToques)).not.toBe('');

    const comToques = novoCard(ETAPA_FOLLOW);
    sql(`INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado)
         VALUES ('${comToques}', '${amb.tenants.empresaA}', 1, 1, 'manha', 'telefone', 'ligacao', 'sem_resposta')`);
    expect((await mover(comToques, { version: versao(comToques), etapaDestinoId: ETAPA_1_DIA })).status).toBe(200);
    expect(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${comToques}'`)).toBe(String(ETAPA_1_DIA));
    expect(toques(comToques)).toBe('1');
    expect(eventos(comToques, 'cadencia_iniciada')).toBe('0');
  });

  test('versão desatualizada é 409 e nada é criado; destino que não é "1º dia de contato" não mexe em toques @spec:AC-758', async () => {
    const card = novoCard(ETAPA_ENTRADA);
    const conflito = await mover(card, { version: 99, etapaDestinoId: ETAPA_1_DIA });
    expect(conflito.status).toBe(409);
    expect((await conflito.json()).codigo).toBe('CONFLITO_DE_VERSAO');
    expect(toques(card)).toBe('');
    expect(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`)).toBe(String(ETAPA_ENTRADA));

    const naoPermitido = await mover(card, { version: versao(card), etapaDestinoId: 5 });
    expect(naoPermitido.status).toBeGreaterThanOrEqual(400);
    expect(toques(card)).toBe('');
  });

  test('o lote "Mover Etapa" para "1º dia de contato" também inicia a cadência de cada card @spec:AC-758', async () => {
    const a = novoCard(ETAPA_ENTRADA);
    const b = novoCard(ETAPA_ENTRADA);
    const r = await loteMover.POST(
      new NextRequest('http://localhost/api/oportunidades/lote/mover', {
        method: 'POST',
        headers: { Cookie: atendente, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [a, b], etapaDestinoId: ETAPA_1_DIA }),
      })
    );
    expect((await r.json()).aplicados).toBe(2);
    expect(toques(a)).not.toBe('');
    expect(toques(b)).not.toBe('');
  });

  test('em massa: inicia os que estão em "Entrada de leads" e lista, com o motivo, os que não dão @spec:AC-759', async () => {
    const a = novoCard(ETAPA_ENTRADA);
    const b = novoCard(ETAPA_ENTRADA);
    const jaEmContato = novoCard(ETAPA_1_DIA);
    const comToquesAntigos = novoCard(ETAPA_ENTRADA);
    sql(`INSERT INTO cadencia_atividades (oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo, resultado)
         VALUES ('${comToquesAntigos}', '${amb.tenants.empresaA}', 1, 1, 'manha', 'telefone', 'ligacao', 'cancelada')`);
    const deOutraEmpresa = novoCard(ETAPA_ENTRADA, amb.tenants.empresaB);

    const r = await emMassa({ ids: [a, jaEmContato, b, comToquesAntigos, deOutraEmpresa, INEXISTENTE, 'nao-e-uuid', a] });
    expect(r.status).toBe(200);
    const corpo = await r.json();

    const porId = new Map<string, { id: string; ok: boolean; codigo?: string }>(corpo.resultados.map((x: { id: string }) => [x.id, x]));
    expect(corpo.aplicados).toBe(2);
    expect(corpo.falhas).toBe(5);
    expect(corpo.resultados).toHaveLength(7); // o `a` repetido conta uma vez
    expect(porId.get(a)).toEqual({ id: a, ok: true });
    expect(porId.get(b)).toEqual({ id: b, ok: true });
    expect(porId.get(jaEmContato)).toEqual({ id: jaEmContato, ok: false, codigo: 'CADENCIA_SO_EM_ENTRADA' });
    expect(porId.get(comToquesAntigos)).toEqual({ id: comToquesAntigos, ok: false, codigo: 'CADENCIA_JA_INICIADA' });
    expect(porId.get(deOutraEmpresa)?.codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');
    expect(porId.get(INEXISTENTE)?.codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');
    expect(porId.get('nao-e-uuid')?.codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');

    for (const id of [a, b]) {
      expect(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${id}'`)).toBe(String(ETAPA_1_DIA));
      expect(sql(`SELECT count(*) FROM cadencia_atividades WHERE oportunidade_id = '${id}'`)).toBe('3');
      expect(eventos(id, 'cadencia_iniciada')).toBe('1');
    }
    expect(toques(jaEmContato)).toBe('');
    expect(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${deOutraEmpresa}'`)).toBe(String(ETAPA_ENTRADA));
    expect(toques(deOutraEmpresa)).toBe('');
  });

  test('pedido inválido é 400 e sem sessão é 401, sem tocar em nenhum card @spec:AC-760', async () => {
    const card = novoCard(ETAPA_ENTRADA);
    for (const corpo of [{}, { ids: [] }, { ids: 'x' }, { ids: [1, 2] }, { ids: Array.from({ length: 101 }, (_, i) => `${card}-${i}`) }]) {
      expect((await emMassa(corpo)).status, JSON.stringify(corpo).slice(0, 40)).toBe(400);
    }
    expect((await emMassa({ ids: [card] }, null)).status).toBe(401);
    expect(toques(card)).toBe('');

    const cem = await emMassa({ ids: Array.from({ length: 100 }, () => INEXISTENTE) });
    expect(cem.status).toBe(200);
  });
});
