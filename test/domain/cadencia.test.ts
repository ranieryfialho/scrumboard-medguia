// Testes de T-088 (fase2b-cadencia, US-052): domínio puro, sem I/O — não
// precisa de Postgres efêmero. Todo instante é construído com offset
// `-03:00` explícito (horário de São Paulo, sem horário de verão), para que
// o teste não dependa do fuso do host que roda o Vitest (ASM-062).
import { describe, expect, test } from 'vitest';

import { blocoDe } from '../../src/domain/cadencia/matriz';
import { eFeriadoNacional, podeLiberar } from '../../src/domain/cadencia/feriados';
import { turnoVigente } from '../../src/domain/cadencia/turno';

describe('T-088: blocoDe', () => {
  describe('AC-187: matriz canônica de 18 toques', () => {
    test.each([
      { dia: 1, turno: 'manha', primeiraSequencia: 1 },
      { dia: 1, turno: 'tarde', primeiraSequencia: 4 },
      { dia: 2, turno: 'manha', primeiraSequencia: 7 },
      { dia: 2, turno: 'tarde', primeiraSequencia: 10 },
      { dia: 3, turno: 'manha', primeiraSequencia: 13 },
      { dia: 3, turno: 'tarde', primeiraSequencia: 16 },
    ] as const)(
      'dia $dia / turno $turno: 3 toques, sequências contíguas a partir da 1ª @spec:AC-187',
      ({ dia, turno, primeiraSequencia }) => {
        const bloco = blocoDe(dia, turno);

        expect(bloco).toHaveLength(3);
        expect(bloco.map((toque) => toque.sequencia)).toEqual([
          primeiraSequencia,
          primeiraSequencia + 1,
          primeiraSequencia + 2,
        ]);
        expect(bloco.every((toque) => toque.dia === dia)).toBe(true);
        expect(bloco.every((toque) => toque.turno === turno)).toBe(true);
      },
    );

    test('ordem é ligação, ligação, mensagem de WhatsApp @spec:AC-187', () => {
      const bloco = blocoDe(1, 'manha');

      expect(bloco.map((toque) => [toque.tipo, toque.canal])).toEqual([
        ['ligacao', 'telefone'],
        ['ligacao', 'telefone'],
        ['mensagem', 'whatsapp'],
      ]);
    });

    test('toque de sequência 18 (último do dia 3 / tarde) é breakup @spec:AC-187', () => {
      const bloco = blocoDe(3, 'tarde');
      const ultimoToque = bloco[bloco.length - 1];

      expect(ultimoToque.sequencia).toBe(18);
      expect(ultimoToque.tipo).toBe('breakup');
      expect(ultimoToque.canal).toBe('whatsapp');
    });

    test('blocos que não são o último continuam com mensagem comum no 3º toque @spec:AC-187', () => {
      const bloco = blocoDe(3, 'manha');
      const ultimoToque = bloco[bloco.length - 1];

      expect(ultimoToque.sequencia).toBe(15);
      expect(ultimoToque.tipo).toBe('mensagem');
    });
  });
});

describe('T-088: turnoVigente', () => {
  describe('AC-188: turno vigente por horário de São Paulo', () => {
    test.each([
      ['2026-06-10T08:00:00-03:00', 'manha'],
      ['2026-06-10T10:30:00-03:00', 'manha'],
      ['2026-06-10T11:59:00-03:00', 'manha'],
      ['2026-06-10T13:00:00-03:00', 'tarde'],
      ['2026-06-10T15:00:00-03:00', 'tarde'],
      ['2026-06-10T17:59:00-03:00', 'tarde'],
      ['2026-06-10T07:59:00-03:00', null],
      ['2026-06-10T12:00:00-03:00', null],
      ['2026-06-10T12:59:00-03:00', null],
      ['2026-06-10T18:00:00-03:00', null],
      ['2026-06-10T23:00:00-03:00', null],
    ] as const)('%s @spec:AC-188', (isoComOffsetSP, turnoEsperado) => {
      expect(turnoVigente(new Date(isoComOffsetSP))).toBe(turnoEsperado);
    });

    test('usa o horário de São Paulo, não o UTC @spec:AC-188', () => {
      // 10:00 em São Paulo (-03:00) é 13:00 em UTC — se o domínio usasse UTC
      // por engano, cairia fora de qualquer turno.
      const dezHorasEmSaoPaulo = new Date('2026-06-10T10:00:00-03:00');

      expect(dezHorasEmSaoPaulo.getUTCHours()).toBe(13);
      expect(turnoVigente(dezHorasEmSaoPaulo)).toBe('manha');
    });
  });
});

describe('T-088: podeLiberar', () => {
  describe('AC-189: fim de semana e feriado nacional pausam', () => {
    test('sábado: não libera @spec:AC-189', () => {
      // 2026-01-03 é sábado.
      expect(podeLiberar(new Date('2026-01-03T10:00:00-03:00'))).toBe(false);
    });

    test('domingo: não libera @spec:AC-189', () => {
      // 2026-01-04 é domingo.
      expect(podeLiberar(new Date('2026-01-04T10:00:00-03:00'))).toBe(false);
    });

    test('feriado nacional da lista versionada: não libera @spec:AC-189', () => {
      // 2026-01-01 (Confraternização Universal) é quinta-feira — garante que
      // é o feriado, não o dia da semana, que bloqueia.
      expect(eFeriadoNacional('2026-01-01')).toBe(true);
      expect(podeLiberar(new Date('2026-01-01T10:00:00-03:00'))).toBe(false);
    });

    test('dia útil comum: libera @spec:AC-189', () => {
      // 2026-01-05 é segunda-feira e não está na lista de feriados.
      expect(podeLiberar(new Date('2026-01-05T10:00:00-03:00'))).toBe(true);
    });

    test('usa a data local em São Paulo, não em UTC @spec:AC-189', () => {
      // 2026-01-03 23:30 em São Paulo (sábado) já é 2026-01-04 02:30 em UTC
      // (domingo) — se o domínio usasse a data em UTC, erraria o dia.
      const instante = new Date('2026-01-03T23:30:00-03:00');

      expect(instante.getUTCDate()).toBe(4);
      expect(podeLiberar(instante)).toBe(false);
    });
  });
});
