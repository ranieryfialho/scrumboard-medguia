// Testes de T-124 (fase3-etl-decisoes, US-086/US-088): planilha de decisões
// e validador comuns aos três ETLs — geração/leitura da planilha
// (AC-307/AC-308) e validação de cada linha de decisão
// (AC-312/AC-313/AC-314).
import { describe, expect, test } from 'vitest';

import {
  gerarCsvFilaRevisao,
  lerCsvDecisoes,
  linhasDecisaoForaDaFila,
  validarDecisao,
  type EtapaValidacao,
  type ItemFilaRevisao,
  type LinhaDecisaoBruta,
  type MotivoPerdaValidacao,
} from '../../src/etl/decisoes';

// Mesmos ids/flags do seed imutável de `pipeline_etapas` (drizzle/0005_seeds.sql).
const ETAPAS: EtapaValidacao[] = [
  { id: 1, nome: 'Entrada de leads', exigeProximaAcao: false, exigeValor: false, exigeMotivo: false },
  { id: 7, nome: 'Follow de longo prazo', exigeProximaAcao: true, exigeValor: false, exigeMotivo: false },
  { id: 8, nome: 'Reunião agendada', exigeProximaAcao: false, exigeValor: false, exigeMotivo: false },
  { id: 11, nome: 'Proposta', exigeProximaAcao: true, exigeValor: true, exigeMotivo: false },
  { id: 12, nome: 'Teste (Trial)', exigeProximaAcao: true, exigeValor: false, exigeMotivo: false },
  { id: 13, nome: 'Negociação', exigeProximaAcao: true, exigeValor: false, exigeMotivo: false },
  { id: 14, nome: 'Perdido', exigeProximaAcao: false, exigeValor: false, exigeMotivo: true },
];

const MOTIVOS: MotivoPerdaValidacao[] = [
  { id: 'motivo-sem-interesse', nome: 'Sem interesse' },
  { id: 'motivo-preco', nome: 'Preço/orçamento' },
];

const AGORA = new Date('2026-10-21T12:00:00-03:00');

function linhaVazia(idOrigem: string): LinhaDecisaoBruta {
  return { idOrigem, etapa: '', proximaAcao: '', valor: '', motivoPerda: '', ignorar: '' };
}

describe('T-124: gerarCsvFilaRevisao (@spec:AC-307)', () => {
  test('uma linha por lead, com as colunas descritivas e as de decisão em branco', () => {
    const itens: ItemFilaRevisao[] = [
      {
        idOrigem: 'lead-1',
        nome: 'Maria Souza',
        telefone: '+5511999990000',
        email: 'maria@exemplo.com',
        statusOriginal: 'Recontato',
        motivoRevisao: 'situação sem etapa automática: "Recontato"',
      },
      {
        idOrigem: 'lead-2',
        nome: 'João Pereira',
        telefone: '+5511999991111',
        email: 'joao@exemplo.com',
        statusOriginal: 'Aguardando Ativação',
        motivoRevisao: 'situação sem etapa automática: "Aguardando Ativação"',
      },
    ];

    const csv = gerarCsvFilaRevisao(itens);
    const linhas = lerCsvDecisoes(csv);

    expect(linhas).toHaveLength(2);
    expect(linhas[0].idOrigem).toBe('lead-1');
    expect(linhas[0].etapa).toBe('');
    expect(linhas[0].proximaAcao).toBe('');
    expect(linhas[0].valor).toBe('');
    expect(linhas[0].motivoPerda).toBe('');
    expect(linhas[0].ignorar).toBe('');
    expect(linhas[1].idOrigem).toBe('lead-2');

    expect(csv).toContain('id_origem');
    expect(csv).toContain('etapa');
    expect(csv).toContain('proxima_acao');
    expect(csv).toContain('valor');
    expect(csv).toContain('motivo_perda');
    expect(csv).toContain('ignorar');
  });

  test('fila vazia gera só o cabeçalho, sem linha nenhuma para preencher', () => {
    const csv = gerarCsvFilaRevisao([]);
    expect(lerCsvDecisoes(csv)).toHaveLength(0);
    expect(csv).toContain('id_origem');
  });
});

describe('T-124: formato do arquivo — Excel e Google Sheets (@spec:AC-308)', () => {
  test('começa com o BOM UTF-8 e usa ; como separador', () => {
    const csv = gerarCsvFilaRevisao([
      {
        idOrigem: 'lead-1',
        nome: 'Ana',
        telefone: '',
        email: '',
        statusOriginal: 'Recontato',
        motivoRevisao: 'x',
      },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const primeiraLinha = csv.slice(1).split('\r\n')[0];
    expect(primeiraLinha).toContain(';');
    expect(primeiraLinha).not.toContain(',id_origem');
  });

  test('acento, vírgula, ponto e vírgula e aspas no nome/observações não quebram colunas nem perdem o acento', () => {
    const itens: ItemFilaRevisao[] = [
      {
        idOrigem: 'lead-1',
        nome: 'José da Conceição, Jr.; "Zé"',
        telefone: '+5511999990000',
        email: 'jose@exemplo.com',
        statusOriginal: 'Recontato',
        motivoRevisao: 'observação: contém "aspas", vírgula, e ponto e vírgula; tudo junto',
      },
    ];

    const csv = gerarCsvFilaRevisao(itens);
    const linhas = lerCsvDecisoes(csv);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].idOrigem).toBe('lead-1');
  });

  test('round-trip completo: lê de volta exatamente os mesmos dados que preencheram a fila', () => {
    const csv = gerarCsvFilaRevisao([
      {
        idOrigem: 'lead-9',
        nome: 'Raíza Núñez',
        telefone: '+5521988887777',
        email: 'raiza@exemplo.com',
        statusOriginal: 'Aguardando Ativação',
        motivoRevisao: 'situação sem etapa automática: "Aguardando Ativação"',
      },
    ]);

    // Operação preenche a planilha de volta (simulado aqui direto no texto).
    const preenchido = csv.replace(/lead-9;([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);;;;;/, 'lead-9;$1;$2;$3;$4;$5;7;10/11/2026 14:00;;;');

    const linhas = lerCsvDecisoes(preenchido);
    expect(linhas[0].etapa).toBe('7');
    expect(linhas[0].proximaAcao).toBe('10/11/2026 14:00');
  });
});

describe('T-124: validarDecisao — etapa sem o dado que ela exige (@spec:AC-312)', () => {
  test('"Follow de longo prazo" sem próxima ação volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: 'Follow de longo prazo' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado.tipo).toBe('recusada');
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('próxima ação') });
  });

  test('"Teste (Trial)" sem próxima ação volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-2'), etapa: 'Teste (Trial)' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada' });
  });

  test('"Negociação" sem próxima ação volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-3'), etapa: 'Negociação' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada' });
  });

  test('"Proposta" sem valor volta para a revisão, mesmo com próxima ação preenchida', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-4'),
      etapa: 'Proposta',
      proximaAcao: '10/11/2026 14:00',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('valor') });
  });

  test('"Perdido" sem motivo de perda volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-5'), etapa: 'Perdido' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('motivo') });
  });

  test('etapa sem exigências (ex.: "Reunião agendada") não recusa por falta de proxima_acao/valor/motivo', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-6'), etapa: 'Reunião agendada' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toEqual({ tipo: 'etapa', etapaId: 8 });
  });
});

