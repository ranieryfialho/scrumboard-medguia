// T-205 (fase4-analises, US-133): a tela de indicadores
// (src/components/analises/indicadores-funil.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { IndicadoresFunil } from '../../../src/components/analises/indicadores-funil';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const I = (numerador: number, denominador: number) => ({ valor: denominador ? numerador / denominador : null, numerador: denominador ? numerador : 0, denominador });
const KPIS = {
  conexao: I(330, 482),
  cumprimentoCadencia: I(1840, 2000),
  agendamento: I(127, 330),
  noShow: I(19, 127),
  proposta: I(68, 106),
  ativacaoTrial: { valor: null, numerador: 0, denominador: 12 },
  conversao: I(36, 68),
};
const FUNIL = { entrada: 482, conectados: 330, agendadas: 127, realizadas: 108, propostas: 68, ganhos: 36 };
const POR_RESPONSAVEL = [
  { responsavelId: 'u1', nome: 'Dra. Juliana Rocha', papel: 'GERENTE', atendidos: 342, cadenciaIniciada: 300, cadenciaEsgotada: 295, agendadas: 94, noShows: 10, propostas: 58, contratos: 20, winRate: 20 / 58, receitaGanha: 184200 },
  { responsavelId: null, nome: null, papel: null, atendidos: 12, cadenciaIniciada: 0, cadenciaEsgotada: 0, agendadas: 0, noShows: 0, propostas: 0, contratos: 0, winRate: null, receitaGanha: 0 },
];

