// T-269 (fase5-email-disparo, US-172/US-173): pausar, retomar, as proteções da pausa e o iniciar sem chave, pelas rotas,
// contra um Postgres efêmero real com dois tenants. Cobre AC-709, AC-710, AC-711 e AC-713.
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { gravarConfiguracaoDeEmail } from '../../src/repositories/email-config';

const SEGREDO = 'segredo-de-teste-para-pausa-1234567890';
const ID = (n: number) => `c9c9c9c9-7240-0000-0000-${String(n).padStart(12, '0')}`;

describe('T-269: pausar, retomar e iniciar com chave', () => {
  let amb: AmbienteAnexos;
  let gerente: string;
  let gerenteB: string;
  let atendente: string;
  let sequencia = 0;
  type Manipulador = (request: NextRequest, contexto: { params: Promise<{ id: string }> }) => Promise<Response>;
  const rotas: Record<string, { POST?: Manipulador; DELETE?: Manipulador; GET?: Manipulador }> = {};

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  function novaCampanha(status: string, statusDosEnvios: string[]) {
    sequencia += 1;
    const id = ID(sequencia * 100);
    sql(`INSERT INTO campanhas (id, empresa_id, nome, assunto, corpo_html, status) VALUES ('${id}', '${amb.tenants.empresaA}', 'Camp ${sequencia}', 'Assunto', '<p>Oi</p>', '${status}')`);
    statusDosEnvios.forEach((st, i) => {
      sql(`INSERT INTO envios_campanha (id, empresa_id, campanha_id, nome_destinatario, email_destinatario, status) VALUES ('${ID(sequencia * 100 + 1 + i)}', '${amb.tenants.empresaA}', '${id}', 'N${i}', 'e${i}@teste.com', '${st}')`);
    });
    return id;
  }
  const acao = (rota: string, id: string, cookie: string | null = gerente, metodo = 'POST') =>
    rotas[rota][metodo as 'POST' | 'DELETE']!(new NextRequest(`http://localhost/api/campanhas/${id}${rota === 'raiz' ? '' : `/${rota}`}`, { method: metodo, headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ id }) });
  const statusDosEnvios = (id: string) => sql(`SELECT string_agg(status, ',' ORDER BY email_destinatario) FROM envios_campanha WHERE campanha_id = '${id}'`);
  const statusDaCampanha = (id: string) => sql(`SELECT status FROM campanhas WHERE id = '${id}'`);

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f709@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f709@teste.com', 'GERENTE', amb.tenants.empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f709@teste.com', 'ATENDENTE');
    rotas.pausar = await import('../../src/app/api/campanhas/[id]/pausar/route');
    rotas.retomar = await import('../../src/app/api/campanhas/[id]/retomar/route');
    rotas.iniciar = await import('../../src/app/api/campanhas/[id]/iniciar/route');
    rotas['reenviar-falhas'] = await import('../../src/app/api/campanhas/[id]/reenviar-falhas/route');
    rotas.raiz = await import('../../src/app/api/campanhas/[id]/route');
  }, 180_000);
  afterEach(() => {
    sql('DELETE FROM campanhas;');
  });
  afterAll(async () => {
    await amb?.parar();
  });

  test('pausar: a campanha vira PAUSADA e os PENDENTE viram PAUSADO na mesma transação, e a resposta traz quantos @spec:AC-709', async () => {
    const id = novaCampanha('PROCESSANDO', ['PENDENTE', 'PENDENTE', 'ENVIANDO', 'ENVIADO']);
    const r = await acao('pausar', id);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id, status: 'PAUSADA', totalPausados: 2 });
    expect(statusDaCampanha(id)).toBe('PAUSADA');
    expect(statusDosEnvios(id)).toBe('PAUSADO,PAUSADO,ENVIANDO,ENVIADO'); // o ENVIANDO termina sozinho
  });

  test('pausar recusa o que não está em andamento (422), outra empresa (404) e atendente (403) @spec:AC-709', async () => {
    const rascunho = novaCampanha('RASCUNHO', ['RASCUNHO']);
    const r = await acao('pausar', rascunho);
    expect(r.status).toBe(422);
    expect((await r.json()).codigo).toBe('CAMPANHA_NAO_PROCESSANDO');
    expect(statusDaCampanha(rascunho)).toBe('RASCUNHO');

    const andamento = novaCampanha('PROCESSANDO', ['PENDENTE']);
    expect((await acao('pausar', andamento, gerenteB)).status).toBe(404); // de outra empresa
    expect((await acao('pausar', andamento, atendente)).status).toBe(403);
    expect((await acao('pausar', andamento, null)).status).toBe(401);
    expect(statusDaCampanha(andamento)).toBe('PROCESSANDO');
    expect(statusDosEnvios(andamento)).toBe('PENDENTE');
    expect((await acao('pausar', ID(9999))).status).toBe(404);
  });

  test('retomar: volta a PROCESSANDO e os PAUSADO voltam a PENDENTE; recusa o que não está pausado, outra empresa e atendente @spec:AC-710', async () => {
    const id = novaCampanha('PAUSADA', ['PAUSADO', 'PAUSADO', 'ENVIADO']);
    expect((await acao('retomar', id, atendente)).status).toBe(403);
    expect((await acao('retomar', id, gerenteB)).status).toBe(404);
    const r = await acao('retomar', id);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id, status: 'PROCESSANDO', totalRetomados: 2 });
    expect(statusDosEnvios(id)).toBe('PENDENTE,PENDENTE,ENVIADO');

    const naoPausada = await acao('retomar', id); // agora está PROCESSANDO
    expect(naoPausada.status).toBe(422);
    expect((await naoPausada.json()).codigo).toBe('CAMPANHA_NAO_PAUSADA');
  });

  test('a campanha pausada não finaliza, não é excluída e não aceita "Reenviar falhas" @spec:AC-711', async () => {
    const id = novaCampanha('PAUSADA', ['PAUSADO', 'ERRO']);

    const detalhe = await rotas.raiz.GET!(new NextRequest(`http://localhost/api/campanhas/${id}`, { headers: { Cookie: gerente } }), { params: Promise.resolve({ id }) });
    expect(detalhe.status).toBe(200);
    expect((await detalhe.json()).campanha.status).toBe('PAUSADA'); // abrir a tela não finaliza
    expect(statusDaCampanha(id)).toBe('PAUSADA');

    const excluir = await acao('raiz', id, gerente, 'DELETE');
    expect(excluir.status).toBe(422);
    expect(sql(`SELECT count(*) FROM campanhas WHERE id = '${id}'`)).toBe('1');

    const reenviar = await acao('reenviar-falhas', id);
    expect(reenviar.status).toBe(422);
    expect((await reenviar.json()).codigo).toBe('CAMPANHA_PAUSADA');
    expect(statusDosEnvios(id)).toBe('PAUSADO,ERRO'); // nada foi despausado nem devolvido à fila
    expect(statusDaCampanha(id)).toBe('PAUSADA');
  });

  test('iniciar sem a chave do Resend da empresa: 409 CHAVE_RESEND_NAO_CONFIGURADA e nada muda; com a chave, inicia @spec:AC-713', async () => {
    const id = novaCampanha('RASCUNHO', ['RASCUNHO', 'RASCUNHO']);
    const recusa = await acao('iniciar', id);
    expect(recusa.status).toBe(409);
    expect((await recusa.json()).codigo).toBe('CHAVE_RESEND_NAO_CONFIGURADA');
    expect(statusDaCampanha(id)).toBe('RASCUNHO');
    expect(statusDosEnvios(id)).toBe('RASCUNHO,RASCUNHO');

    await gravarConfiguracaoDeEmail(amb.db, { empresaId: amb.tenants.empresaA }, { chave: 're_AAAAAAAAAAAAAAAAAAAAAAAAAAAA1111' }, SEGREDO);
    const ok = await acao('iniciar', id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'PROCESSANDO', totalLiberados: 2 });
    expect(statusDosEnvios(id)).toBe('PENDENTE,PENDENTE');
  });
});
