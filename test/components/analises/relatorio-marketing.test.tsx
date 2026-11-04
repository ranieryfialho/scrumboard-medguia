// T-206 (fase4-analises, US-134): o relatório de marketing
// (src/components/analises/relatorio-marketing.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RelatorioMarketing } from '../../../src/components/analises/relatorio-marketing';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const DADOS = {
  resumo: { leads: 120, conectados: 80, reunioesRealizadas: 30, contratos: 6, conversaoFinal: 0.05 },
  agrupar: 'dia',
  serie: [
    { inicio: '2026-11-16', leads: 10, reunioes: 2 },
    { inicio: '2026-11-17', leads: 40, reunioes: 5 },
    { inicio: '2026-11-18', leads: 25, reunioes: 3 },
  ],
  porOrigem: [
    { origem: 'Google Ads', leads: 80, conectados: 50, reunioesRealizadas: 20, contratos: 5, conversaoFinal: 0.0625, valorGanho: 40000 },
    { origem: 'Sem origem', leads: 40, conectados: 30, reunioesRealizadas: 10, contratos: 1, conversaoFinal: 0.025, valorGanho: 8000 },
  ],
  origens: ['Google Ads', 'Sem origem'],
};

describe('T-206: RelatorioMarketing', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let corpo: typeof DADOS;
  let status: number;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    corpo = DADOS;
    status = 200;
    fetchFalso = vi.fn((url: string) => {
      if (url.startsWith('/api/relatorios/marketing')) {
        const agrupar = new URL(url, 'http://x').searchParams.get('agrupar');
        return status === 200 ? resposta(200, { ...corpo, agrupar: agrupar ?? corpo.agrupar }) : resposta(status, {});
      }
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup({ advanceTimers: () => undefined });

  test('abre com o título dentro do grupo (app) @spec:AC-562', async () => {
    render(<RelatorioMarketing />);
    expect(await screen.findByRole('heading', { name: 'Relatórios de Marketing, Tráfego e Atribuição' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/relatorios/page.tsx'))).toBe(true);
  });

  test('os cinco períodos, a origem e "Atualizar" pedem a API de novo; o padrão é 30 dias @spec:AC-564', async () => {
    const u = usuario();
    render(<RelatorioMarketing />);
    await screen.findByRole('region', { name: 'Desempenho por Origem' });
    // o período anterior é pedido antes, e a última chamada é sempre a do período na tela (T-315)
    expect(urls()).toContain('/api/relatorios/marketing?de=2026-10-20&ate=2026-11-18');
    expect(screen.getByRole('button', { name: 'Últimos 30 dias' }).getAttribute('aria-pressed')).toBe('true');
    await u.click(screen.getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/relatorios/marketing?de=2026-11-18&ate=2026-11-18'));
    await u.click(screen.getByRole('button', { name: 'Trimestre atual' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/relatorios/marketing?de=2026-10-01&ate=2026-12-31'));
    await u.selectOptions(screen.getByLabelText('Origem'), 'Google Ads');
    await waitFor(() => expect(urls().at(-1)).toBe('/api/relatorios/marketing?de=2026-10-01&ate=2026-12-31&origem=Google+Ads'));
    const antes = urls().length;
    await u.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(urls().length).toBeGreaterThan(antes));

    for (const titulo of ['Leads captados', 'Reuniões realizadas', 'Taxa de conversão']) {
      expect(screen.getAllByText(titulo).length).toBeGreaterThan(0);
    }
  });

  test('o gráfico mostra leads e reuniões e os botões Diário, Semanal e Mensal pedem o agrupamento @spec:AC-565', async () => {
    const u = usuario();
    render(<RelatorioMarketing />);
    const secao = await screen.findByRole('region', { name: 'Aquisição de Leads e Conversão por Período' });
    const grafico = within(secao).getByRole('img', { name: 'Leads captados e reuniões agendadas por período' });
    expect(grafico.querySelectorAll('polyline')).toHaveLength(2);
    expect(within(secao).getByRole('button', { name: 'Diário' }).getAttribute('aria-pressed')).toBe('true');
    await u.click(within(secao).getByRole('button', { name: 'Semanal' }));
    await waitFor(() => expect(urls().at(-1)).toMatch(/agrupar=semana/));
    expect(within(secao).getByRole('button', { name: 'Semanal' }).getAttribute('aria-pressed')).toBe('true');
    await u.click(within(secao).getByRole('button', { name: 'Mensal' }));
    await waitFor(() => expect(urls().at(-1)).toMatch(/agrupar=mes/));
    cleanup();

    corpo = { ...DADOS, resumo: { ...DADOS.resumo, leads: 0 }, serie: [{ inicio: '2026-11-18', leads: 0, reunioes: 0 }], porOrigem: [] };
    render(<RelatorioMarketing />);
    expect(await screen.findByText('Sem dados no período')).toBeTruthy();
  });

  test('a tabela por origem mostra os números e a linha de totais; sem leads avisa @spec:AC-566', async () => {
    render(<RelatorioMarketing />);
    const secao = await screen.findByRole('region', { name: 'Desempenho por Origem' });
    const linhas = within(secao).getAllByRole('row');
    expect(within(linhas[1]).getByText('Google Ads')).toBeTruthy();
    expect(within(linhas[1]).getByText('6,3%')).toBeTruthy();
    expect(within(linhas[1]).getByText(/40\.000/)).toBeTruthy();
    expect(within(linhas[2]).getByText('Sem origem')).toBeTruthy();
    const totais = linhas[3];
    expect(totais.textContent).toContain('Totais consolidados');
    expect(totais.textContent).toContain('120');
    expect(totais.textContent).toContain('5,0%'); // 6 ÷ 120
    expect(totais.textContent).toMatch(/48\.000/);
    cleanup();

    corpo = { ...DADOS, porOrigem: [] };
    render(<RelatorioMarketing />);
    expect(await screen.findByText('Nenhum lead neste período')).toBeTruthy();
  });

  test('exportar e o filtro de especialidade funcionam e o que depende de cliques e CPM não aparece @spec:AC-567', async () => {
    render(<RelatorioMarketing />);
    await screen.findByRole('region', { name: 'Desempenho por Origem' });
    expect((screen.getByRole('button', { name: 'Exportar Relatório (CSV)' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Especialidade' })).toBeTruthy();
    // o que o sistema não mede (cliques, CPM) nunca aparece
    expect(screen.queryByText(/CPM|Cliques e visitas/i)).toBeFalsy();
    expect(screen.queryByRole('group', { name: 'Custo de aquisição' })).toBeNull();
  });

  test('sem investimento no período os valores de custo ficam em traço e há o atalho para cadastrar @spec:AC-637', async () => {
    render(<RelatorioMarketing />);
    const tabela = await screen.findByRole('region', { name: 'Desempenho por Origem' });
    expect(screen.queryByRole('group', { name: 'Custo de aquisição' })).toBeNull();
    expect(within(screen.getByRole('article', { name: 'Investimento total em tráfego' })).getByText('—')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'CAC médio geral' })).getByText('—')).toBeTruthy();
    expect(within(tabela).getByRole('columnheader', { name: 'CPL' })).toBeTruthy();
    expect(within(within(tabela).getByRole('row', { name: /Google Ads/ })).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('link', { name: /Cadastrar investimento/ }).getAttribute('href')).toBe('/configuracoes/investimento');
  });

  test('com investimento aparecem os cartões e as colunas, com traço quando não há base @spec:AC-634 @spec:AC-636 @spec:AC-638', async () => {
    corpo = {
      ...DADOS,
      custo: { investimento: 4500, cpl: 50, cac: 500, roas: 6 },
      porOrigem: [
        { ...DADOS.porOrigem[0], investimento: 4000, cpl: 50, cac: 800, roas: 10 },
        { origem: 'TikTok Ads', leads: 0, conectados: 0, reunioesRealizadas: 0, contratos: 0, conversaoFinal: null, valorGanho: 0, investimento: 500, cpl: null, cac: null, roas: 0 },
      ],
    } as never;
    render(<RelatorioMarketing />);
    const investimento = await screen.findByRole('article', { name: 'Investimento total em tráfego' });
    expect(within(investimento).getByText(/4\.500/)).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'Leads captados' })).getByText(/CPL: R\$\s?50/)).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'CAC médio geral' })).getByText(/500/)).toBeTruthy();
    expect(within(screen.getByRole('article', { name: 'ROAS e receita nova' })).getByText('6,0x')).toBeTruthy();
    const tabela = screen.getByRole('region', { name: 'Desempenho por Origem' });
    for (const coluna of ['Investimento', 'CPL', 'CAC', 'ROAS']) expect(within(tabela).getByRole('columnheader', { name: coluna })).toBeTruthy();
    const linha = within(tabela).getByRole('row', { name: /TikTok Ads/ });
    expect(within(linha).getAllByText('—')).toHaveLength(3); // conversão final, CPL e CAC
    expect(within(linha).getByText('0,0x')).toBeTruthy();
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-576', async () => {
    render(<RelatorioMarketing />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Desempenho por Origem' });
    cleanup();

    status = 500;
    render(<RelatorioMarketing />);
    expect(await screen.findByText(/Não foi possível carregar o relatório/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
