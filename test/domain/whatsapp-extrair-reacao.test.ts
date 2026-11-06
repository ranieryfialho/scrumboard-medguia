import { describe, expect, test } from 'vitest';

import { extrairMensagens } from '../../src/domain/whatsapp/extrair-mensagem';
import { extrairReacoes } from '../../src/domain/whatsapp/extrair-reacao';

const JID = '5585999985587@s.whatsapp.net';

function reacao(texto: string, { fromMe = false, alvo = 'MSG-ALVO' } = {}) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: JID, fromMe, id: 'REACAO-1' },
      messageType: 'reactionMessage',
      message: { reactionMessage: { key: { remoteJid: JID, fromMe: !fromMe, id: alvo }, text: texto } },
    },
  };
}

describe('extrairReacoes', () => {
  test('reação do contato à mensagem: alvo, autor e emoji', () => {
    expect(extrairReacoes(reacao('👍'))).toEqual([{ evolutionMessageId: 'MSG-ALVO', autor: 'contato', emoji: '👍' }]);
  });

  test('reação da empresa (feita pelo celular) vem com fromMe e vira autor "nos"', () => {
    expect(extrairReacoes(reacao('❤️', { fromMe: true }))).toEqual([{ evolutionMessageId: 'MSG-ALVO', autor: 'nos', emoji: '❤️' }]);
  });

  test('texto vazio = reação retirada', () => {
    expect(extrairReacoes(reacao(''))).toEqual([{ evolutionMessageId: 'MSG-ALVO', autor: 'contato', emoji: '' }]);
  });

  test('aceita array de itens e ignora o que não é reação ou não tem a mensagem de destino', () => {
    const payload = {
      event: 'messages.upsert',
      data: [
        { key: { remoteJid: JID, id: 'a' }, message: { conversation: 'oi' } },
        { key: { remoteJid: JID, id: 'b' }, message: { reactionMessage: { text: '👍' } } },
        { key: { remoteJid: JID, id: 'c' }, message: { reactionMessage: { key: { id: 'X' }, text: '🙏' } } },
      ],
    };
    expect(extrairReacoes(payload)).toEqual([{ evolutionMessageId: 'X', autor: 'contato', emoji: '🙏' }]);
  });

  test('não trata aviso de status (messages.update) nem evento que não é de mensagem', () => {
    expect(extrairReacoes({ ...reacao('👍'), event: 'messages.update' })).toEqual([]);
    expect(extrairReacoes({ ...reacao('👍'), event: 'connection.update' })).toEqual([]);
  });
});

describe('uma reação nunca vira mensagem recebida', () => {
  test('extrairMensagens ignora o item de reação (antes entrava como "[mídia]")', () => {
    expect(extrairMensagens(reacao('👍'))).toEqual([]);
  });

  test('mensagem normal no mesmo array continua passando', () => {
    const payload = {
      event: 'messages.upsert',
      data: [reacao('👍').data, { key: { remoteJid: JID, id: 'n1' }, message: { conversation: 'oi' } }],
    };
    expect(extrairMensagens(payload).map((m) => m.texto)).toEqual(['oi']);
  });
});
