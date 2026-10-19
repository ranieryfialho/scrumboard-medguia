// Testes de T-116 (fase3-etl-sheets, US-075): deduplicação entre abas e
// resolução de conflito (src/etl/sheets/dedupe.ts). Função pura — sem rede
// nem Postgres.
import { describe, expect, test } from 'vitest';

import { deduplicarLeads, type LeadComOrigem } from '../../src/etl/sheets/dedupe';
import type { LeadBruto } from '../../src/etl/sheets/leitor';

function leadBruto(sobrescritas: Partial<LeadBruto> & { metaId: string }): LeadBruto {
  return {
    linha: 0,
    nome: 'Lead Teste',
    especialidade: 'Cardiologia',
    telefone: '+5511999998888',
    email: 'lead@exemplo.com',
    situacaoBruta: '',
    camposExtras: {},
    ...sobrescritas,
  };
}

describe('T-116: deduplicarLeads — mesmo lead em várias abas vira um só (@spec:AC-275)', () => {
  test('mesmo metaId em duas abas diferentes gera um único lead', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:1', situacaoBruta: 'Novos Leads' }),
      },
      {
        origem: { planilha: 'sheet2', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:1', situacaoBruta: 'Novos Leads' }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].lead.metaId).toBe('l:1');
    expect(resultado.leads[0].origens).toEqual([
      { planilha: 'sheet1', aba: 'Página1' },
      { planilha: 'sheet2', aba: 'Página1' },
    ]);
    expect(resultado.conflitos).toEqual([]);
  });

  test('mesmo metaId com created_time em fusos diferentes continua sendo um único lead', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({
          metaId: 'l:2',
          situacaoBruta: 'Novos Leads',
          camposExtras: { created_time: '2026-09-15T16:06:12-05:00' },
        }),
      },
      {
        origem: { planilha: 'sheet1', aba: 'Página2' },
        lead: leadBruto({
          metaId: 'l:2',
          situacaoBruta: 'Novos Leads',
          camposExtras: { created_time: '2026-09-15T18:06:12-03:00' },
        }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(1);
    expect(resultado.conflitos).toEqual([]);
  });

  test('metaIds diferentes permanecem como leads distintos', () => {
    const entradas: LeadComOrigem[] = [
      { origem: { planilha: 'sheet1', aba: 'Página1' }, lead: leadBruto({ metaId: 'l:3' }) },
      { origem: { planilha: 'sheet2', aba: 'Página1' }, lead: leadBruto({ metaId: 'l:4' }) },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(2);
    expect(resultado.leads.map((l) => l.lead.metaId).sort()).toEqual(['l:3', 'l:4']);
  });

  test('leads sem metaId (aba sem a coluna id) não são deduplicados entre si', () => {
    const entradas: LeadComOrigem[] = [
      { origem: { planilha: 'sheet1', aba: 'Página1' }, lead: leadBruto({ metaId: '' }) },
      { origem: { planilha: 'sheet1', aba: 'Página1' }, lead: leadBruto({ metaId: '' }) },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(2);
    expect(resultado.conflitos).toEqual([]);
  });
});

describe('T-116: deduplicarLeads — conflito de status vence a alteração mais recente (@spec:AC-276)', () => {
  test('data_alteracao mais recente vence, mesmo vindo de aba lida depois', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({
          metaId: 'l:5',
          situacaoBruta: 'Reunião agendada',
          camposExtras: { data_alteracao: '10/09/2026, 10:00:00' },
        }),
      },
      {
        origem: { planilha: 'sheet2', aba: 'Página1' },
        lead: leadBruto({
          metaId: 'l:5',
          situacaoBruta: 'Fechado',
          camposExtras: { data_alteracao: '15/09/2026, 18:06:12' },
        }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].lead.situacaoBruta).toBe('Fechado');
    expect(resultado.conflitos).toEqual([
      {
        metaId: 'l:5',
        situacoes: ['Reunião agendada', 'Fechado'],
        situacaoVencedora: 'Fechado',
        origens: [
          { planilha: 'sheet1', aba: 'Página1' },
          { planilha: 'sheet2', aba: 'Página1' },
        ],
        motivoDecisao: 'data_alteracao',
      },
    ]);
  });

  test('sem data em nenhum lado, vence o status mais avançado do funil', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:6', situacaoBruta: 'Novos Leads' }),
      },
      {
        origem: { planilha: 'sheet2', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:6', situacaoBruta: 'Reunião agendada' }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(1);
    expect(resultado.leads[0].lead.situacaoBruta).toBe('Reunião agendada');
    expect(resultado.conflitos[0]).toMatchObject({
      metaId: 'l:6',
      situacaoVencedora: 'Reunião agendada',
      motivoDecisao: 'status_mais_avancado',
    });
  });

  test('status igual nas duas ocorrências não é conflito', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:7', situacaoBruta: 'Reunião agendada' }),
      },
      {
        origem: { planilha: 'sheet3', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:7', situacaoBruta: 'reuniao agendada' }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads).toHaveLength(1);
    expect(resultado.conflitos).toEqual([]);
  });

  test('uma ocorrência com data válida vence mesmo que a outra não tenha data', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:8', situacaoBruta: 'Novos Leads' }),
      },
      {
        origem: { planilha: 'sheet2', aba: 'Página1' },
        lead: leadBruto({
          metaId: 'l:8',
          situacaoBruta: 'Desqualificado',
          camposExtras: { data_alteracao: '15/09/2026, 18:06:12' },
        }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads[0].lead.situacaoBruta).toBe('Desqualificado');
    expect(resultado.conflitos[0].motivoDecisao).toBe('data_alteracao');
  });

  test('conflito entre três ocorrências relata todas as situações e origens', () => {
    const entradas: LeadComOrigem[] = [
      {
        origem: { planilha: 'sheet1', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:9', situacaoBruta: 'Novos Leads' }),
      },
      {
        origem: { planilha: 'sheet1', aba: 'Página2' },
        lead: leadBruto({ metaId: 'l:9', situacaoBruta: 'Recontato' }),
      },
      {
        origem: { planilha: 'sheet2', aba: 'Página1' },
        lead: leadBruto({ metaId: 'l:9', situacaoBruta: 'Aguardando Ativação' }),
      },
    ];

    const resultado = deduplicarLeads(entradas);

    expect(resultado.leads[0].lead.situacaoBruta).toBe('Aguardando Ativação');
    expect(resultado.conflitos[0].situacoes).toEqual(['Novos Leads', 'Recontato', 'Aguardando Ativação']);
    expect(resultado.conflitos[0].origens).toHaveLength(3);
  });
});
