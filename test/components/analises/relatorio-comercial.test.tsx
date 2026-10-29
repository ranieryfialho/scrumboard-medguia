// T-207 (fase4-analises, US-135): o relatório comercial
// (src/components/analises/relatorio-comercial.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RelatorioComercial } from '../../../src/components/analises/relatorio-comercial';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const L = (id: string | null, nome: string | null, o: Partial<Record<string, number | null>> = {}) => ({
  responsavelId: id, nome, reunioesRealizadas: 0, propostas: 0, contratos: 0, perdas: 0, winRate: null, cicloMedioDias: null, ticketMedio: null, valorFechado: 0, ...o,
});

interface Resumo {
  mrrNovo: number;
  contratos: number;
  ticketMedio: number | null;
  pipelineEmNegociacao: { valor: number; propostas: number };
  cicloMedioDias: number | null;
  winRate: { valor: number | null; ganhos: number; perdas: number };
}
const RESUMO: Resumo = { mrrNovo: 428000, contratos: 51, ticketMedio: 8392, pipelineEmNegociacao: { valor: 1124500, propostas: 82 }, cicloMedioDias: 14.2, winRate: { valor: 0.348, ganhos: 51, perdas: 95 } };

const DADOS = {
  resumo: RESUMO,
  semanal: [
    { inicio: '2026-11-02', valorFechado: 20000, pipelineCriado: 50000 },
    { inicio: '2026-11-09', valorFechado: 142000, pipelineCriado: 110000 },
    { inicio: '2026-11-16', valorFechado: 60000, pipelineCriado: 80000 },
  ],
  ranking: [
    L('u1', 'Dra. Juliana Rocha', { reunioesRealizadas: 38, propostas: 32, contratos: 21, perdas: 27, winRate: 0.4375, cicloMedioDias: 11.4, ticketMedio: 8760, valorFechado: 184000 }),
    L('u2', 'Carlos Mendes', { reunioesRealizadas: 36, propostas: 26, contratos: 10, perdas: 28, winRate: 0.263, cicloMedioDias: 17.5, ticketMedio: 8100, valorFechado: 81000 }),
    L('u3', 'Gabriela Siqueira', { reunioesRealizadas: 25, propostas: 18, contratos: 12, perdas: 3, winRate: 0.8, cicloMedioDias: 19.2, ticketMedio: 5050, valorFechado: 60600 }),
  ],
  motivosPerda: [
    { motivo: 'Decisão adiada', quantidade: 14, percentual: 36.8 },
    { motivo: 'Integração complexa', quantidade: 11, percentual: 28.9 },
    { motivo: 'Preço', quantidade: 7, percentual: 18.4 },
    { motivo: 'Concorrente', quantidade: 4, percentual: 10.5 },
    { motivo: 'Contato perdido', quantidade: 1, percentual: 2.6 },
    { motivo: 'Sem motivo informado', quantidade: 1, percentual: 2.6 },
  ],
  totalPerdas: 38,
};

