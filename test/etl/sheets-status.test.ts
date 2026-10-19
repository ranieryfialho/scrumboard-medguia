// Testes de T-117 (fase3-etl-sheets, US-077): mapa de status para etapa e
// motivo de perda (src/etl/sheets/status.ts). Função pura — sem rede nem
// Postgres.
import { describe, expect, test } from 'vitest';

import {
  ETAPA_CONTRATO_GANHO,
  ETAPA_ENTRADA_DE_LEADS,
  ETAPA_FOLLOW_DE_LONGO_PRAZO,
  ETAPA_PERDIDO,
  ETAPA_REUNIAO_AGENDADA,
  ETAPA_TESTE_TRIAL,
  MOTIVO_DESQUALIFICADO_MIGRACAO,
  MOTIVO_LEGADO_ARQUIVADO,
  MOTIVO_SEM_INTERESSE,
  mapearStatusParaEtapa,
} from '../../src/etl/sheets/status';

describe('T-117: mapearStatusParaEtapa — novos leads e reunião agendada (@spec:AC-279)', () => {
  test.each(['CREATED', '', 'Novos Leads'])('status "%s" vai para Entrada de leads', (status) => {
    const resultado = mapearStatusParaEtapa(status);
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS });
  });

  test('"Reunião agendada" vai para a etapa Reunião agendada', () => {
    const resultado = mapearStatusParaEtapa('Reunião agendada');
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_REUNIAO_AGENDADA });
  });
});

describe('T-117: mapearStatusParaEtapa — Fechado vira Contrato (Ganho) com a data (@spec:AC-280)', () => {
  test.each(['Fechado', 'Logins Ativados', 'Fechamento de Clientes'])(
    'status "%s" vai para Contrato (Ganho) preservando a data_fechamento',
    (status) => {
      const resultado = mapearStatusParaEtapa(status, { dataFechamento: '2026-09-15T18:06:12-03:00' });
      expect(resultado).toEqual({
        tipo: 'etapa',
        etapaId: ETAPA_CONTRATO_GANHO,
        dataFechamento: '2026-09-15T18:06:12-03:00',
      });
    }
  );

  test('sem data_fechamento informada, a etapa ainda é decidida (campo fica undefined, não inventado)', () => {
    const resultado = mapearStatusParaEtapa('Fechado');
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_CONTRATO_GANHO, dataFechamento: undefined });
  });
});

describe('T-117: mapearStatusParaEtapa — Perdidos recebem o motivo certo (@spec:AC-281)', () => {
  test('"Sem interesse" vai para Perdido com motivo "Sem interesse"', () => {
    const resultado = mapearStatusParaEtapa('Sem interesse');
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_PERDIDO, motivoPerdaNome: MOTIVO_SEM_INTERESSE });
  });

  test('"Desqualificado" vai para Perdido com motivo "Desqualificado (migração)"', () => {
    const resultado = mapearStatusParaEtapa('Desqualificado');
    expect(resultado).toEqual({
      tipo: 'etapa',
      etapaId: ETAPA_PERDIDO,
      motivoPerdaNome: MOTIVO_DESQUALIFICADO_MIGRACAO,
    });
  });

  test('"Arquivado" vai para Perdido com motivo "Legado — arquivado"', () => {
    const resultado = mapearStatusParaEtapa('Arquivado');
    expect(resultado).toEqual({
      tipo: 'etapa',
      etapaId: ETAPA_PERDIDO,
      motivoPerdaNome: MOTIVO_LEGADO_ARQUIVADO,
    });
  });
});

describe('T-117: mapearStatusParaEtapa — próxima ação sem data vai para revisão (@spec:AC-282)', () => {
  test('"Recontato" sem data de próxima ação entra na fila de revisão', () => {
    const resultado = mapearStatusParaEtapa('Recontato');
    expect(resultado).toEqual({ tipo: 'revisao', motivo: 'Recontato sem data de próxima ação' });
  });

  test('"Aguardando Ativação" sem data de próxima ação entra na fila de revisão', () => {
    const resultado = mapearStatusParaEtapa('Aguardando Ativação');
    expect(resultado).toEqual({ tipo: 'revisao', motivo: 'Aguardando Ativação sem data de próxima ação' });
  });

  test('"Recontato" com data de próxima ação vai para Follow de longo prazo', () => {
    const resultado = mapearStatusParaEtapa('Recontato', { dataProximaAcao: '2026-10-20T10:00:00-03:00' });
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_FOLLOW_DE_LONGO_PRAZO });
  });

  test('"Aguardando Ativação" com data de próxima ação vai para Teste (Trial)', () => {
    const resultado = mapearStatusParaEtapa('Aguardando Ativação', { dataProximaAcao: '2026-10-20T10:00:00-03:00' });
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: ETAPA_TESTE_TRIAL });
  });
});

describe('T-117: mapearStatusParaEtapa — status desconhecido nunca vira Entrada de leads em silêncio (@spec:AC-283)', () => {
  test('status fora do mapa entra na fila de revisão manual, não em Entrada de leads', () => {
    const resultado = mapearStatusParaEtapa('Status Inventado Que Não Existe');
    expect(resultado.tipo).toBe('revisao');
    if (resultado.tipo === 'revisao') {
      expect(resultado.motivo).toContain('Status Inventado Que Não Existe');
    }
  });

  test('status desconhecido nunca produz etapaId de Entrada de leads', () => {
    const resultado = mapearStatusParaEtapa('Qualquer Coisa');
    expect(resultado).not.toEqual({ tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS });
  });
});
