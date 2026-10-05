// T-067 (fase2c-whatsapp-entrada, US-040, AC-122/AC-123): prova pura (sem
// I/O) da extração de mensagens do payload da Evolution API.
import { describe, expect, test } from 'vitest';

import { extrairMensagens, type EvolutionWebhookPayload } from '../../src/domain/whatsapp/extrair-mensagem';

describe('T-067: extrairMensagens', () => {
  test('texto de conversa simples é extraído com número normalizado @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-1' },
        message: { conversation: 'Oi, quero saber mais' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([
      { numero: '558599985587', texto: 'Oi, quero saber mais', evolutionMessageId: 'MSG-1' },
    ]);
  });

  test('remove sufixo de device (:2) e prefere remoteJidAlt @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '12345@lid',
          remoteJidAlt: '558599985587:2@s.whatsapp.net',
          id: 'MSG-2',
        },
        message: { conversation: 'oi' },
      },
    };

    expect(extrairMensagens(payload)[0].numero).toBe('558599985587');
  });

  test('extendedTextMessage.text é extraído @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-3' },
        message: { extendedTextMessage: { text: 'texto estendido' } },
      },
    };

    expect(extrairMensagens(payload)[0].texto).toBe('texto estendido');
  });

  test.each([
    ['imagem', { imageMessage: { caption: 'legenda da imagem' } }, 'legenda da imagem'],
    ['vídeo', { videoMessage: { caption: 'legenda do vídeo' } }, 'legenda do vídeo'],
    ['documento', { documentMessage: { caption: 'legenda do documento' } }, 'legenda do documento'],
  ])('legenda de %s é extraída @spec:AC-122', (_nome, message, esperado) => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: { key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-4' }, message },
    };

    expect(extrairMensagens(payload)[0].texto).toBe(esperado);
  });

  test('áudio vira [áudio] @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-5' },
        message: { audioMessage: {} },
      },
    };

    expect(extrairMensagens(payload)[0].texto).toBe('[áudio]');
  });

  test('figurinha vira [figurinha] @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-6' },
        message: { stickerMessage: {} },
      },
    };

    expect(extrairMensagens(payload)[0].texto).toBe('[figurinha]');
  });

  test('outra mídia sem rótulo próprio vira [mídia] @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-7' },
        message: {},
      },
    };

    expect(extrairMensagens(payload)[0].texto).toBe('[mídia]');
  });

  test('aceita data como array com múltiplos itens @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: [
        {
          key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-8' },
          message: { conversation: 'primeira' },
        },
        {
          key: { remoteJid: '558599985588@s.whatsapp.net', id: 'MSG-9' },
          message: { conversation: 'segunda' },
        },
      ],
    };

    expect(extrairMensagens(payload)).toEqual([
      { numero: '558599985587', texto: 'primeira', evolutionMessageId: 'MSG-8' },
      { numero: '558599985588', texto: 'segunda', evolutionMessageId: 'MSG-9' },
    ]);
  });

  test('item sem evolution_message_id tem evolutionMessageId nulo @spec:AC-122', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net' },
        message: { conversation: 'oi' },
      },
    };

    expect(extrairMensagens(payload)[0].evolutionMessageId).toBeNull();
  });

  test('mensagem enviada por nós (fromMe) é ignorada @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { fromMe: true, remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-10' },
        message: { conversation: 'eco' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([]);
  });

  test('mensagem de grupo (@g.us) é ignorada @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '12036@g.us', id: 'MSG-11' },
        message: { conversation: 'mensagem de grupo' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([]);
  });

  test('sem número extraível é ignorada @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '', id: 'MSG-12' },
        message: { conversation: 'sem jid' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([]);
  });

  test('evento que não é de mensagem (connection.update) é ignorado @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'connection.update',
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-13' },
        message: { conversation: 'não deveria importar' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([]);
  });

  test('sem event nenhum é ignorado @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      data: {
        key: { remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-14' },
        message: { conversation: 'sem event' },
      },
    };

    expect(extrairMensagens(payload)).toEqual([]);
  });

  test('sem data nenhum devolve lista vazia @spec:AC-123', () => {
    expect(extrairMensagens({ event: 'messages.upsert' })).toEqual([]);
  });

  test('num array, item fromMe é descartado mas os demais são extraídos @spec:AC-123', () => {
    const payload: EvolutionWebhookPayload = {
      event: 'messages.upsert',
      data: [
        {
          key: { fromMe: true, remoteJid: '558599985587@s.whatsapp.net', id: 'MSG-15' },
          message: { conversation: 'eco' },
        },
        {
          key: { remoteJid: '558599985588@s.whatsapp.net', id: 'MSG-16' },
          message: { conversation: 'de verdade' },
        },
      ],
    };

    expect(extrairMensagens(payload)).toEqual([
      { numero: '558599985588', texto: 'de verdade', evolutionMessageId: 'MSG-16' },
    ]);
  });
});