describe('T-207: RelatorioComercial', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let corpo: typeof DADOS;
  let status: number;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/relatorios/comercial'));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    corpo = DADOS;
    status = 200;
    fetchFalso = vi.fn((url: string) => {
      if (url.startsWith('/api/relatorios/comercial')) return status === 200 ? resposta(200, corpo) : resposta(status, {});
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

  test('abre com o título dentro do grupo (app) e os filtros de período e responsável pedem a API de novo @spec:AC-568', async () => {
    const u = usuario();
    render(<RelatorioComercial />);
    expect(await screen.findByRole('heading', { name: 'Relatórios Comerciais e Produtividade de Vendas' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/relatorios-comerciais/page.tsx'))).toBe(true);
    await screen.findByRole('region', { name: 'Ranking da Equipe Comercial' });
    expect(urls()[0]).toBe('/api/relatorios/comercial?de=2026-11-01&ate=2026-11-30');
    await screen.findByRole('option', { name: 'Dra. Juliana Rocha' });
    await u.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/relatorios/comercial?de=2026-11-12&ate=2026-11-18'));
    await u.selectOptions(screen.getByLabelText('Responsável'), 'u1');
    await waitFor(() => expect(urls().at(-1)).toBe('/api/relatorios/comercial?de=2026-11-12&ate=2026-11-18&responsavelId=u1'));
  });

  test('os quatro cartões mostram MRR, pipeline, ciclo e win rate, sem meta nem ponderado @spec:AC-570', async () => {
    render(<RelatorioComercial />);
    await screen.findByText('Novo MRR contratado');
    expect(screen.getByText(/428\.000/)).toBeTruthy();
    expect(screen.getByText(/\/mês · 51 contratos · ticket médio R\$\s?8\.392/)).toBeTruthy();
    expect(screen.getByText(/1\.124\.500/)).toBeTruthy();
    expect(screen.getByText('82 propostas')).toBeTruthy();
    expect(screen.getAllByText('14,2 dias').length).toBeGreaterThan(0);
    expect(screen.getByText('34,8%')).toBeTruthy();
    expect(screen.getByText('51 ganhos · 95 perdas')).toBeTruthy();
    expect(screen.queryByText(/Meta alcançada|Ponderado|Inbound|Outbound/)).toBeFalsy();
    cleanup();

    corpo = { ...DADOS, resumo: { ...DADOS.resumo, mrrNovo: 0, contratos: 0, ticketMedio: null, cicloMedioDias: null, winRate: { valor: null, ganhos: 0, perdas: 0 } } };
    render(<RelatorioComercial />);
    await screen.findByText('Novo MRR contratado');
    expect(screen.getByText('0 ganhos · 0 perdas')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  test('o gráfico semanal mostra as duas linhas e "Sem dados no período" quando não há valor @spec:AC-571', async () => {
    render(<RelatorioComercial />);
    const secao = await screen.findByRole('region', { name: 'Evolução Semanal de Receita Ganha vs Pipeline Criado' });
    const grafico = within(secao).getByRole('img', { name: 'Valor fechado e valor de propostas geradas por semana' });
    expect(grafico.querySelectorAll('polyline')).toHaveLength(2);
    expect(within(secao).getAllByText('Novo MRR assinado (R$)').length).toBeGreaterThan(0);
    expect(secao.textContent).not.toMatch(/Melhor dia|Ticket campeão|Desconto/i);
    cleanup();

    corpo = { ...DADOS, semanal: DADOS.semanal.map((s) => ({ ...s, valorFechado: 0, pipelineCriado: 0 })) };
    render(<RelatorioComercial />);
    expect(await screen.findByText('Sem dados no período')).toBeTruthy();
  });

  test('o ranking ordena por valor, win rate ou contratos e fecha com a linha de totais @spec:AC-572', async () => {
    const u = usuario();
    render(<RelatorioComercial />);
    const secao = await screen.findByRole('region', { name: 'Ranking da Equipe Comercial' });
    const nomes = () => within(secao).getAllByRole('row').slice(1, -1).map((l) => within(l).getAllByRole('cell')[0].textContent);
    expect(nomes()).toEqual(['Dra. Juliana Rocha', 'Carlos Mendes', 'Gabriela Siqueira']);
    await u.selectOptions(within(secao).getByLabelText('Ordenar por'), 'winrate');
    expect(nomes()).toEqual(['Gabriela Siqueira', 'Dra. Juliana Rocha', 'Carlos Mendes']);
    await u.selectOptions(within(secao).getByLabelText('Ordenar por'), 'contratos');
    expect(nomes()).toEqual(['Dra. Juliana Rocha', 'Gabriela Siqueira', 'Carlos Mendes']);

    const linhas = within(secao).getAllByRole('row');
    const totais = linhas[linhas.length - 1];
    expect(totais.textContent).toContain('Totais consolidados');
    expect(within(totais).getAllByRole('cell')[1].textContent).toBe('99'); // reuniões 38+36+25
    expect(within(totais).getAllByRole('cell')[3].textContent).toBe('43'); // contratos 21+10+12
    expect(totais.textContent).toMatch(/325\.600/); // valor fechado
    expect(totais.textContent).toContain('14,2 dias');
    cleanup();

    corpo = { ...DADOS, ranking: [] };
    render(<RelatorioComercial />);
    expect(await screen.findByText('Nenhum card neste período')).toBeTruthy();
  });

  test('os motivos de perda mostram os cinco primeiros, "Outros" e o total; sem perdas avisa @spec:AC-573', async () => {
    render(<RelatorioComercial />);
    const secao = await screen.findByRole('region', { name: 'Motivos de Perda no Ciclo' });
    expect(within(secao).getByText('38 perdas')).toBeTruthy();
    const itens = within(secao).getAllByRole('listitem');
    expect(itens).toHaveLength(6);
    expect(itens[0].textContent).toContain('Decisão adiada');
    expect(itens[0].textContent).toContain('14 (36,8%)');
    expect(itens[5].textContent).toContain('Outros');
    expect(itens[5].textContent).toContain('1 (2,6%)');
    expect(secao.textContent).not.toContain('Sem motivo informado');
    cleanup();

    corpo = { ...DADOS, motivosPerda: [{ motivo: 'Sem motivo informado', quantidade: 2, percentual: 100 }], totalPerdas: 2 };
    render(<RelatorioComercial />);
    expect(await screen.findByText('Sem motivo informado')).toBeTruthy();
    cleanup();

    corpo = { ...DADOS, motivosPerda: [], totalPerdas: 0 };
    render(<RelatorioComercial />);
    expect(await screen.findByText('Nenhuma perda no período')).toBeTruthy();
  });

  test('exportar e especialidade ficam "em breve" e a distribuição por especialidade não aparece @spec:AC-574', async () => {
    render(<RelatorioComercial />);
    await screen.findByRole('region', { name: 'Ranking da Equipe Comercial' });
    for (const rotulo of ['Exportar Dados (CSV/XLSX)', 'Filtrar por especialidade']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Distribuição por Especialidade|Meta atingida|107%/i)).toBeFalsy();
  });

  test('"Configurar Metas de Vendas" leva à tela de metas @spec:AC-626', async () => {
    render(<RelatorioComercial />);
    await screen.findByRole('region', { name: 'Ranking da Equipe Comercial' });
    expect(screen.getByRole('link', { name: /Configurar Metas de Vendas/ }).getAttribute('href')).toBe('/configuracoes/metas');
  });

  test('o win rate mostra a meta de conversão e "Meta atingida" quando alcança (igualdade conta) @spec:AC-623', async () => {
    const base = fetchFalso.getMockImplementation()!;
    corpo = { ...DADOS, resumo: { ...RESUMO, winRate: { valor: 0.25, ganhos: 1, perdas: 3 } } };
    fetchFalso.mockImplementation((url: string) => (url === '/api/metas' ? resposta(200, { metas: { taxa_conversao: 25 }, detalhes: [] }) : base(url)));
    render(<RelatorioComercial />);
    expect(await screen.findByText('Meta 25%')).toBeTruthy();
    expect(screen.getByText('Meta atingida')).toBeTruthy();
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-576', async () => {
    render(<RelatorioComercial />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Ranking da Equipe Comercial' });
    cleanup();

    status = 500;
    render(<RelatorioComercial />);
    expect(await screen.findByText(/Não foi possível carregar o relatório/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
