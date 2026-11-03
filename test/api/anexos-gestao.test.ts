// T-294 (fase4-card-abas, US-112): tornar evidência, remover evidência e excluir anexo contra um Postgres efêmero real, dois
// tenants e um volume temporário. Os anexos entram pela própria rota de upload, como na vida real.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ETAPA_CARD = 1; // etapa do card seedado (ETAPA_SEM_EXIGENCIAS), conferida abaixo contra o banco
const INEXISTENTE = 'aaaaaaaa-1111-4111-8111-00000000ffff';

describe('T-294: evidência e exclusão de anexos', () => {
  let amb: AmbienteAnexos;
  let upload: typeof import('../../src/app/api/anexos/route');
  let evidencia: typeof import('../../src/app/api/anexos/[id]/evidencia/route');
  let anexo: typeof import('../../src/app/api/anexos/[id]/route');
  let lista: typeof import('../../src/app/api/oportunidades/[id]/anexos/route');
  let linhaDoTempo: typeof import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');
  let atendente: string;
  let outroAtendente: string;
  let etapaDoCard: number;

  const sql = (texto: string) => {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const cardA = () => amb.tenants.oportunidadeA;

  async function enviar(cookie: string, nome: string, extra = 0): Promise<string> {
    const form = new FormData();
    form.set('oportunidadeId', cardA());
    form.set('arquivo', new File([new Uint8Array(preencher(PNG, 64 + extra))], nome, { type: 'image/png' }));
    const r = await upload.POST(new NextRequest('http://localhost/api/anexos', { method: 'POST', headers: { Cookie: cookie }, body: form }));
    expect(r.status).toBe(201);
    return (await r.json()).anexoId;
  }
  const chamar = <T,>(rota: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<T>, id: string, metodo: string, cookie: string | null) =>
    rota(new NextRequest(`http://localhost/api/anexos/${id}`, { method: metodo, headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ id }) });
  const tornar = (id: string, cookie: string | null = atendente) => chamar(evidencia.POST, id, 'POST', cookie);
  const remover = (id: string, cookie: string | null = atendente) => chamar(evidencia.DELETE, id, 'DELETE', cookie);
  const excluir = (id: string, cookie: string | null = atendente) => chamar(anexo.DELETE, id, 'DELETE', cookie);
  async function doCard(cookie: string = atendente) {
    const r = await lista.GET(new NextRequest(`http://localhost/api/oportunidades/${cardA()}/anexos`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: cardA() }) });
    return (await r.json()).anexos as Array<{ id: string; evidencia: { etapaId: number; etapaNome: string } | null; podeExcluir: boolean }>;
  }
  const eventos = (tipo: string) => sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = '${tipo}'`);

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.anexos@teste.com', 'ATENDENTE');
    outroAtendente = await cookieDePapel(amb, 'atendente2.anexos@teste.com', 'ATENDENTE');
    upload = await import('../../src/app/api/anexos/route');
    evidencia = await import('../../src/app/api/anexos/[id]/evidencia/route');
    anexo = await import('../../src/app/api/anexos/[id]/route');
    lista = await import('../../src/app/api/oportunidades/[id]/anexos/route');
    linhaDoTempo = await import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');
    etapaDoCard = Number(sql(`SELECT etapa_id FROM oportunidades WHERE id = '${cardA()}'`));
    expect(etapaDoCard).toBe(ETAPA_CARD);
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('tornar evidência marca o anexo com a etapa atual do card, registra o evento e repetir não registra de novo @spec:AC-752', async () => {
    const id = await enviar(atendente, 'print-1.png');
    expect((await tornar(id, null)).status).toBe(401);
    expect((await tornar(INEXISTENTE)).status).toBe(404);
    expect((await tornar('nao-e-uuid')).status).toBe(404);

    const r = await tornar(id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ alterado: true });
    const marcado = (await doCard()).find((a) => a.id === id)!;
    expect(marcado.evidencia?.etapaId).toBe(etapaDoCard);
    expect(sql(`SELECT ator_tipo || '|' || (ator_id IS NOT NULL) || '|' || etapa_destino_id FROM oportunidade_eventos WHERE tipo = 'evidencia_marcada' AND oportunidade_id = '${cardA()}'`)).toBe(`usuario|true|${etapaDoCard}`);

    expect(await (await tornar(id)).json()).toEqual({ alterado: false });
    expect(eventos('evidencia_marcada')).toBe('1');
  });

  test('remover evidência desfaz (vale o último evento), vale para evidência de transição também, e o histórico fica @spec:AC-753', async () => {
    const id = await enviar(atendente, 'print-2.png', 1);
    await tornar(id);
    const r = await remover(id);
    expect(await r.json()).toEqual({ alterado: true });
    expect((await doCard()).find((a) => a.id === id)!.evidencia).toBeNull();
    expect(await (await remover(id)).json()).toEqual({ alterado: false });
    expect(eventos('evidencia_removida')).toBe('1');

    await tornar(id); // marcar de novo depois de remover volta a valer
    expect((await doCard()).find((a) => a.id === id)!.evidencia).not.toBeNull();

    const daTransicao = await enviar(atendente, 'da-transicao.png', 2);
    sql(`INSERT INTO oportunidade_eventos (empresa_id, oportunidade_id, tipo, etapa_destino_id, ator_tipo, payload)
         VALUES ('${amb.tenants.empresaA}', '${cardA()}', 'transicao_etapa', 10, 'sistema', '{"anexoId":"${daTransicao}"}'::jsonb)`);
    expect((await doCard()).find((a) => a.id === daTransicao)!.evidencia?.etapaNome).toBe('Reunião realizada');
    await remover(daTransicao);
    expect((await doCard()).find((a) => a.id === daTransicao)!.evidencia).toBeNull();
    expect(eventos('transicao_etapa')).toBe('1'); // o registro da transição continua lá
  });

  test('excluir apaga o registro e o arquivo, e deixa na linha do tempo o nome, o tipo, o tamanho e o SHA-256 @spec:AC-754', async () => {
    const id = await enviar(atendente, 'apagar.png', 3);
    const caminho = sql(`SELECT caminho FROM anexos WHERE id = '${id}'`);
    const hash = sql(`SELECT hash FROM anexos WHERE id = '${id}'`);
    await expect(access(path.join(amb.volume, caminho))).resolves.toBeUndefined();

    expect((await excluir(id, null)).status).toBe(401);
    const r = await excluir(id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ excluido: true });
    expect(sql(`SELECT count(*) FROM anexos WHERE id = '${id}'`)).toBe('0');
    await expect(access(path.join(amb.volume, caminho))).rejects.toThrow();

    expect(sql(`SELECT payload->>'nome' || '|' || (payload->>'hash' = '${hash}') || '|' || (payload->>'tamanho') FROM oportunidade_eventos WHERE tipo = 'anexo_excluido' AND oportunidade_id = '${cardA()}'`)).toBe('apagar.png|true|67');
    const tl = await linhaDoTempo.GET(new NextRequest(`http://localhost/api/oportunidades/${cardA()}/linha-do-tempo`, { headers: { Cookie: atendente } }), { params: Promise.resolve({ id: cardA() }) });
    const textos = (await tl.json()).itens.map((i: { texto: string }) => i.texto) as string[];
    expect(textos.some((t) => t.startsWith('Anexo "apagar.png" excluído (SHA-256 '))).toBe(true);
    expect(textos.some((t) => t.includes('marcado como evidência da etapa'))).toBe(true);

    expect((await excluir(id)).status).toBe(404);
  });

  test('anexo que é evidência não é excluído até a evidência ser removida @spec:AC-755', async () => {
    const id = await enviar(atendente, 'prova.png', 4);
    await tornar(id);

    const recusada = await excluir(id);
    expect(recusada.status).toBe(409);
    expect((await recusada.json()).codigo).toBe('ANEXO_E_EVIDENCIA');
    expect(sql(`SELECT count(*) FROM anexos WHERE id = '${id}'`)).toBe('1');

    await remover(id);
    expect((await excluir(id)).status).toBe(200);
  });

  test('só gestor exclui anexo dos outros; cada um exclui os seus; a lista diz quem pode @spec:AC-755', async () => {
    const doAtendente = await enviar(atendente, 'meu.png', 5);
    const doGerente = await enviar(amb.cookieA, 'do-gerente.png', 6);

    const visaoAtendente = await doCard(atendente);
    expect(visaoAtendente.find((a) => a.id === doAtendente)!.podeExcluir).toBe(true);
    expect(visaoAtendente.find((a) => a.id === doGerente)!.podeExcluir).toBe(false);
    const visaoOutro = await doCard(outroAtendente);
    expect(visaoOutro.find((a) => a.id === doAtendente)!.podeExcluir).toBe(false);
    const visaoGerente = await doCard(amb.cookieA);
    expect(visaoGerente.every((a) => a.podeExcluir)).toBe(true);

    const negada = await excluir(doGerente, atendente);
    expect(negada.status).toBe(403);
    expect((await negada.json()).codigo).toBe('SEM_PERMISSAO');
    expect((await excluir(doAtendente, outroAtendente)).status).toBe(403);
    expect(sql(`SELECT count(*) FROM anexos WHERE id IN ('${doAtendente}', '${doGerente}')`)).toBe('2');

    expect((await excluir(doAtendente, amb.cookieA)).status).toBe(200); // gestor exclui o do atendente
    expect((await excluir(doGerente, amb.cookieA)).status).toBe(200);
  });

  test('anexo de outra empresa não é marcado nem excluído @spec:AC-755', async () => {
    const id = await enviar(atendente, 'so-da-a.png', 7);
    expect((await tornar(id, amb.cookieB)).status).toBe(404);
    expect((await remover(id, amb.cookieB)).status).toBe(404);
    expect((await excluir(id, amb.cookieB)).status).toBe(404);
    expect(sql(`SELECT count(*) FROM anexos WHERE id = '${id}'`)).toBe('1');
    expect((await doCard()).find((a) => a.id === id)!.evidencia).toBeNull();
  });
});
