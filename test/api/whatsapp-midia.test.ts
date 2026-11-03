// T-290 (fase4-card-abas, US-114): áudio e arquivos na conversa — o envio (`POST /api/whatsapp/send-midia`) e a abertura
// (`GET /api/whatsapp/midia/:id`) contra um Postgres efêmero real, com dois tenants e uma Evolution falsa que grava o que recebe.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const NUMERO = '5511988887777';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const WAV_DA_EVOLUTION = Buffer.from('RIFF....WAVEfmt-bytes-do-audio-recebido');

interface Chamada {
  caminho: string;
  corpo: Record<string, unknown>;
}

describe('T-290: mídia na conversa do WhatsApp', () => {
  let amb: AmbienteAnexos;
  let servidor: Server;
  let chamadas: Chamada[];
  let respostaDoEnvio: { status: number; corpo: unknown };
  let enviar: typeof import('../../src/app/api/whatsapp/send-midia/route');
  let abrir: typeof import('../../src/app/api/whatsapp/midia/[id]/route');
  let historico: typeof import('../../src/app/api/whatsapp/messages/route');
  let atendente: string;
  let gerenteB: string;
  const ambienteOriginal = { url: process.env.EVOLUTION_API_URL, chave: process.env.EVOLUTION_API_KEY };

  const sql = (texto: string) => {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };

  function postar(campos: Record<string, string | undefined>, arquivo?: { bytes: Buffer; nome: string; tipo: string }, cookie: string | null = atendente) {
    const formulario = new FormData();
    for (const [chave, valor] of Object.entries(campos)) if (valor !== undefined) formulario.set(chave, valor);
    if (arquivo) formulario.set('arquivo', new File([new Uint8Array(arquivo.bytes)], arquivo.nome, { type: arquivo.tipo }));
    return enviar.POST(new NextRequest('http://localhost/api/whatsapp/send-midia', { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body: formulario }));
  }
  const abrirMidia = (id: string, cookie: string | null = atendente, cabecalhos: Record<string, string> = {}) =>
    abrir.GET(new NextRequest(`http://localhost/api/whatsapp/midia/${id}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...cabecalhos } }), {
      params: Promise.resolve({ id }),
    });
  const leadA = () => amb.tenants.leadA;
  const ultimaMensagem = () => sql(`SELECT id FROM whatsapp_mensagens ORDER BY criado_em DESC LIMIT 1`);

  beforeAll(async () => {
    chamadas = [];
    respostaDoEnvio = { status: 201, corpo: { key: { id: 'EVO-ENVIADA' } } };
    servidor = createServer((req, res) => {
      let texto = '';
      req.on('data', (c) => (texto += c));
      req.on('end', () => {
        chamadas.push({ caminho: req.url ?? '', corpo: texto ? JSON.parse(texto) : {} });
        res.setHeader('content-type', 'application/json');
        if ((req.url ?? '').startsWith('/chat/getBase64FromMediaMessage')) {
          res.end(JSON.stringify({ base64: `data:audio/ogg;base64,${WAV_DA_EVOLUTION.toString('base64')}`, mimetype: 'audio/ogg; codecs=opus' }));
          return;
        }
        res.statusCode = respostaDoEnvio.status;
        res.end(JSON.stringify(respostaDoEnvio.corpo));
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    process.env.EVOLUTION_API_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    process.env.EVOLUTION_API_KEY = 'chave-de-teste';

    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.midia@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.midia@teste.com', 'GERENTE', amb.tenants.empresaB);
    sql(`UPDATE leads SET telefone_e164 = '${NUMERO}' WHERE id = '${leadA()}'`);
    sql(`UPDATE leads SET telefone_e164 = '5511900001111' WHERE id = '${amb.tenants.leadB}'`);
    sql(`INSERT INTO empresa_configuracoes (empresa_id, chave, valor) VALUES ('${amb.tenants.empresaA}', 'evolution_instance_name', '"inst-a"'::jsonb)`);
    enviar = await import('../../src/app/api/whatsapp/send-midia/route');
    abrir = await import('../../src/app/api/whatsapp/midia/[id]/route');
    historico = await import('../../src/app/api/whatsapp/messages/route');
  }, 180_000);
  afterAll(async () => {
    if (ambienteOriginal.url === undefined) delete process.env.EVOLUTION_API_URL;
    else process.env.EVOLUTION_API_URL = ambienteOriginal.url;
    if (ambienteOriginal.chave === undefined) delete process.env.EVOLUTION_API_KEY;
    else process.env.EVOLUTION_API_KEY = ambienteOriginal.chave;
    await new Promise((ok) => servidor?.close(ok));
    await amb?.parar();
  });

  test('o áudio gravado vai como mensagem de voz, fica guardado e volta igual ao abrir, com Range @spec:AC-744', async () => {
    const audio = Buffer.from('bytes-do-audio-gravado-0123456789');
    const r = await postar({ modo: 'audio', leadId: leadA() }, { bytes: audio, nome: 'audio.webm', tipo: 'audio/webm' });
    expect(r.status).toBe(200);

    const envio = chamadas.at(-1)!;
    expect(envio.caminho).toBe('/message/sendWhatsAppAudio/inst-a');
    expect(envio.corpo).toEqual({ number: NUMERO, audio: audio.toString('base64') });
    expect(sql(`SELECT mensagem || '|' || direcao || '|' || midia_tipo || '|' || midia_mimetype || '|' || evolution_message_id FROM whatsapp_mensagens ORDER BY criado_em DESC LIMIT 1`)).toBe(
      '[áudio]|enviada|audio|audio/webm|EVO-ENVIADA'
    );

    const aberto = await abrirMidia(ultimaMensagem());
    expect(aberto.status).toBe(200);
    expect(aberto.headers.get('content-type')).toBe('audio/webm');
    expect(aberto.headers.get('x-content-type-options')).toBe('nosniff');
    expect(aberto.headers.get('content-disposition')).toMatch(/^inline/);
    expect(Buffer.from(await aberto.arrayBuffer()).equals(audio)).toBe(true);

    const parcial = await abrirMidia(ultimaMensagem(), atendente, { range: 'bytes=3-8' });
    expect(parcial.status).toBe(206);
    expect(parcial.headers.get('content-range')).toBe(`bytes 3-8/${audio.length}`);
    expect(Buffer.from(await parcial.arrayBuffer()).toString()).toBe(audio.subarray(3, 9).toString());
    expect((await abrirMidia(ultimaMensagem(), atendente, { range: 'bytes=999-1000' })).status).toBe(416);
  });

  test('imagem com legenda e documento vão por sendMedia, com o tipo certo, e o documento baixa como arquivo @spec:AC-746', async () => {
    const imagem = await postar({ modo: 'arquivo', leadId: leadA(), legenda: ' Fachada da clínica ' }, { bytes: PNG, nome: 'fachada.png', tipo: 'image/png' });
    expect(imagem.status).toBe(200);
    expect(chamadas.at(-1)).toEqual({
      caminho: '/message/sendMedia/inst-a',
      corpo: { number: NUMERO, mediatype: 'image', mimetype: 'image/png', fileName: 'fachada.png', caption: 'Fachada da clínica', media: PNG.toString('base64') },
    });
    expect(sql(`SELECT mensagem || '|' || midia_tipo FROM whatsapp_mensagens ORDER BY criado_em DESC LIMIT 1`)).toBe('Fachada da clínica|imagem');

    const pdf = Buffer.from('%PDF-1.4 proposta');
    const doc = await postar({ modo: 'arquivo', leadId: leadA() }, { bytes: pdf, nome: 'proposta final.pdf', tipo: 'application/pdf' });
    expect(doc.status).toBe(200);
    expect(chamadas.at(-1)!.corpo).toMatchObject({ mediatype: 'document', fileName: 'proposta final.pdf' });
    expect(sql(`SELECT mensagem || '|' || midia_tipo || '|' || midia_nome FROM whatsapp_mensagens ORDER BY criado_em DESC LIMIT 1`)).toBe('proposta final.pdf|documento|proposta final.pdf');

    const aberto = await abrirMidia(ultimaMensagem());
    expect(aberto.headers.get('content-type')).toBe('application/pdf');
    expect(aberto.headers.get('content-disposition')).toMatch(/^attachment; filename="proposta final\.pdf"/);

    const comoAnexo = await postar({ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.from('ID3-musica'), nome: 'musica.mp3', tipo: 'audio/mpeg' });
    expect(comoAnexo.status).toBe(200);
    expect(chamadas.at(-1)!.corpo).toMatchObject({ mediatype: 'document' });
  });

  test('recusa tipo fora da lista, bytes que não combinam, arquivo grande, vazio e pedido mal formado, sem chamar a Evolution @spec:AC-747', async () => {
    const antes = chamadas.length;
    const mensagensAntes = sql(`SELECT count(*) FROM whatsapp_mensagens`);
    const casos: Array<[Record<string, string | undefined>, { bytes: Buffer; nome: string; tipo: string } | undefined, number, string]> = [
      [{ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.from('<html>'), nome: 'x.html', tipo: 'text/html' }, 415, 'TIPO_NAO_PERMITIDO'],
      [{ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.from('MZ'), nome: 'x.exe', tipo: 'application/x-msdownload' }, 415, 'TIPO_NAO_PERMITIDO'],
      [{ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.from('não sou png'), nome: 'x.png', tipo: 'image/png' }, 415, 'TIPO_NAO_PERMITIDO'],
      [{ modo: 'audio', leadId: leadA() }, { bytes: PNG, nome: 'x.png', tipo: 'image/png' }, 415, 'TIPO_NAO_PERMITIDO'],
      [{ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.alloc(16 * 1024 * 1024 + 1, 1), nome: 'grande.mp4', tipo: 'video/mp4' }, 413, 'ARQUIVO_GRANDE'],
      [{ modo: 'arquivo', leadId: leadA() }, { bytes: Buffer.alloc(0), nome: 'vazio.pdf', tipo: 'application/pdf' }, 400, 'REQUISICAO_INVALIDA'],
      [{ modo: 'arquivo', leadId: leadA() }, undefined, 400, 'REQUISICAO_INVALIDA'],
      [{ modo: 'outro', leadId: leadA() }, { bytes: PNG, nome: 'x.png', tipo: 'image/png' }, 400, 'REQUISICAO_INVALIDA'],
      [{ modo: 'arquivo', leadId: 'nao-e-uuid' }, { bytes: PNG, nome: 'x.png', tipo: 'image/png' }, 400, 'REQUISICAO_INVALIDA'],
      [{ modo: 'arquivo', leadId: leadA(), legenda: 'x'.repeat(1025) }, { bytes: PNG, nome: 'x.png', tipo: 'image/png' }, 400, 'REQUISICAO_INVALIDA'],
    ];
    for (const [campos, arquivo, status, codigo] of casos) {
      const r = await postar(campos, arquivo);
      expect(r.status, `${campos.modo} ${arquivo?.nome}`).toBe(status);
      expect((await r.json()).codigo).toBe(codigo);
    }
    expect(chamadas.length).toBe(antes);
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens`)).toBe(mensagensAntes);
  });

  test('exige sessão, lead e telefone da empresa, e WhatsApp configurado; falha da Evolution não grava mensagem @spec:AC-744', async () => {
    const png = { bytes: PNG, nome: 'a.png', tipo: 'image/png' };
    expect((await postar({ modo: 'arquivo', leadId: leadA() }, png, null)).status).toBe(401);
    expect((await postar({ modo: 'arquivo', leadId: amb.tenants.leadB }, png)).status).toBe(404);
    expect((await postar({ modo: 'arquivo', leadId: leadA(), telefoneId: 'aaaaaaaa-1111-4111-8111-00000000ffff' }, png)).status).toBe(404);
    expect((await postar({ modo: 'arquivo', leadId: amb.tenants.leadB }, png, gerenteB)).status).toBe(409); // empresa B sem instância

    const mensagensAntes = sql(`SELECT count(*) FROM whatsapp_mensagens`);
    respostaDoEnvio = { status: 500, corpo: { erro: 'quebrou' } };
    expect((await postar({ modo: 'arquivo', leadId: leadA() }, png)).status).toBe(502);
    respostaDoEnvio = { status: 400, corpo: { response: { message: [{ exists: false, number: NUMERO }] } } };
    const semWhats = await postar({ modo: 'arquivo', leadId: leadA() }, png);
    expect(semWhats.status).toBe(422);
    expect((await semWhats.json()).codigo).toBe('NUMERO_SEM_WHATSAPP');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens`)).toBe(mensagensAntes);
    respostaDoEnvio = { status: 201, corpo: { key: { id: 'EVO-ENVIADA' } } };
  });

  test('mídia recebida é buscada na Evolution só na primeira abertura e fica guardada; o histórico avisa que há mídia @spec:AC-745', async () => {
    sql(`INSERT INTO whatsapp_mensagens (empresa_id, lead_id, numero, mensagem, direcao, evolution_message_id, midia_tipo, midia_mimetype)
         VALUES ('${amb.tenants.empresaA}', '${leadA()}', '${NUMERO}', '[áudio]', 'recebida', 'EVO-RECEBIDA', 'audio', 'audio/ogg; codecs=opus')`);
    const id = ultimaMensagem();
    const antes = chamadas.length;

    const primeira = await abrirMidia(id);
    expect(primeira.status).toBe(200);
    expect(primeira.headers.get('content-type')).toBe('audio/ogg');
    expect(Buffer.from(await primeira.arrayBuffer()).equals(WAV_DA_EVOLUTION)).toBe(true);
    expect(chamadas.slice(antes).map((c) => `${c.caminho} ${JSON.stringify(c.corpo)}`)).toEqual([
      '/chat/getBase64FromMediaMessage/inst-a {"message":{"key":{"id":"EVO-RECEBIDA"}}}',
    ]);
    expect(sql(`SELECT midia_arquivo LIKE 'whatsapp/%.ogg' FROM whatsapp_mensagens WHERE id = '${id}'`)).toBe('t');

    expect((await abrirMidia(id)).status).toBe(200);
    expect(chamadas.length).toBe(antes + 1); // a segunda abertura saiu do volume

    const lista = await (await historico.GET(new NextRequest(`http://localhost/api/whatsapp/messages?leadId=${leadA()}`, { headers: { Cookie: atendente } }))).json();
    const recebida = lista.mensagens.find((m: { id: string }) => m.id === id);
    expect(recebida.midia).toEqual({ tipo: 'audio', mimetype: 'audio/ogg', nome: null });
  });

  test('a mídia de outra empresa, inexistente ou de mensagem de texto é 404; sem Evolution e sem arquivo é "indisponível"; sem sessão é 401 @spec:AC-745', async () => {
    const id = ultimaMensagem();
    expect((await abrirMidia(id, null)).status).toBe(401);
    expect((await abrirMidia(id, gerenteB)).status).toBe(404);
    expect((await abrirMidia('aaaaaaaa-1111-4111-8111-00000000ffff')).status).toBe(404);
    expect((await abrirMidia('nao-e-uuid')).status).toBe(404);

    sql(`INSERT INTO whatsapp_mensagens (empresa_id, lead_id, numero, mensagem, direcao) VALUES ('${amb.tenants.empresaA}', '${leadA()}', '${NUMERO}', 'só texto', 'recebida')`);
    expect((await abrirMidia(ultimaMensagem())).status).toBe(404);

    sql(`INSERT INTO whatsapp_mensagens (empresa_id, lead_id, numero, mensagem, direcao, midia_tipo) VALUES ('${amb.tenants.empresaA}', '${leadA()}', '${NUMERO}', '[imagem]', 'recebida', 'imagem')`);
    const semArquivo = await abrirMidia(ultimaMensagem());
    expect(semArquivo.status).toBe(404);
    expect((await semArquivo.json()).codigo).toBe('MIDIA_INDISPONIVEL');
  });
});
