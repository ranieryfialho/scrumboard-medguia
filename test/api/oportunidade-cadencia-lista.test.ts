// Testes de T-170 (fase4-card-abas, US-113): GET /api/oportunidades/:id/cadencia
// — os 18 toques da cadência do card (aba "Cadência", tela 10), contra um
// Postgres 15 efêmero real com dois tenants (test/support/api-anexos.ts).
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

const CARD_INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

interface ToqueResposta {
  sequencia: number;
  dia: number;
  turno: string;
  canal: string;
  tipo: string;
  estado: 'concluido' | 'cancelado' | 'da_vez' | 'programado';
  atividadeId: string | null;
  resultado: string | null;
  realizadaPor: { id: string; nome: string } | null;
}

describe('T-170: listagem da cadência do card (servidor)', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/oportunidades/[id]/cadencia/route');
  let rotaIniciar: typeof import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');

  function get(cookie: string | null, cardId: string) {
    const headers = cookie ? { Cookie: cookie } : undefined;
    const request = new NextRequest(`http://localhost/api/oportunidades/${cardId}/cadencia`, { headers });
    return rotaLista.GET(request, { params: Promise.resolve({ id: cardId }) });
  }

  async function iniciar(cookie: string, cardId: string, version: number) {
    const request = new NextRequest(`http://localhost/api/oportunidades/${cardId}/cadencia/iniciar`, {
      method: 'POST',
      headers: { Cookie: cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    const resposta = await rotaIniciar.POST(request, { params: Promise.resolve({ id: cardId }) });
    expect(resposta.status).toBe(200);
  }

  function sql(comando: string) {
    const resultado = amb.pg.psqlComo('crm_migrator', comando);
    if (resultado.status !== 0) throw new Error(`Falha no SQL de preparo: ${resultado.stderr}`);
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    rotaLista = await import('../../src/app/api/oportunidades/[id]/cadencia/route');
    rotaIniciar = await import('../../src/app/api/oportunidades/[id]/cadencia/iniciar/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('card sem cadência iniciada: 200 com a matriz toda "programado" e situação "nao_iniciada" @spec:AC-430', async () => {
    const resposta = await get(amb.cookieB, amb.tenants.oportunidadeB);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    expect(corpo.iniciada).toBe(false);
    expect(corpo.situacao).toBe('nao_iniciada');
    expect(corpo.total).toBe(18);
    expect(corpo.concluidos).toBe(0);
    expect(corpo.toqueDaVez).toBeNull();
    expect(corpo.toques).toHaveLength(18);
    expect(corpo.toques.every((t: ToqueResposta) => t.estado === 'programado' && t.atividadeId === null)).toBe(true);
  });

  test('cadência iniciada: devolve os 18 toques em ordem, com o 1º como "da vez" e os futuros da matriz @spec:AC-430', async () => {
    await iniciar(amb.cookieA, amb.tenants.oportunidadeA, 1);

    const resposta = await get(amb.cookieA, amb.tenants.oportunidadeA);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    expect(corpo.iniciada).toBe(true);
    expect(corpo.toques.map((t: ToqueResposta) => t.sequencia)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));

    const primeiros = corpo.toques.slice(0, 3) as ToqueResposta[];
    expect(primeiros.every((t) => t.dia === 1 && t.turno === 'manha')).toBe(true);
    expect(primeiros[0].estado).toBe('da_vez');
    expect(primeiros[0].atividadeId).toBeTruthy();
    // 2º e 3º já existem no banco mas não são a vez; do 4º em diante só existem na matriz.
    expect(primeiros[1].estado).toBe('programado');
    expect(primeiros[1].atividadeId).toBeTruthy();
    expect(corpo.toques[3].atividadeId).toBeNull();
    expect(corpo.toques[17].tipo).toBe('breakup');

    expect(corpo.toqueDaVez.sequencia).toBe(1);
    expect(corpo.oportunidade.id).toBe(amb.tenants.oportunidadeA);
    expect(typeof corpo.oportunidade.version).toBe('number');
  });

  test('o resumo conta concluídos, "conectou" e "sem resposta" e diz quem concluiu o toque @spec:AC-431', async () => {
    const empresa = amb.tenants.empresaA;
    const card = amb.tenants.oportunidadeA;
    sql(
      `UPDATE "cadencia_atividades" SET "resultado" = 'conectou', "realizada_em" = now(),
         "realizada_por" = (SELECT "usuario_id" FROM "empresas_usuarios" WHERE "empresa_id" = '${empresa}' LIMIT 1)
       WHERE "oportunidade_id" = '${card}' AND "sequencia" = 1;
       UPDATE "cadencia_atividades" SET "resultado" = 'sem_resposta', "realizada_em" = now()
       WHERE "oportunidade_id" = '${card}' AND "sequencia" = 2;`
    );

    const corpo = await (await get(amb.cookieA, card)).json();

    expect(corpo.concluidos).toBe(2);
    expect(corpo.conectou).toBe(1);
    expect(corpo.semResposta).toBe(1);
    expect(corpo.toques[0].estado).toBe('concluido');
    expect(corpo.toques[0].resultado).toBe('conectou');
    expect(corpo.toques[0].realizadaPor?.nome).toBeTruthy();
    expect(corpo.toques[2].estado).toBe('da_vez');
    expect(corpo.toqueDaVez.sequencia).toBe(3);
    expect(corpo.situacao).toBe('em_andamento');
  });

  test('toque pendente liberado antes do turno de referência vira "atrasada" @spec:AC-431', async () => {
    sql(
      `UPDATE "cadencia_atividades" SET "liberada_em" = now() - interval '3 days'
       WHERE "oportunidade_id" = '${amb.tenants.oportunidadeA}' AND "sequencia" = 3;`
    );

    const corpo = await (await get(amb.cookieA, amb.tenants.oportunidadeA)).json();

    expect(corpo.toques[2].atrasado).toBe(true);
    expect(corpo.situacao).toBe('atrasada');
  });

  test('cadência encerrada: situação "encerrada" e nenhum toque da vez @spec:AC-431', async () => {
    sql(`UPDATE "oportunidades" SET "cadencia_encerrada_em" = now() WHERE "id" = '${amb.tenants.oportunidadeA}';`);

    const corpo = await (await get(amb.cookieA, amb.tenants.oportunidadeA)).json();

    expect(corpo.encerrada).toBe(true);
    expect(corpo.situacao).toBe('encerrada');
    expect(corpo.toqueDaVez).toBeNull();
  });

  test('um toque gravado com dia e turno fora da régua continua na posição da matriz @spec:AC-432', async () => {
    sql(
      `UPDATE "cadencia_atividades" SET "dia" = 3, "turno" = 'tarde'
       WHERE "oportunidade_id" = '${amb.tenants.oportunidadeA}' AND "sequencia" = 3;`
    );

    const corpo = await (await get(amb.cookieA, amb.tenants.oportunidadeA)).json();
    const terceiro = corpo.toques[2] as ToqueResposta;

    expect(terceiro.sequencia).toBe(3);
    expect(terceiro.dia).toBe(1);
    expect(terceiro.turno).toBe('manha');
    // Cada dia e turno da régua continua com exatamente 3 toques.
    const porBloco = new Map<string, number>();
    for (const toque of corpo.toques as ToqueResposta[]) {
      porBloco.set(`${toque.dia}-${toque.turno}`, (porBloco.get(`${toque.dia}-${toque.turno}`) ?? 0) + 1);
    }
    expect([...porBloco.values()]).toEqual([3, 3, 3, 3, 3, 3]);
  });

  test('card de outra empresa ou inexistente: 404; sem sessão: 401 @spec:AC-430', async () => {
    expect((await get(amb.cookieA, amb.tenants.oportunidadeB)).status).toBe(404);
    expect((await get(amb.cookieA, CARD_INEXISTENTE)).status).toBe(404);
    expect((await get(amb.cookieA, 'nao-e-uuid')).status).toBe(404);
    expect((await get(null, amb.tenants.oportunidadeA)).status).toBe(401);
  });
});
