// fase6-perdas-por-lead (US-194): a lista "Leads perdidos" (relatório comercial) e o resumo de motivos dos leads captados (marketing).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ListaLeadsPerdidos, type LeadPerdidoView } from '../../../src/components/analises/lista-leads-perdidos';
import { MotivosDosCaptadosBloco } from '../../../src/components/analises/motivos-captados';
import { RelatorioComercial } from '../../../src/components/analises/relatorio-comercial';

afterEach(cleanup);

const perdido = (n: number, parcial: Partial<LeadPerdidoView> = {}): LeadPerdidoView => ({
  oportunidadeId: `op-${n}`,
  lead: `Lead ${n}`,
  responsavel: 'Ana',
  motivo: 'Preço',
  etapaOrigem: 'Proposta',
  origem: 'BM MedGuia',
  perdidoEm: '2026-02-15T13:00:00.000Z',
  ...parcial,
});

describe('fase6-perdas-por-lead: lista de leads perdidos', () => {
  test('uma linha por lead com responsável, motivo, etapa, origem e data; o nome leva ao card @spec:AC-816', () => {
    render(<ListaLeadsPerdidos leads={[perdido(1), perdido(2, { responsavel: null, etapaOrigem: null, origem: null })]} filtroMotivo={null} onLimparFiltro={() => undefined} />);
    const lista = screen.getByRole('region', { name: 'Leads perdidos' });
    const linhas = within(lista).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('Lead 1');
    expect(linhas[0].textContent).toContain('Ana');
    expect(linhas[0].textContent).toContain('Preço');
    expect(linhas[0].textContent).toContain('Proposta');
    expect(linhas[0].textContent).toContain('BM MedGuia');
    expect(linhas[0].textContent).toContain('15/02/2026');
    expect(within(lista).getByRole('link', { name: 'Lead 1' }).getAttribute('href')).toBe('/pipeline/op-1');
    expect(linhas[1].textContent).toContain('Sem responsável');
  });

  test('pagina de 10 em 10, com 20, 50 e 100 no seletor @spec:AC-816', async () => {
    const u = userEvent.setup();
    render(<ListaLeadsPerdidos leads={Array.from({ length: 25 }, (_, i) => perdido(i + 1))} filtroMotivo={null} onLimparFiltro={() => undefined} />);
    const lista = screen.getByRole('region', { name: 'Leads perdidos' });
    expect(within(lista).getAllByRole('row').slice(1)).toHaveLength(10);

    await u.click(within(lista).getByRole('button', { name: 'Próxima página' }));
    expect(within(lista).getByRole('link', { name: 'Lead 11' })).toBeTruthy();

    const seletor = within(lista).getByLabelText('Itens por página') as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(['10', '20', '50', '100']);
    await u.selectOptions(seletor, '20');
    expect(within(lista).getAllByRole('row').slice(1)).toHaveLength(20);
  });

  test('sem perdas avisa, e com filtro ativo mostra o motivo e o "Limpar" @spec:AC-817', async () => {
    const limpar = vi.fn();
    const u = userEvent.setup();
    const { rerender } = render(<ListaLeadsPerdidos leads={[]} filtroMotivo={null} onLimparFiltro={limpar} />);
    expect(screen.getByText('Nenhum lead perdido no período.')).toBeTruthy();

    rerender(<ListaLeadsPerdidos leads={[]} filtroMotivo="Preço" onLimparFiltro={limpar} />);
    expect(screen.getByText('Nenhum lead perdido por este motivo no período.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(limpar).toHaveBeenCalledTimes(1);
  });
});

describe('fase6-perdas-por-lead: clicar no motivo filtra a lista (relatório comercial)', () => {
  const fetchOriginal = globalThis.fetch;
  const resposta = (corpo: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
  const motivos = ['Decisão adiada', 'Integração complexa', 'Preço', 'Concorrente', 'Contato perdido', 'Sem interesse', 'Outro motivo'];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    const dados = {
      resumo: { mrrNovo: 0, contratos: 0, ticketMedio: null, pipelineEmNegociacao: { valor: 0, propostas: 0 }, cicloMedioDias: null, winRate: { valor: 0, ganhos: 0, perdas: 7 } },
      semanal: [],
      ranking: [],
      motivosPerda: motivos.map((motivo) => ({ motivo, quantidade: 1, percentual: 14.3 })),
      totalPerdas: 7,
      leadsPerdidos: motivos.map((motivo, i) => perdido(i + 1, { motivo, lead: `Lead de ${motivo}` })),
    };
    globalThis.fetch = vi.fn((url: string) => (String(url).startsWith('/api/relatorios/comercial') ? resposta(dados) : resposta({ responsaveis: [] }))) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  test('o motivo clicado fica destacado e filtra a lista; clicar de novo, ou "Limpar", volta à completa @spec:AC-817 @spec:AC-816', async () => {
    const u = userEvent.setup({ advanceTimers: () => undefined });
    render(<RelatorioComercial />);
    const lista = await screen.findByRole('region', { name: 'Leads perdidos' });
    expect(within(lista).getAllByRole('row').slice(1)).toHaveLength(7); // o número de linhas = total de perdas do bloco de motivos

    const bloco = screen.getByRole('region', { name: 'Motivos de Perda no Ciclo' });
    const preco = within(bloco).getByRole('button', { name: /Preço/ });
    await u.click(preco);
    expect(preco.getAttribute('aria-pressed')).toBe('true');
    const filtrada = within(screen.getByRole('region', { name: 'Leads perdidos' }));
    expect(filtrada.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(filtrada.getByRole('link', { name: 'Lead de Preço' })).toBeTruthy();
    expect(filtrada.getByText('Motivo: Preço')).toBeTruthy();

    await u.click(preco); // clicar de novo volta à lista completa
    expect(within(screen.getByRole('region', { name: 'Leads perdidos' })).getAllByRole('row').slice(1)).toHaveLength(7);

    await u.click(preco);
    await u.click(within(screen.getByRole('region', { name: 'Leads perdidos' })).getByRole('button', { name: 'Limpar' }));
    expect(within(screen.getByRole('region', { name: 'Leads perdidos' })).getAllByRole('row').slice(1)).toHaveLength(7);
  });

  test('"Outros" filtra por todos os motivos que ficaram fora dos cinco primeiros @spec:AC-817', async () => {
    const u = userEvent.setup({ advanceTimers: () => undefined });
    render(<RelatorioComercial />);
    await screen.findByRole('region', { name: 'Leads perdidos' });
    await u.click(within(screen.getByRole('region', { name: 'Motivos de Perda no Ciclo' })).getByRole('button', { name: /Outros/ }));
    const linhas = within(screen.getByRole('region', { name: 'Leads perdidos' })).getAllByRole('row').slice(1);
    expect(linhas.map((l) => l.textContent)).toEqual([expect.stringContaining('Sem interesse'), expect.stringContaining('Outro motivo')]);
  });
});

describe('fase6-perdas-por-lead: motivos dos leads captados (marketing)', () => {
  test('mostra "N de M" e o ranking de motivos com quantidade e porcentagem @spec:AC-819', () => {
    render(
      <MotivosDosCaptadosBloco
        dados={{ perdidos: 3, captados: 10, motivos: [{ motivo: 'Sem interesse', quantidade: 2, percentual: 66.7 }, { motivo: 'Preço', quantidade: 1, percentual: 33.3 }] }}
      />
    );
    const bloco = screen.getByRole('region', { name: 'Motivos de perda dos leads captados' });
    expect(within(bloco).getByText('3 de 10 leads captados perdidos')).toBeTruthy();
    const itens = within(bloco).getAllByRole('listitem');
    expect(itens[0].textContent).toContain('1. Sem interesse');
    expect(itens[0].textContent).toContain('2 (66,7%)');
    expect(itens[1].textContent).toContain('1 (33,3%)');
  });

  test('sem perdas entre os captados avisa @spec:AC-819', () => {
    render(<MotivosDosCaptadosBloco dados={{ perdidos: 0, captados: 8, motivos: [] }} />);
    expect(screen.getByText('Nenhuma perda entre os leads captados')).toBeTruthy();
    expect(screen.getByText('0 de 8 leads captados perdidos')).toBeTruthy();
  });
});
