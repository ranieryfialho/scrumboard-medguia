// T-258 (fase5-meta-receita, US-167): o selo da meta de receita no cartão "Novo MRR contratado" do relatório comercial.
// Relógio fixado em 18/11/2026: "Este mês" = 2026-11-01 a 2026-11-30.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RelatorioComercial } from '../../../src/components/analises/relatorio-comercial';

const resposta = (status: number, corpo: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });

const dados = (mrrNovo: number) => ({
  resumo: { mrrNovo, contratos: 5, ticketMedio: 8000, pipelineEmNegociacao: { valor: 100000, propostas: 10 }, cicloMedioDias: 12, winRate: { valor: 0.3, ganhos: 3, perdas: 7 } },
  semanal: [],
  ranking: [],
  motivosPerda: [],
  totalPerdas: 0,
});

describe('T-258: selo da meta de receita', () => {
  const fetchOriginal = globalThis.fetch;
  let mrr: number;
  let metasDaEmpresa: Record<string, number>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    mrr = 62000;
    metasDaEmpresa = { receita_mensal: 50000, taxa_conversao: 25 };
    globalThis.fetch = vi.fn((url: string) => {
      if (url.startsWith('/api/relatorios/comercial')) return resposta(200, dados(mrr));
      if (url === '/api/metas') return resposta(200, { metas: metasDaEmpresa, detalhes: [] });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u1', nome: 'Dra. Juliana Rocha' }] });
      return resposta(404, {});
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });
  const usuario = () => userEvent.setup({ advanceTimers: () => undefined });
  const cartao = async () => (await screen.findByText('Novo MRR contratado')).closest('div.bg-surface-card') as HTMLElement;

  test('no mês inteiro mostra a meta e o selo quando o MRR alcança (igualdade conta); abaixo, só a meta @spec:AC-690', async () => {
    const { unmount } = render(<RelatorioComercial />);
    await waitFor(async () => expect(within(await cartao()).getByText(/Meta R\$\s50\.000/)).toBeTruthy());
    expect(within(await cartao()).getByText('Meta atingida')).toBeTruthy();
    unmount();

    mrr = 50000;
    const igual = render(<RelatorioComercial />);
    await waitFor(async () => expect(within(await cartao()).getByText('Meta atingida')).toBeTruthy());
    igual.unmount();

    mrr = 40000;
    render(<RelatorioComercial />);
    await waitFor(async () => expect(within(await cartao()).getByText(/Meta R\$\s50\.000/)).toBeTruthy());
    expect(within(await cartao()).queryByText('Meta atingida')).toBeNull();
    // o win rate segue com a meta de conversão, como antes
    expect(screen.getByText('Meta 25%')).toBeTruthy();
  });

  test('em outros períodos, com filtro de responsável ou sem meta cadastrada o cartão não mostra meta @spec:AC-691', async () => {
    const u = usuario();
    render(<RelatorioComercial />);
    await waitFor(async () => expect(within(await cartao()).getByText(/Meta R\$\s50\.000/)).toBeTruthy());

    for (const periodo of ['Hoje', 'Últimos 7 dias', 'Últimos 30 dias', 'Trimestre atual']) {
      await u.click(screen.getByRole('button', { name: periodo }));
      await waitFor(async () => expect(within(await cartao()).queryByText(/Meta R\$/)).toBeNull());
      expect(within(await cartao()).queryByText('Meta atingida')).toBeNull();
    }
    await u.click(screen.getByRole('button', { name: 'Este mês' }));
    await waitFor(async () => expect(within(await cartao()).getByText(/Meta R\$\s50\.000/)).toBeTruthy());
    await u.selectOptions(await screen.findByRole('option', { name: 'Dra. Juliana Rocha' }).then((o) => o.closest('select')!), 'u1');
    await waitFor(async () => expect(within(await cartao()).queryByText(/Meta R\$/)).toBeNull());
    cleanup();

    metasDaEmpresa = { taxa_conversao: 25 };
    render(<RelatorioComercial />);
    await screen.findByText('Meta 25%');
    expect(within(await cartao()).queryByText(/Meta R\$/)).toBeNull();
  });
});
