// T-132 (fase3-espelho-sheets, US-094/US-095): prova de AC-329, AC-330 e
// AC-335 para `src/espelho/linhas.ts` — função pura, sem I/O.
import { describe, expect, test } from 'vitest';

import {
  CABECALHO_ESPELHO,
  montarLinhaDoCard,
  montarLinhasDoEspelho,
  protegerContraFormula,
  type CardEspelho,
} from '../../src/espelho/linhas';

function cardBase(parcial: Partial<CardEspelho> = {}): CardEspelho {
  return {
    nome: 'Maria Silva',
    telefone: '+5511999999999',
    email: 'maria@example.com',
    etapa: 'Contrato (Ganho)',
    responsavel: 'Ana Atendente',
    valor: 1500,
    motivoPerda: null,
    criadoEm: new Date('2026-10-20T12:00:00Z'),
    atualizadoEm: new Date('2026-10-21T15:30:00Z'),
    cadencia: null,
    ...parcial,
  };
}

describe('T-132: montar linhas do espelho', () => {
  test('cada card aparece como uma linha, com cabeçalho fixo na primeira posição (@spec:AC-329)', () => {
    const cards: CardEspelho[] = [
      cardBase({ nome: 'Carlos Lead', etapa: 'Contrato (Ganho)' }),
      cardBase({ nome: 'Joana Lead', etapa: 'Perdido', motivoPerda: 'Sem orçamento' }),
    ];

    const linhas = montarLinhasDoEspelho(cards);

    expect(linhas[0]).toEqual([...CABECALHO_ESPELHO]);
    expect(linhas).toHaveLength(3);

    const linhaCarlos = montarLinhaDoCard(cards[0]);
    expect(linhaCarlos[0]).toBe('Carlos Lead');
    expect(linhaCarlos[3]).toBe('Contrato (Ganho)');

    const linhaJoana = montarLinhaDoCard(cards[1]);
    expect(linhaJoana[3]).toBe('Perdido');
    expect(linhaJoana[6]).toBe('Sem orçamento');
  });

  test('a linha traz nome, telefone, e-mail, etapa, responsável, valor, motivo de perda e as duas datas (@spec:AC-329)', () => {
    const card = cardBase();
    const linha = montarLinhaDoCard(card);

    expect(linha).toEqual([
      'Maria Silva',
      "'+5511999999999",
      'maria@example.com',
      'Contrato (Ganho)',
      'Ana Atendente',
      '1500',
      '',
      '20/10/2026 09:00',
      '21/10/2026 12:30',
      '',
      '',
      '',
      '',
    ]);
  });

  test('card em cadência mostra dia, turno, tentativas e próxima ação (@spec:AC-330)', () => {
    const proximaAcao = new Date('2026-10-22T14:00:00Z');
    const card = cardBase({
      cadencia: {
        dia: 3,
        turno: 'manha',
        tentativas: 5,
        proximaAcaoEm: proximaAcao,
      },
    });

    const linha = montarLinhaDoCard(card);

    expect(linha[9]).toBe('3');
    expect(linha[10]).toBe('manha');
    expect(linha[11]).toBe('5');
    expect(linha[12]).toBe('22/10/2026 11:00');
  });

  test('card em cadência com próxima ação formata data e hora completas em America/Sao_Paulo (@spec:AC-330)', () => {
    const proximaAcao = new Date('2026-10-22T14:00:00Z');
    const card = cardBase({
      cadencia: { dia: 2, turno: 'tarde', tentativas: 2, proximaAcaoEm: proximaAcao },
    });

    const linha = montarLinhaDoCard(card);

    expect(linha[12]).toBe('22/10/2026 11:00');
  });

  test('card sem cadência mostra as colunas de cadência em branco (@spec:AC-330)', () => {
    const card = cardBase({ cadencia: null });
    const linha = montarLinhaDoCard(card);

    expect(linha[9]).toBe('');
    expect(linha[10]).toBe('');
    expect(linha[11]).toBe('');
    expect(linha[12]).toBe('');
  });

  test('texto começando com "=" não é interpretado como fórmula: recebe prefixo de texto literal (@spec:AC-335)', () => {
    expect(protegerContraFormula('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")");
  });

  test.each(['=', '+', '-', '@'])(
    'nome começando com "%s" é gravado como texto literal, sem ser executado como fórmula (@spec:AC-335)',
    (prefixo) => {
      const card = cardBase({ nome: `${prefixo}HYPERLINK("http://evil","clique")` });
      const linha = montarLinhaDoCard(card);

      expect(linha[0].startsWith("'")).toBe(true);
      expect(linha[0]).toBe(`'${card.nome}`);
    },
  );

  test('texto que não parece fórmula não recebe prefixo (@spec:AC-335)', () => {
    expect(protegerContraFormula('Maria Silva')).toBe('Maria Silva');
    expect(protegerContraFormula('')).toBe('');
  });

  test('motivo de perda e responsável também são protegidos contra fórmula (@spec:AC-335)', () => {
    const card = cardBase({
      responsavel: '=CMD|cálculo',
      motivoPerda: '+injetado',
    });
    const linha = montarLinhaDoCard(card);

    expect(linha[4]).toBe("'=CMD|cálculo");
    expect(linha[6]).toBe("'+injetado");
  });
});
