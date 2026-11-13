// Próxima ação do card por etapa: puro, sem I/O.
import { describe, expect, test } from 'vitest';

import { calcularProximaAcao, type EntradaProximaAcao } from '../../../src/domain/pipeline/proxima-acao';

const agora = new Date('2026-11-13T12:00:00Z');
const base: EntradaProximaAcao = { etapaId: 5, agora, proximaAcaoEm: null, reuniao: null, toqueDaVez: null, cadenciaIniciada: false };

describe('calcularProximaAcao', () => {
  test('reunião agendada mostra o dia e a hora da reunião e se há Meet', () => {
    const acao = calcularProximaAcao({ ...base, etapaId: 8, reuniao: { agendadaPara: new Date('2026-11-14T18:00:00Z'), meetUrl: 'https://meet.google.com/x', encerradaEm: null, noShow: false } });
    expect(acao).toMatchObject({ tipo: 'reuniao', quando: '2026-11-14T18:00:00.000Z', vencida: false, detalhe: 'Com link do Google Meet' });
  });

  test('reunião agendada já passada fica vencida', () => {
    const acao = calcularProximaAcao({ ...base, etapaId: 8, reuniao: { agendadaPara: new Date('2026-11-12T18:00:00Z'), meetUrl: null, encerradaEm: null, noShow: false } });
    expect(acao.vencida).toBe(true);
  });

  test('1º dia de contato mostra o toque da vez com o turno, sem marcar vencida', () => {
    const acao = calcularProximaAcao({
      ...base,
      etapaId: 2,
      cadenciaIniciada: true,
      toqueDaVez: { dia: 1, turno: 'manha', tipo: 'ligacao', liberadaEm: new Date('2026-11-13T11:00:00Z'), aguardandoAte: null },
    });
    expect(acao).toMatchObject({ tipo: 'toque', titulo: 'Ligar para o lead', periodo: 'manha', vencida: false });
  });

  test('toque de WhatsApp aguardando resposta mostra o prazo', () => {
    const acao = calcularProximaAcao({
      ...base,
      etapaId: 3,
      cadenciaIniciada: true,
      toqueDaVez: { dia: 2, turno: 'tarde', tipo: 'mensagem', liberadaEm: null, aguardandoAte: new Date('2026-11-13T20:00:00Z') },
    });
    expect(acao).toMatchObject({ tipo: 'aguardando_resposta', quando: '2026-11-13T20:00:00.000Z' });
  });

  test('fora dos 3 dias de contato, a data combinada à mão vem antes do toque', () => {
    const acao = calcularProximaAcao({ ...base, etapaId: 5, proximaAcaoEm: new Date('2026-11-20T13:00:00Z') });
    expect(acao).toMatchObject({ tipo: 'manual', quando: '2026-11-20T13:00:00.000Z' });
  });

  test('entrada sem cadência pede para iniciá-la; qualificado pede a reunião; perdido e ganho não têm ação', () => {
    expect(calcularProximaAcao({ ...base, etapaId: 1 }).tipo).toBe('iniciar_cadencia');
    expect(calcularProximaAcao({ ...base, etapaId: 6 }).tipo).toBe('agendar_reuniao');
    expect(calcularProximaAcao({ ...base, etapaId: 14 }).tipo).toBe('encerrado');
    expect(calcularProximaAcao({ ...base, etapaId: 15 }).tipo).toBe('encerrado');
  });

  test('no-show pede remarcar e guarda a data da reunião perdida', () => {
    const acao = calcularProximaAcao({ ...base, etapaId: 9, reuniao: { agendadaPara: new Date('2026-11-12T18:00:00Z'), meetUrl: null, encerradaEm: null, noShow: true } });
    expect(acao).toMatchObject({ tipo: 'remarcar', referenciaEm: '2026-11-12T18:00:00.000Z' });
  });
});
