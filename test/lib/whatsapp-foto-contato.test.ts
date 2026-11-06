// Foto de perfil do contato: cache no volume (a URL do WhatsApp expira), "sem foto" lembrado por um tempo, host permitido e falhas.
import { mkdtemp, rm, stat, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  obterFotoDoContato,
  urlDeFotoPermitida,
  VALIDADE_FOTO_MS,
  VALIDADE_SEM_FOTO_MS,
} from '../../src/lib/whatsapp/foto-contato';

const EMPRESA = 'e0000000-0000-0000-0000-0000000000f1';
const NUMERO = '5585999985587';
const URL_OK = 'https://pps.whatsapp.net/v/t61/foto.jpg?oh=abc&oe=123';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
/** Compara o conteúdo (o cache devolve `Buffer`, a busca devolve `Uint8Array`). */
const bytesDe = (b: Uint8Array | null) => (b ? Array.from(b) : null);

let pasta: string;
const original = process.env.ANEXOS_DIR;

beforeEach(async () => {
  if (pasta) await rm(pasta, { recursive: true, force: true });
  pasta = await mkdtemp(path.join(tmpdir(), 'fotos-'));
  process.env.ANEXOS_DIR = pasta;
});

afterAll(async () => {
  process.env.ANEXOS_DIR = original;
  await rm(pasta, { recursive: true, force: true });
});

const baixarOk = () => vi.fn(async () => ({ ok: true, tipo: 'image/jpeg', bytes: JPEG }));

async function envelhecer(arquivo: string, ms: number) {
  const quando = new Date(Date.now() - ms);
  await utimes(arquivo, quando, quando);
}
const arquivosDoContato = async () => (await readdir(path.join(pasta, 'whatsapp-fotos', EMPRESA)).catch(() => [])).sort();

describe('urlDeFotoPermitida', () => {
  test('só https em host do WhatsApp', () => {
    expect(urlDeFotoPermitida(URL_OK)).toBe(true);
    expect(urlDeFotoPermitida('https://media-gru1-1.cdn.whatsapp.net/foto.jpg')).toBe(true);
    expect(urlDeFotoPermitida('http://pps.whatsapp.net/foto.jpg')).toBe(false);
    expect(urlDeFotoPermitida('https://evil.com/pps.whatsapp.net')).toBe(false);
    expect(urlDeFotoPermitida('https://pps.whatsapp.net.evil.com/foto.jpg')).toBe(false);
    expect(urlDeFotoPermitida('não é url')).toBe(false);
  });
});

describe('obterFotoDoContato', () => {
  test('busca, baixa e guarda; na segunda vez serve do cache sem perguntar à Evolution', async () => {
    const buscarUrl = vi.fn(async () => URL_OK);
    const baixar = baixarOk();

    expect(bytesDe(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl, baixar }))).toEqual(bytesDe(JPEG));
    expect(bytesDe(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl, baixar }))).toEqual(bytesDe(JPEG));

    expect(buscarUrl).toHaveBeenCalledTimes(1);
    expect(baixar).toHaveBeenCalledTimes(1);
    expect(await arquivosDoContato()).toEqual([`${NUMERO}.jpg`]);
  });

  test('foto vencida é buscada de novo (a URL do WhatsApp mudou)', async () => {
    const buscarUrl = vi.fn(async () => URL_OK);
    await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl, baixar: baixarOk() });
    await envelhecer(path.join(pasta, 'whatsapp-fotos', EMPRESA, `${NUMERO}.jpg`), VALIDADE_FOTO_MS + 1000);

    await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl, baixar: baixarOk() });
    expect(buscarUrl).toHaveBeenCalledTimes(2);
  });

  test('sem foto (privacidade): devolve null, lembra por um tempo e depois pergunta de novo', async () => {
    const buscarUrl = vi.fn(async () => null);
    expect(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl })).toBeNull();
    expect(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl })).toBeNull();
    expect(buscarUrl).toHaveBeenCalledTimes(1);
    expect(await arquivosDoContato()).toEqual([`${NUMERO}.sem`]);

    await envelhecer(path.join(pasta, 'whatsapp-fotos', EMPRESA, `${NUMERO}.sem`), VALIDADE_SEM_FOTO_MS + 1000);
    await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl });
    expect(buscarUrl).toHaveBeenCalledTimes(2);
  });

  test('URL de host que não é do WhatsApp nunca é baixada', async () => {
    const baixar = baixarOk();
    expect(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl: async () => 'https://evil.com/x.jpg', baixar })).toBeNull();
    expect(baixar).not.toHaveBeenCalled();
  });

  test('resposta que não é imagem, vazia ou grande demais é descartada', async () => {
    for (const resposta of [
      { ok: true, tipo: 'text/html', bytes: JPEG },
      { ok: true, tipo: 'image/jpeg', bytes: new Uint8Array(0) },
      { ok: true, tipo: 'image/jpeg', bytes: new Uint8Array(3 * 1024 * 1024) },
      { ok: false, tipo: 'image/jpeg', bytes: JPEG },
    ]) {
      await rm(path.join(pasta, 'whatsapp-fotos'), { recursive: true, force: true });
      expect(await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl: async () => URL_OK, baixar: async () => resposta })).toBeNull();
    }
  });

  test('falha de rede ao renovar: serve a foto antiga em vez de nada', async () => {
    await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl: async () => URL_OK, baixar: baixarOk() });
    await envelhecer(path.join(pasta, 'whatsapp-fotos', EMPRESA, `${NUMERO}.jpg`), VALIDADE_FOTO_MS + 1000);

    const foto = await obterFotoDoContato({
      empresaId: EMPRESA,
      numero: NUMERO,
      buscarUrl: async () => URL_OK,
      baixar: async () => {
        throw new Error('rede caiu');
      },
    });
    expect(bytesDe(foto)).toEqual(bytesDe(JPEG));
  });

  test('pedidos simultâneos do mesmo contato viram uma busca só', async () => {
    const buscarUrl = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return URL_OK;
    });
    const pedido = () => obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl, baixar: baixarOk() });
    await Promise.all([pedido(), pedido(), pedido()]);
    expect(buscarUrl).toHaveBeenCalledTimes(1);
  });

  test('empresa ou número fora do formato nunca tocam o disco (nada de ../)', async () => {
    const buscarUrl = vi.fn(async () => URL_OK);
    for (const [empresaId, numero] of [['../../etc', NUMERO], [EMPRESA, '../../senha'], [EMPRESA, '123'], [EMPRESA, '55859999855871234567']] as const) {
      expect(await obterFotoDoContato({ empresaId, numero, buscarUrl, baixar: baixarOk() })).toBeNull();
    }
    expect(buscarUrl).not.toHaveBeenCalled();
    await expect(stat(path.join(pasta, 'whatsapp-fotos'))).rejects.toThrow();
  });

  test('cada empresa tem a sua foto (mesmo número, pastas separadas)', async () => {
    const OUTRA = 'e0000000-0000-0000-0000-0000000000f2';
    await obterFotoDoContato({ empresaId: EMPRESA, numero: NUMERO, buscarUrl: async () => URL_OK, baixar: baixarOk() });
    const buscarOutra = vi.fn(async () => null);
    expect(await obterFotoDoContato({ empresaId: OUTRA, numero: NUMERO, buscarUrl: buscarOutra })).toBeNull();
    expect(buscarOutra).toHaveBeenCalledTimes(1);
  });
});
