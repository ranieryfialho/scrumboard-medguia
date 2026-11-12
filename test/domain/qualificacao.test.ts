// fase6-qualificacao-comercial (US-198): o domínio puro da qualificação — pontos, faixas, eliminatórios, jornada e validação.
import { describe, expect, test } from 'vitest';

import {
  CRITERIOS,
  RESPOSTAS_VAZIAS,
  calcularQualificacao,
  faixaDaNota,
  lerFiltroDeQualificacao,
  validarEntrada,
  type RespostasDaQualificacao,
} from '../../src/domain/qualificacao/qualificacao';

const maximas: RespostasDaQualificacao = { dor: 25, complexidade: 20, decisao: 15, gatilho: 15, abertura: 15, aderencia: 10 };
const calcular = (respostas: Partial<RespostasDaQualificacao>, extra: { bloqueios?: ('necessidade' | 'decisor' | 'exigencia')[]; estagio?: 'residente' | 'inicio' | null } = {}) =>
  calcularQualificacao({ respostas: { ...RESPOSTAS_VAZIAS, ...respostas }, bloqueios: extra.bloqueios ?? [], estagio: extra.estagio ?? null });

describe('fase6-qualificacao-comercial: cálculo da qualificação', () => {
  test('os pesos somam 100 e a nota é a soma dos pontos escolhidos @spec:AC-830', () => {
    expect(CRITERIOS.reduce((soma, c) => soma + c.max, 0)).toBe(100);
    expect(CRITERIOS.every((c) => Math.max(...c.opcoes.map((o) => o.pontos)) === c.max)).toBe(true);
    expect(calcular(maximas).score).toBe(100);
    expect(calcular({ dor: 20, complexidade: 10, decisao: 10 }).score).toBe(40);
  });

  test('os cortes de faixa: 80 é A, 60 é B, 40 é C e abaixo de 40 é Baixo fit @spec:AC-830', () => {
    expect([100, 80, 79, 60, 59, 40, 39, 0].map(faixaDaNota)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'baixo', 'baixo']);
    expect(calcular(maximas).faixa).toBe('A');
    expect(calcular({ dor: 25, complexidade: 20, decisao: 15 }).faixa).toBe('B'); // 60
    expect(calcular({ dor: 20, complexidade: 10, decisao: 10 }).faixa).toBe('C'); // 40
    expect(calcular({ dor: 10, gatilho: 5 }).faixa).toBe('baixo');
  });

  test('sem nenhuma resposta e sem eliminatório a avaliação não foi iniciada; zero respondido de fato é Baixo fit @spec:AC-830', () => {
    const vazio = calcular({});
    expect(vazio).toMatchObject({ score: 0, faixa: null, rotulo: 'Avaliação não iniciada' });
    expect(calcular({ dor: 0 })).toMatchObject({ score: 0, faixa: 'baixo' });
  });

  test('um eliminatório prevalece sobre a nota, que continua calculada @spec:AC-830', () => {
    const r = calcular(maximas, { bloqueios: ['decisor'] });
    expect(r).toMatchObject({ score: 100, faixa: 'revisao', rotulo: 'Revisão obrigatória' });
    expect(calcular({}, { bloqueios: ['exigencia'] }).faixa).toBe('revisao'); // só o eliminatório já inicia a avaliação
  });

  test('a jornada do residente aparece à parte e não altera a nota; sem estágio é "não identificada" @spec:AC-833', () => {
    const sem = calcular({ dor: 20 });
    const residente = calcular({ dor: 20 }, { estagio: 'residente' });
    expect(residente.jornada).toBe('ICP R · Residente finalista (relacionamento e preparação)');
    expect(residente.score).toBe(sem.score);
    expect(sem.jornada).toBe('não identificada');
    expect(calcular({}, { estagio: 'inicio' }).jornada).toBe('Implantação de consultório');
  });
});

describe('fase6-qualificacao-comercial: validação do que vem de fora', () => {
  test('aceita só pontuação que existe no critério, eliminatório e estágio conhecidos @spec:AC-831', () => {
    expect(validarEntrada({ respostas: { dor: 20, gatilho: 5 }, bloqueios: ['decisor', 'decisor'], estagio: 'operacao' })).toEqual({
      ok: true,
      entrada: { respostas: { ...RESPOSTAS_VAZIAS, dor: 20, gatilho: 5 }, bloqueios: ['decisor'], estagio: 'operacao' },
    });
    expect(validarEntrada({})).toMatchObject({ ok: true });
    expect(validarEntrada({ respostas: { dor: 7 } })).toEqual({ ok: false, campo: 'dor' }); // 7 não é opção
    expect(validarEntrada({ respostas: { complexidade: '10' } })).toEqual({ ok: false, campo: 'complexidade' });
    expect(validarEntrada({ bloqueios: ['inventado'] })).toEqual({ ok: false, campo: 'bloqueios' });
    expect(validarEntrada({ estagio: 'outro' })).toEqual({ ok: false, campo: 'estagio' });
    expect(validarEntrada([])).toEqual({ ok: false, campo: 'corpo' });
    expect(validarEntrada(null)).toEqual({ ok: false, campo: 'corpo' });
  });

  test('o filtro da lista só aceita faixa conhecida ou "nenhuma" @spec:AC-835', () => {
    expect(['A', 'baixo', 'revisao', 'nenhuma'].map(lerFiltroDeQualificacao)).toEqual(['A', 'baixo', 'revisao', 'nenhuma']);
    expect([null, undefined, '', 'Z'].map(lerFiltroDeQualificacao)).toEqual([undefined, undefined, undefined, undefined]);
  });
});
