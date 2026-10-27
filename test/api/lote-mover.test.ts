// Testes de T-176 (fase4-pipeline-lote, US-115): POST /api/oportunidades/lote/mover
// — mover vários cards de uma vez, contra um Postgres 15 efêmero real com dois
// tenants (test/support/api-anexos.ts). Cada card segue as mesmas regras do card
// avulso; falha num card não trava os outros.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

const C1 = 'cccccccc-1111-0000-0000-000000000001'; // etapa 1 → 2 permitido
const C2 = 'cccccccc-1111-0000-0000-000000000002'; // etapa 1 → 2 permitido
const C3 = 'cccccccc-1111-0000-0000-000000000003'; // etapa 5 → 2 fora do grafo
const C4 = 'cccccccc-1111-0000-0000-000000000004'; // etapa 5 → 7 exige próxima ação
const C5 = 'cccccccc-1111-0000-0000-000000000005'; // etapa 1, versão avançada
const INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const ETAPA_1_DIA = 2;
const ETAPA_FOLLOW_LONGO_PRAZO = 7;

interface ResultadoItem {
  id: string;
  ok: boolean;
  codigo?: string;
}

describe('T-176: mover em lote (servidor)', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/oportunidades/lote/mover/route');
  let barramento: typeof import('../../src/lib/sse/barramento');

  function post(cookie: string | null, corpo: unknown) {
    return rota.POST(
      new NextRequest('http://localhost/api/oportunidades/lote/mover', {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
    );
  }

  function etapaDe(cardId: string): number {
    const resultado = amb.pg.psqlComo('crm_migrator', `SELECT "etapa_id" FROM "oportunidades" WHERE "id" = '${cardId}'`);
    return Number(resultado.stdout.trim());
  }

  async function aguardar(condicao: () => boolean, tentativas = 50) {
    for (let i = 0; i < tentativas; i += 1) {
      if (condicao()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: C1, etapaId: 1 },
      { id: C2, etapaId: 1 },
      { id: C3, etapaId: 5 },
      { id: C4, etapaId: 5 },
      { id: C5, etapaId: 1 },
    ]);
    rota = await import('../../src/app/api/oportunidades/lote/mover/route');
    barramento = await import('../../src/lib/sse/barramento');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('move os cards que podem e lista os que não, cada um com o seu motivo @spec:AC-446', async () => {
    const resposta = await post(amb.cookieA, { ids: [C1, C2, C3], etapaDestinoId: ETAPA_1_DIA });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    expect(corpo.aplicados).toBe(2);
    expect(corpo.falhas).toBe(1);
    const porId = new Map<string, ResultadoItem>(corpo.resultados.map((r: ResultadoItem) => [r.id, r]));
    expect(porId.get(C1)?.ok).toBe(true);
    expect(porId.get(C2)?.ok).toBe(true);
    expect(porId.get(C3)).toEqual({ id: C3, ok: false, codigo: 'TRANSICAO_NAO_PERMITIDA' });

    expect(etapaDe(C1)).toBe(ETAPA_1_DIA);
    expect(etapaDe(C2)).toBe(ETAPA_1_DIA);
    expect(etapaDe(C3)).toBe(5);
  });

  test('card que exige dado que o lote não traz falha com o código do dado e fica onde estava @spec:AC-447', async () => {
    const resposta = await post(amb.cookieA, { ids: [C4], etapaDestinoId: ETAPA_FOLLOW_LONGO_PRAZO });
    const corpo = await resposta.json();

    expect(corpo.aplicados).toBe(0);
    expect(corpo.falhas).toBe(1);
    expect(corpo.resultados[0]).toEqual({ id: C4, ok: false, codigo: 'PROXIMA_ACAO_OBRIGATORIA' });
    expect(etapaDe(C4)).toBe(5);
  });

  test('lê a versão atual de cada card na hora: card com versão avançada também move @spec:AC-446', async () => {
    const preparo = amb.pg.psqlComo('crm_migrator', `UPDATE "oportunidades" SET "version" = 7 WHERE "id" = '${C5}'`);
    expect(preparo.status).toBe(0);

    const corpo = await (await post(amb.cookieA, { ids: [C5], etapaDestinoId: ETAPA_1_DIA })).json();

    expect(corpo.resultados[0]).toEqual({ id: C5, ok: true });
    expect(etapaDe(C5)).toBe(ETAPA_1_DIA);
  });

  test('card de outra empresa, inexistente e id inválido voltam "não encontrado" sem alterar nada; repetido conta uma vez @spec:AC-448', async () => {
    const outraEmpresa = amb.tenants.oportunidadeB;
    const etapaAntes = etapaDe(outraEmpresa);

    const corpo = await (
      await post(amb.cookieA, { ids: [outraEmpresa, INEXISTENTE, 'nao-e-uuid', outraEmpresa], etapaDestinoId: ETAPA_1_DIA })
    ).json();

    expect(corpo.resultados).toHaveLength(3);
    expect(corpo.resultados.every((r: ResultadoItem) => !r.ok && r.codigo === 'OPORTUNIDADE_NAO_ENCONTRADA')).toBe(true);
    expect(corpo.aplicados).toBe(0);
    expect(etapaDe(outraEmpresa)).toBe(etapaAntes);
  });

  test('lista vazia, com mais de 100 ids ou sem etapa é 400; sem sessão é 401 @spec:AC-448', async () => {
    expect((await post(amb.cookieA, { ids: [], etapaDestinoId: ETAPA_1_DIA })).status).toBe(400);
    const demais = Array.from({ length: 101 }, (_, i) => `cccccccc-2222-0000-0000-${String(i).padStart(12, '0')}`);
    expect((await post(amb.cookieA, { ids: demais, etapaDestinoId: ETAPA_1_DIA })).status).toBe(400);
    expect((await post(amb.cookieA, { ids: [C1] })).status).toBe(400);
    expect((await post(amb.cookieA, { ids: 'C1', etapaDestinoId: ETAPA_1_DIA })).status).toBe(400);
    expect((await post(null, { ids: [C1], etapaDestinoId: ETAPA_1_DIA })).status).toBe(401);
  });

  test('cada card movido emite um evento de card movido, só para a empresa dele @spec:AC-449', async () => {
    const eventosA: Array<{ tipo: string; oportunidadeId?: string }> = [];
    const eventosB: Array<{ tipo: string; oportunidadeId?: string }> = [];
    const cancelarA = barramento.getBarramento().inscrever(amb.tenants.empresaA, (evento) => eventosA.push(evento as never));
    const cancelarB = barramento.getBarramento().inscrever(amb.tenants.empresaB, (evento) => eventosB.push(evento as never));

    // Dois cards que ainda podem avançar de 2 para 3 (1º dia → 2º dia de contato).
    const corpo = await (await post(amb.cookieA, { ids: [C1, C2, C3], etapaDestinoId: 3 })).json();
    expect(corpo.aplicados).toBe(2);

    await aguardar(() => eventosA.filter((e) => e.tipo === 'oportunidade.movida').length >= 2);
    const movidos = eventosA.filter((e) => e.tipo === 'oportunidade.movida').map((e) => e.oportunidadeId);
    expect(movidos.sort()).toEqual([C1, C2].sort());
    expect(eventosB).toHaveLength(0);

    cancelarA();
    cancelarB();
  });
});