describe('T-205: IndicadoresFunil', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let kpisStatus: number;
  let porResponsavel: typeof POR_RESPONSAVEL;

  const urls = (inicio: string) => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(inicio));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    kpisStatus = 200;
    porResponsavel = POR_RESPONSAVEL;
    fetchFalso = vi.fn((url: string) => {
      if (url.startsWith('/api/relatorios/kpis')) return kpisStatus === 200 ? resposta(200, KPIS) : resposta(kpisStatus, {});
      if (url.startsWith('/api/relatorios/funil')) return resposta(200, { funil: FUNIL, porResponsavel });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u1', nome: 'Dra. Juliana Rocha' }] });
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

  test('abre com o título dentro do grupo (app) e o padrão "Este mês" @spec:AC-555', async () => {
    render(<IndicadoresFunil />);
    expect(await screen.findByRole('heading', { name: 'Indicadores de Governança Comercial & Funil de Vendas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Este mês' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(urls('/api/relatorios/kpis')[0]).toBe('/api/relatorios/kpis?de=2026-11-01&ate=2026-11-30'));
    expect(urls('/api/relatorios/funil')[0]).toBe('/api/relatorios/funil?de=2026-11-01&ate=2026-11-30');
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/indicadores/page.tsx'))).toBe(true);
  });

  test('período, responsável e "Atualizar Métricas" pedem as duas APIs de novo @spec:AC-556', async () => {
    const u = usuario();
    render(<IndicadoresFunil />);
    await screen.findByRole('region', { name: 'Indicadores vitais' });
    await screen.findByRole('option', { name: 'Dra. Juliana Rocha' });
    await u.click(screen.getByRole('button', { name: 'Últimos 30 dias' }));
    await waitFor(() => expect(urls('/api/relatorios/funil').at(-1)).toBe('/api/relatorios/funil?de=2026-10-20&ate=2026-11-18'));
    await u.click(screen.getByRole('button', { name: 'Trimestre atual' }));
    await waitFor(() => expect(urls('/api/relatorios/kpis').at(-1)).toBe('/api/relatorios/kpis?de=2026-10-01&ate=2026-12-31'));
    await u.selectOptions(screen.getByLabelText('Responsável'), 'u1');
    await waitFor(() => expect(urls('/api/relatorios/kpis').at(-1)).toBe('/api/relatorios/kpis?de=2026-10-01&ate=2026-12-31&responsavelId=u1'));
    const antes = urls('/api/relatorios/funil').length;
    await u.click(screen.getByRole('button', { name: 'Atualizar Métricas' }));
    await waitFor(() => expect(urls('/api/relatorios/funil').length).toBeGreaterThan(antes));
  });

  test('os sete cartões mostram o valor e "N de M", ou "Sem dados", sem metas nem variação @spec:AC-558', async () => {
    render(<IndicadoresFunil />);
    const secao = await screen.findByRole('region', { name: 'Indicadores vitais' });
    expect(within(secao).getAllByRole('article')).toHaveLength(7);
    const conexao = within(secao).getByRole('article', { name: 'Taxa de Conexão' });
    expect(within(conexao).getByText('68,5%')).toBeTruthy();
    expect(within(conexao).getByText('330 de 482')).toBeTruthy();
    const trial = within(secao).getByRole('article', { name: 'Ativação em Trial' });
    expect(within(trial).getByText('Sem dados')).toBeTruthy();
    expect(within(secao).getByRole('article', { name: 'Conversão Final' }).textContent).toContain('36 de 68');
    expect(screen.queryByText(/vs mês|Meta:|Superada|Controlado|Excelente/i)).toBeFalsy();
  });

  test('o funil mostra as seis etapas com retenção e perda a partir da segunda @spec:AC-559', async () => {
    render(<IndicadoresFunil />);
    const funil = await screen.findByRole('region', { name: 'Funil de Conversão Comercial Contínuo' });
    const etapas = within(funil).getAllByRole('listitem');
    expect(etapas).toHaveLength(6);
    expect(etapas[0].textContent).toContain('Entrada de Leads');
    expect(etapas[0].textContent).toContain('482');
    expect(etapas[0].textContent).not.toMatch(/Retenção/);
    expect(etapas[1].textContent).toContain('Conexão Efetiva');
    expect(etapas[1].textContent).toContain('Retenção 68,5% · Perda 31,5%');
    expect(etapas[5].textContent).toContain('Contrato Assinado');
    expect(etapas[5].textContent).toContain('Retenção 52,9% · Perda 47,1%');
    expect(funil.textContent).not.toMatch(/Ciclo médio|Ticket|MRR/);
  });

  test('a tabela por responsável mostra os números, a receita e a linha sem responsável @spec:AC-560', async () => {
    render(<IndicadoresFunil />);
    const secao = await screen.findByRole('region', { name: 'Desempenho por Responsável' });
    const linhas = within(secao).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(2);
    expect(within(linhas[0]).getByText('Dra. Juliana Rocha')).toBeTruthy();
    expect(within(linhas[0]).getByText('GERENTE')).toBeTruthy();
    expect(within(linhas[0]).getByText('98,3%')).toBeTruthy(); // régua 295/300
    expect(within(linhas[0]).getByText('10,6%')).toBeTruthy(); // no-show 10/94
    expect(within(linhas[0]).getByText('34,5%')).toBeTruthy(); // win rate 20/58
    expect(within(linhas[0]).getByText(/184\.200/)).toBeTruthy();
    expect(within(linhas[1]).getByText('Sem responsável')).toBeTruthy();
    expect(within(secao).getByText('Mostrando 2 responsáveis')).toBeTruthy();
    expect(secao.textContent).not.toMatch(/Top Closer|@/);
    cleanup();

    porResponsavel = [];
    render(<IndicadoresFunil />);
    expect(await screen.findByText('Nenhum card neste período')).toBeTruthy();
  });

  test('Relatório Executivo e Exportar CSV aparecem "em breve" e a meta e os alertas não existem @spec:AC-561', async () => {
    render(<IndicadoresFunil />);
    await screen.findByRole('region', { name: 'Desempenho por Responsável' });
    for (const rotulo of ['Relatório Executivo', 'Exportar CSV']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Meta Comercial|Índice de Eficiência|Disparar Minutas|Risco de Esfriamento/i)).toBeFalsy();
  });

  test('"Configurar Metas" deixou de ser "em breve" e leva à tela de metas @spec:AC-626', async () => {
    render(<IndicadoresFunil />);
    await screen.findByRole('region', { name: 'Desempenho por Responsável' });
    expect(screen.getByRole('link', { name: /Configurar Metas/ }).getAttribute('href')).toBe('/configuracoes/metas');
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo", sem apagar os números @spec:AC-576', async () => {
    const u = usuario();
    render(<IndicadoresFunil />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Indicadores vitais' });
    kpisStatus = 500;
    await u.click(screen.getByRole('button', { name: 'Atualizar Métricas' }));
    expect(await screen.findByText(/Não foi possível carregar os indicadores/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Indicadores vitais' })).toBeTruthy();
  });
});
