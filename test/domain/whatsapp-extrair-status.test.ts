import { describe, expect, test } from 'vitest';

import { eventoDeAtualizacao, extrairAtualizacoesDeStatus } from '../../src/domain/whatsapp/extrair-status';
import { extrairMensagens } from '../../src/domain/whatsapp/extrair-mensagem';

describe('eventoDeAtualizacao', () => {
  test('reconhece messages.update nos dois jeitos de escrever, e só ele', () => {
    expect(eventoDeAtualizacao('messages.update')).toBe(true);
    expect(eventoDeAtualizacao('MESSAGES_UPDATE')).toBe(true);
    expect(eventoDeAtualizacao('messages.upsert')).toBe(false);
    expect(eventoDeAtualizacao(undefined)).toBe(false);
  });
});

describe('extrairAtualizacoesDeStatus', () => {
  test('traduz os nomes da Evolution: um check, dois checks, lida', () => {
    const itens = (['SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'] as const).map((status, i) => ({ keyId: `m${i}`, status }));
    expect(extrairAtualizacoesDeStatus({ event: 'messages.update', data: itens })).toEqual([
      { evolutionMessageId: 'm0', status: 'enviada' },
      { evolutionMessageId: 'm1', status: 'entregue' },
      { evolutionMessageId: 'm2', status: 'lida' },
      { evolutionMessageId: 'm3', status: 'lida' },
    ]);
  });

  test('traduz o formato numérico do Baileys (update.status)', () => {
    const r = extrairAtualizacoesDeStatus({
      event: 'MESSAGES_UPDATE',
      data: [{ key: { id: 'a' }, update: { status: 3 } }, { key: { id: 'b' }, update: { status: 4 } }],
    });
    expect(r.map((x) => x.status)).toEqual(['entregue', 'lida']);
  });

  test('ignora erro, desconhecido, item sem id e evento que não é de atualização', () => {
    expect(extrairAtualizacoesDeStatus({ event: 'messages.update', data: { keyId: 'a', status: 'ERROR' } })).toEqual([]);
    expect(extrairAtualizacoesDeStatus({ event: 'messages.update', data: { keyId: 'a', status: 0 } })).toEqual([]);
    expect(extrairAtualizacoesDeStatus({ event: 'messages.update', data: { status: 'READ' } })).toEqual([]);
    expect(extrairAtualizacoesDeStatus({ event: 'messages.upsert', data: { keyId: 'a', status: 'READ' } })).toEqual([]);
  });

  test('um messages.update nunca vira mensagem recebida', () => {
    const payload = { event: 'messages.update', data: { key: { id: 'x', fromMe: false, remoteJid: '5585999985587@s.whatsapp.net' }, update: { status: 4 } } };
    expect(extrairMensagens(payload)).toEqual([]);
  });
});
