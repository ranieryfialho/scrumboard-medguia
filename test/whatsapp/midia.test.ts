// T-290 (fase4-card-abas, US-114, AC-745/AC-747): as regras puras da mídia do WhatsApp e a mídia extraída do webhook.
import { describe, expect, test } from 'vitest';

import { bytesCombinamComMimetype, classificarMimetype, ehMarcadorDeMidia, LIMITE_MIDIA_BYTES, mimetypeBase } from '../../src/domain/whatsapp/midia';
import { extrairMensagens, type EvolutionWebhookPayload } from '../../src/domain/whatsapp/extrair-mensagem';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4');
const GIF = new TextEncoder().encode('GIF89a');

describe('T-290: regras da mídia', () => {
  test('só os tipos da lista são permitidos, sem olhar maiúsculas nem o codec, e o limite é de 16 MB @spec:AC-747', () => {
    expect(mimetypeBase('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    expect(classificarMimetype('audio/webm;codecs=opus')).toEqual({ tipo: 'audio', extensao: 'webm' });
    expect(classificarMimetype('image/png')?.tipo).toBe('imagem');
    expect(classificarMimetype('video/mp4')?.tipo).toBe('video');
    expect(classificarMimetype('application/pdf')?.tipo).toBe('documento');
    expect(classificarMimetype('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')?.extensao).toBe('xlsx');

    for (const perigoso of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/javascript', 'application/octet-stream', '', null, undefined]) {
      expect(classificarMimetype(perigoso as string), String(perigoso)).toBeNull();
    }
    expect(LIMITE_MIDIA_BYTES).toBe(16 * 1024 * 1024);
  });

  test('imagem, PDF e GIF precisam ter os bytes do tipo que dizem ser; os outros passam só pelo tipo @spec:AC-747', () => {
    expect(bytesCombinamComMimetype('image/png', PNG)).toBe(true);
    expect(bytesCombinamComMimetype('image/png', PDF)).toBe(false);
    expect(bytesCombinamComMimetype('image/jpeg', PNG)).toBe(false);
    expect(bytesCombinamComMimetype('application/pdf', PDF)).toBe(true);
    expect(bytesCombinamComMimetype('application/pdf', new TextEncoder().encode('<html>'))).toBe(false);
    expect(bytesCombinamComMimetype('image/gif', GIF)).toBe(true);
    expect(bytesCombinamComMimetype('image/gif', PNG)).toBe(false);
    expect(bytesCombinamComMimetype('audio/ogg', new Uint8Array([1, 2, 3]))).toBe(true);
  });

  test('os marcadores de mídia são reconhecidos, o texto de verdade não @spec:AC-745', () => {
    for (const marcador of ['[áudio]', '[imagem]', '[vídeo]', '[documento]', '[figurinha]', '[mídia]', ' [áudio] ']) expect(ehMarcadorDeMidia(marcador)).toBe(true);
    expect(ehMarcadorDeMidia('Segue a foto')).toBe(false);
  });
});

function payload(message: Record<string, unknown>): EvolutionWebhookPayload {
  return { event: 'messages.upsert', data: { key: { remoteJid: '558599985587@s.whatsapp.net', id: 'M1' }, message } };
}

describe('T-290: a mídia que chega pelo webhook', () => {
  test('áudio, imagem, vídeo, documento e figurinha trazem tipo, mimetype e nome; texto não leva a chave @spec:AC-745', () => {
    expect(extrairMensagens(payload({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 5 } }))[0]).toEqual({
      numero: '558599985587',
      texto: '[áudio]',
      evolutionMessageId: 'M1',
      midia: { tipo: 'audio', mimetype: 'audio/ogg; codecs=opus', nome: null },
    });
    expect(extrairMensagens(payload({ imageMessage: { mimetype: 'image/jpeg', caption: 'fachada' } }))[0]).toMatchObject({
      texto: 'fachada',
      midia: { tipo: 'imagem', mimetype: 'image/jpeg' },
    });
    expect(extrairMensagens(payload({ videoMessage: { mimetype: 'video/mp4' } }))[0].midia?.tipo).toBe('video');
    expect(extrairMensagens(payload({ documentMessage: { mimetype: 'application/pdf', fileName: 'proposta.pdf' } }))[0].midia).toEqual({
      tipo: 'documento',
      mimetype: 'application/pdf',
      nome: 'proposta.pdf',
    });
    expect(extrairMensagens(payload({ stickerMessage: {} }))[0].midia).toEqual({ tipo: 'figurinha', mimetype: null, nome: null });

    const texto = extrairMensagens(payload({ conversation: 'oi' }))[0];
    expect(texto).toEqual({ numero: '558599985587', texto: 'oi', evolutionMessageId: 'M1' });
    expect('midia' in texto).toBe(false);
  });
});
