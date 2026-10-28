// T-185 (fase4-tarefas-agenda, US-122): agendar, registrar no-show, concluir e
// reagendar, movendo o card pelas regras do funil, contra um Postgres efêmero
// real com dois tenants. Relógio fixado em 11/06/2026, 11h em São Paulo.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';
import { agendarReuniao, registrarNoShow } from '../../src/repositories/reunioes-acoes';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const ID = (n: number) => `eeeeeeee-1850-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const CARD_AGENDAR = ID(1); // etapa 6
const CARD_FORA = ID(2); // etapa 1: não pode agendar
const CARD_PASSADO = ID(3); // etapa 6
const CARD_NOSHOW = ID(4); // etapa 8 com reunião já passada
const CARD_FUTURA = ID(5); // etapa 8 com reunião futura
const CARD_CONCLUIR = ID(6); // etapa 8 com reunião passada
const CARD_REAGENDAR = ID(7); // etapa 9 (no-show) com reunião
const CARD_ATENDENTE = ID(8); // etapa 6, responsável outra pessoa
const R_NOSHOW = ID(21);
const R_FUTURA = ID(22);
const R_CONCLUIR = ID(23);
const R_REAGENDAR = ID(24);
const R_REALIZADA = ID(25);
const R_ATENDENTE = ID(26);
const OUTRA_PESSOA = 'eeeeeeee-1850-0000-0000-0000000000f9';

const AGORA = new Date('2026-06-11T14:00:00Z');
const FUTURO = '2026-06-15T17:00:00.000Z';

describe('T-185: ações da agenda', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/reunioes/route');
  let rotaNoShow: typeof import('../../src/app/api/reunioes/[id]/no-show/route');
  let rotaConcluir: typeof import('../../src/app/api/reunioes/[id]/concluir/route');
  let rotaReagendar: typeof import('../../src/app/api/reunioes/[id]/reagendar/route');
  let rotaElegiveis: typeof import('../../src/app/api/reunioes/elegiveis/route');
  let rotaUpload: typeof import('../../src/app/api/anexos/route');
  let barramento: typeof import('../../src/lib/sse/barramento');

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const etapaDe = (card: string) => Number(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`));
  const totalReunioes = () => Number(sql('SELECT count(*) FROM reunioes'));

  function post(rota: { POST: (...a: never[]) => Promise<Response> } | { POST: Function }, url: string, corpo: unknown, cookie: string | null, id?: string) {
    const request = new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(corpo ?? {}),
    });
    return (rota.POST as Function)(request, { params: Promise.resolve({ id }) }) as Promise<Response>;
  }
  const agendar = (oportunidadeId: string, agendadaPara: string, cookie: string | null = amb.cookieA) =>
    post(rotaLista, '/api/reunioes', { oportunidadeId, agendadaPara }, cookie);
  const noShow = (id: string, cookie: string | null = amb.cookieA) => post(rotaNoShow, `/api/reunioes/${id}/no-show`, {}, cookie, id);
  const concluir = (id: string, corpo: unknown, cookie: string | null = amb.cookieA) =>
    post(rotaConcluir, `/api/reunioes/${id}/concluir`, corpo, cookie, id);
  const reagendar = (id: string, agendadaPara: string, cookie: string | null = amb.cookieA) =>
    post(rotaReagendar, `/api/reunioes/${id}/reagendar`, { agendadaPara }, cookie, id);

  async function enviarAnexo(cardId: string): Promise<string> {
    const form = new FormData();
    form.set('oportunidadeId', cardId);
    form.set('arquivo', new File([preencher(PNG, 256) as BlobPart], 'ata.png', { type: 'image/png' }));
    const r = await rotaUpload.POST(new NextRequest('http://localhost/api/anexos', { method: 'POST', headers: { Cookie: amb.cookieA }, body: form }));
    expect(r.status).toBe(201);
    return (await r.json()).anexoId;
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: CARD_AGENDAR, etapaId: 6 },
      { id: CARD_FORA, etapaId: 1 },
      { id: CARD_PASSADO, etapaId: 6 },
      { id: CARD_NOSHOW, etapaId: 8 },
      { id: CARD_FUTURA, etapaId: 8 },
      { id: CARD_CONCLUIR, etapaId: 8 },
      { id: CARD_REAGENDAR, etapaId: 9 },
      { id: CARD_ATENDENTE, etapaId: 6 },
    ]);
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${OUTRA_PESSOA}', 'outra@f185.com', 'Outra Pessoa');
         UPDATE oportunidades SET responsavel_id = '${OUTRA_PESSOA}' WHERE id = '${CARD_ATENDENTE}';
         INSERT INTO reunioes (id, oportunidade_id, empresa_id, agendada_para, no_show) VALUES
           ('${R_NOSHOW}', '${CARD_NOSHOW}', '${amb.tenants.empresaA}', '2026-06-11T12:00:00Z', false),
           ('${R_FUTURA}', '${CARD_FUTURA}', '${amb.tenants.empresaA}', '2026-06-12T12:00:00Z', false),
           ('${R_CONCLUIR}', '${CARD_CONCLUIR}', '${amb.tenants.empresaA}', '2026-06-11T12:00:00Z', false),
           ('${R_REAGENDAR}', '${CARD_REAGENDAR}', '${amb.tenants.empresaA}', '2026-06-10T12:00:00Z', true),
           ('${R_ATENDENTE}', '${CARD_ATENDENTE}', '${amb.tenants.empresaA}', '2026-06-11T12:00:00Z', false);
         INSERT INTO reunioes (id, oportunidade_id, empresa_id, agendada_para, encerrada_em) VALUES
           ('${R_REALIZADA}', '${CARD_FORA}', '${amb.tenants.empresaA}', '2026-06-10T12:00:00Z', '2026-06-10T13:00:00Z');`);
    rotaLista = await import('../../src/app/api/reunioes/route');
    rotaNoShow = await import('../../src/app/api/reunioes/[id]/no-show/route');
    rotaConcluir = await import('../../src/app/api/reunioes/[id]/concluir/route');
    rotaReagendar = await import('../../src/app/api/reunioes/[id]/reagendar/route');
    rotaElegiveis = await import('../../src/app/api/reunioes/elegiveis/route');
    rotaUpload = await import('../../src/app/api/anexos/route');
    barramento = await import('../../src/lib/sse/barramento');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await amb?.parar();
  });

  test('agendar cria a reunião e leva o card de "Qualificado p/ reunião" para "Reunião agendada" @spec:AC-489', async () => {
    const r = await agendar(CARD_AGENDAR, FUTURO);
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ oportunidadeId: CARD_AGENDAR, agendadaPara: FUTURO, status: 'agendada' });
    expect(etapaDe(CARD_AGENDAR)).toBe(8);
    expect(sql(`SELECT count(*) FROM reunioes WHERE oportunidade_id = '${CARD_AGENDAR}'`)).toBe('1');
  });

  test('agendar recusa data no passado, card fora da etapa, card alheio e falta de sessão sem gravar nada @spec:AC-490', async () => {
    const antes = totalReunioes();
    const passado = await agendar(CARD_PASSADO, '2026-06-10T12:00:00.000Z');
    expect(passado.status).toBe(400);
    expect((await passado.json()).codigo).toBe('DATA_NO_PASSADO');
    expect(etapaDe(CARD_PASSADO)).toBe(6);

    const fora = await agendar(CARD_FORA, FUTURO);
    expect(fora.status).toBe(422);
    expect((await fora.json()).codigo).toBe('CARD_NAO_PODE_AGENDAR');

    const alheio = await agendar(amb.tenants.oportunidadeB, FUTURO);
    expect(alheio.status).toBe(404);
    expect((await alheio.json()).codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');

    // a lista de cards do modal traz só os de "Qualificado p/ reunião"
    const elegiveis = await rotaElegiveis.GET(new NextRequest('http://localhost/api/reunioes/elegiveis', { headers: { Cookie: amb.cookieA } }));
    const ids = (await elegiveis.json()).cards.map((c: { id: string }) => c.id);
    expect(ids).toContain(CARD_PASSADO);
    expect(ids).not.toContain(CARD_FORA);
    expect((await rotaElegiveis.GET(new NextRequest('http://localhost/api/reunioes/elegiveis'))).status).toBe(401);

    expect((await agendar(CARD_PASSADO, FUTURO, null)).status).toBe(401);
    expect(totalReunioes()).toBe(antes);
  });

  test('no-show marca a reunião e leva o card para "No-show"; antes do horário e com resultado é recusado @spec:AC-491', async () => {
    const cedo = await noShow(R_FUTURA);
    expect(cedo.status).toBe(422);
    expect((await cedo.json()).codigo).toBe('AINDA_NAO_ACONTECEU');
    expect(etapaDe(CARD_FUTURA)).toBe(8);

    const jaTem = await noShow(R_REALIZADA);
    expect(jaTem.status).toBe(422);
    expect((await jaTem.json()).codigo).toBe('REUNIAO_JA_TEM_RESULTADO');

    const ok = await noShow(R_NOSHOW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: R_NOSHOW, noShow: true, status: 'no_show' });
    expect(etapaDe(CARD_NOSHOW)).toBe(9);
  });

  test('concluir exige a evidência do card e, com ela, grava o resumo e leva o card para "Reunião realizada" @spec:AC-492', async () => {
    const sem = await concluir(R_CONCLUIR, { resumo: 'Foi ótima' });
    expect(sem.status).toBe(422);
    expect((await sem.json()).codigo).toBe('EVIDENCIA_OBRIGATORIA');
    expect(etapaDe(CARD_CONCLUIR)).toBe(8);
    expect(sql(`SELECT encerrada_em IS NULL FROM reunioes WHERE id = '${R_CONCLUIR}'`)).toBe('t');

    const longo = await concluir(R_CONCLUIR, { resumo: 'x'.repeat(2001) });
    expect(longo.status).toBe(400);

    const anexoId = await enviarAnexo(CARD_CONCLUIR);
    const ok = await concluir(R_CONCLUIR, { resumo: '  Foi ótima  ', anexoId });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: R_CONCLUIR, status: 'realizada', resumo: 'Foi ótima', anexoId });
    expect(etapaDe(CARD_CONCLUIR)).toBe(10);
  });

  test('reagendar do "No-show" cria outra reunião ligada à anterior e volta o card para "Reunião agendada" @spec:AC-493', async () => {
    const passado = await reagendar(R_REAGENDAR, '2026-06-10T12:00:00.000Z');
    expect(passado.status).toBe(400);
    expect((await passado.json()).codigo).toBe('DATA_NO_PASSADO');

    const realizada = await reagendar(R_REALIZADA, FUTURO);
    expect(realizada.status).toBe(422);
    expect((await realizada.json()).codigo).toBe('REUNIAO_JA_TEM_RESULTADO');
    expect(etapaDe(CARD_REAGENDAR)).toBe(9);

    const ok = await reagendar(R_REAGENDAR, FUTURO);
    expect(ok.status).toBe(200);
    const nova = await ok.json();
    expect(nova).toMatchObject({ remarcadaDe: R_REAGENDAR, agendadaPara: FUTURO, status: 'agendada' });
    expect(nova.id).not.toBe(R_REAGENDAR);
    expect(etapaDe(CARD_REAGENDAR)).toBe(8);

    // a anterior aparece como "Remarcada" na agenda
    const lista = await rotaLista.GET(
      new NextRequest('http://localhost/api/reunioes?de=2026-06-08&ate=2026-06-14', { headers: { Cookie: amb.cookieA } })
    );
    const anterior = (await lista.json()).reunioes.find((x: { id: string }) => x.id === R_REAGENDAR);
    expect(anterior.status).toBe('remarcada');

    // reagendar de novo a que já foi remarcada é recusado
    expect((await reagendar(R_REAGENDAR, FUTURO)).status).toBe(422);
  });

  test('reunião alheia, id inválido e falta de sessão não alteram nada; ATENDENTE só age nos próprios cards @spec:AC-494', async () => {
    expect((await noShow(R_NOSHOW, null)).status).toBe(401);
    expect((await concluir(R_CONCLUIR, {}, null)).status).toBe(401);
    expect((await reagendar(R_FUTURA, FUTURO, null)).status).toBe(401);

    // reunião da empresa A vista pela empresa B: "não encontrada"
    const daB = await noShow(R_FUTURA, amb.cookieB);
    expect(daB.status).toBe(404);
    expect((await daB.json()).codigo).toBe('REUNIAO_NAO_ENCONTRADA');
    expect((await noShow('nao-uuid')).status).toBe(404);

    // ATENDENTE (mesma empresa) que não é o responsável do card
    const atendente: ContextoTenant = {
      usuarioId: 'eeeeeeee-1850-0000-0000-0000000000a1',
      empresaId: amb.tenants.empresaA,
      papel: 'ATENDENTE',
      isSuperAdmin: false,
    };
    const agendarAlheio = await agendarReuniao(amb.db, atendente, { oportunidadeId: CARD_ATENDENTE, agendadaPara: new Date(FUTURO), agora: AGORA });
    expect(agendarAlheio).toEqual({ ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
    const noShowAlheio = await registrarNoShow(amb.db, atendente, R_ATENDENTE, AGORA);
    expect(noShowAlheio).toEqual({ ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' });
    expect(etapaDe(CARD_ATENDENTE)).toBe(6);
  });

  test('cada mudança de etapa da agenda avisa só a empresa dela @spec:AC-495', async () => {
    const card = ID(9);
    sql(`INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id) VALUES ('${card}', '${amb.tenants.empresaA}', '${amb.tenants.leadA}', 6)`);
    const eventosA: Array<{ tipo: string; oportunidadeId?: string }> = [];
    const eventosB: Array<{ tipo: string }> = [];
    const cancelarA = barramento.getBarramento().inscrever(amb.tenants.empresaA, (e) => eventosA.push(e as never));
    const cancelarB = barramento.getBarramento().inscrever(amb.tenants.empresaB, (e) => eventosB.push(e as never));

    expect((await agendar(card, FUTURO)).status).toBe(201);
    for (let i = 0; i < 50 && !eventosA.some((e) => e.tipo === 'oportunidade.movida'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(eventosA.filter((e) => e.tipo === 'oportunidade.movida').map((e) => e.oportunidadeId)).toEqual([card]);
    expect(eventosB).toHaveLength(0);
    cancelarA();
    cancelarB();
  });
});
