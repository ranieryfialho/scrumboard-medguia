// T-279 (fase3-ingestao-continua, US-090, AC-726): no ciclo contínuo do worker, "Em contato", "Recontato" e "Aguardando
// Ativação" sem data entram em "Entrada de leads"; a carga manual continua mandando esses casos para a revisão.
import { describe, expect, test } from 'vitest';

import { ETAPA_ENTRADA_DE_LEADS, ETAPA_FOLLOW_DE_LONGO_PRAZO, mapearStatusParaEtapa } from '../../src/etl/sheets/status';

describe('T-279: status sem revisão no ciclo contínuo', () => {
  test('com statusSemRevisao, Em contato, Recontato e Aguardando Ativação sem data vão para Entrada de leads (@spec:AC-726)', () => {
    for (const situacao of ['Em contato', ' EM CONTATO ', 'Contacted', 'Recontato', 'Aguardando Ativação']) {
      expect(mapearStatusParaEtapa(situacao, { statusSemRevisao: true }), situacao).toEqual({ tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS });
    }
  });

  test('Recontato com data continua em Follow de longo prazo e status desconhecido continua em revisão (@spec:AC-726)', () => {
    expect(mapearStatusParaEtapa('Recontato', { statusSemRevisao: true, dataProximaAcao: '2026-12-01T10:00:00-03:00' })).toEqual({
      tipo: 'etapa',
      etapaId: ETAPA_FOLLOW_DE_LONGO_PRAZO,
    });
    expect(mapearStatusParaEtapa('Status Nunca Visto', { statusSemRevisao: true })).toMatchObject({ tipo: 'revisao' });
  });

  test('sem a opção (carga manual), Em contato, Recontato e Aguardando Ativação continuam indo para a revisão (@spec:AC-726)', () => {
    for (const situacao of ['Em contato', 'Recontato', 'Aguardando Ativação']) {
      expect(mapearStatusParaEtapa(situacao), situacao).toMatchObject({ tipo: 'revisao' });
    }
  });
});