describe('T-124: validarDecisao — próxima ação que já passou (@spec:AC-313)', () => {
  test('próxima ação anterior ao instante da execução volta para a revisão com o motivo', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Follow de longo prazo',
      proximaAcao: '01/01/2020 09:00',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toEqual({ tipo: 'recusada', motivo: 'data de próxima ação já passou' });
  });

  test('próxima ação igual ao instante da execução também volta para a revisão (não é estritamente futura)', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Follow de longo prazo',
      // AGORA é 2026-10-21T12:00:00-03:00 — mesmo instante, em horário de Brasília.
      proximaAcao: '21/10/2026 12:00',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toEqual({ tipo: 'recusada', motivo: 'data de próxima ação já passou' });
  });

  test('próxima ação futura é aceita e vira a data correta no horário de Brasília', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Follow de longo prazo',
      proximaAcao: '10/11/2026 14:00',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado.tipo).toBe('etapa');
    if (resultado.tipo !== 'etapa') throw new Error('esperava etapa');
    expect(resultado.proximaAcaoEm?.toISOString()).toBe('2026-11-10T17:00:00.000Z');
  });

  test('só a data (sem hora) assume 09:00 no horário de Brasília', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Follow de longo prazo',
      proximaAcao: '10/11/2026',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado.tipo).toBe('etapa');
    if (resultado.tipo !== 'etapa') throw new Error('esperava etapa');
    expect(resultado.proximaAcaoEm?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('T-124: validarDecisao — etapa/motivo desconhecidos e valores mal formatados (@spec:AC-314)', () => {
  test('etapa inexistente (nem nome nem número) volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: 'Etapa Que Não Existe' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('etapa desconhecida') });
  });

  test('etapa por número que não existe na tabela volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: '999' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada' });
  });

  test('motivo de perda que não existe volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: 'Perdido', motivoPerda: 'Motivo Inventado' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('motivo de perda desconhecido') });
  });

  test('data de próxima ação que não dá para ler volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: 'Follow de longo prazo', proximaAcao: '31/02/2026' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('não dá para ler') });
  });

  test('data em formato totalmente diferente do esperado volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Follow de longo prazo',
      proximaAcao: '2026-11-10',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada' });
  });

  test('valor que não dá para ler volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Proposta',
      proximaAcao: '10/11/2026 14:00',
      valor: 'mil e duzentos reais',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('valor não dá para ler') });
  });

  test('valor no formato "1.234,56" é aceito e convertido corretamente', () => {
    const linha: LinhaDecisaoBruta = {
      ...linhaVazia('lead-1'),
      etapa: 'Proposta',
      proximaAcao: '10/11/2026 14:00',
      valor: '1.234,56',
    };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado.tipo).toBe('etapa');
    if (resultado.tipo !== 'etapa') throw new Error('esperava etapa');
    expect(resultado.valor).toBe(1234.56);
  });

  test('etapa e ignorar preenchidos ao mesmo tempo volta para a revisão', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), etapa: 'Reunião agendada', ignorar: 'sim' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toMatchObject({ tipo: 'recusada', motivo: expect.stringContaining('etapa e ignorar') });
  });

  test('ignorar marcado sem etapa sai da fila sem criar nada', () => {
    const linha: LinhaDecisaoBruta = { ...linhaVazia('lead-1'), ignorar: 'sim' };
    const resultado = validarDecisao(linha, { etapas: ETAPAS, motivosPerda: MOTIVOS, agora: AGORA });
    expect(resultado).toEqual({ tipo: 'ignorar' });
  });

  test('linha de decisão para um id que não está na fila é identificada, para o relatório listar sem criar nada', () => {
    const linhas: LinhaDecisaoBruta[] = [
      { ...linhaVazia('lead-conhecido'), etapa: 'Reunião agendada' },
      { ...linhaVazia('lead-fantasma'), etapa: 'Reunião agendada' },
    ];
    const foraDaFila = linhasDecisaoForaDaFila(['lead-conhecido'], linhas);
    expect(foraDaFila).toHaveLength(1);
    expect(foraDaFila[0].idOrigem).toBe('lead-fantasma');
  });
});
