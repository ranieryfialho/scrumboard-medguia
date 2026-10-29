// T-228 (fase5-investimento-midia, US-147): a tela de investimento em mídia (src/components/admin/investimento.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Investimento } from '../../../src/components/admin/investimento';

describe('T-228: tela de investimento', () => {
  let chamadas: Array<{ url: string; init?: RequestInit }>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:00:00Z'));
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'PUT') {
          const { mes, valores } = JSON.parse(String(init.body)) as { mes: string; valores: Record<string, number | null> };
          const canais = Object.entries(valores).map(([canal, valor]) => ({ canal, valor }));
          return new Response(JSON.stringify({ mes, canais, total: canais.reduce((s, c) => s + (c.valor ?? 0), 0) }));
        }
        const mes = new URL(url, 'http://x').searchParams.get('mes');
        return new Response(JSON.stringify({ mes, canais: [{ canal: 'Google Ads', valor: 2000 }, { canal: 'Meta Ads', valor: null }], total: 2000 }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const usuario = () => userEvent.setup({ advanceTimers: () => undefined });

  test('abre no mês atual com uma linha por canal, o valor ou o campo vazio, e o total @spec:AC-627', async () => {
    const u = usuario();
    render(<Investimento />);
    expect(await screen.findByLabelText('Google Ads')).toBeTruthy();
    expect(chamadas[0].url).toBe('/api/investimento?mes=2026-10');
    expect(screen.getByRole('status', { name: 'Mês' }).textContent).toMatch(/outubro de 2026/i);
    expect((screen.getByLabelText('Google Ads') as HTMLInputElement).value).toBe('2000,00');
    expect((screen.getByLabelText('Meta Ads') as HTMLInputElement).placeholder).toBe('Sem investimento');
    expect(screen.getByText(/Total do mês: R\$\s*2\.000,00/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }));
    await waitFor(() => expect(chamadas.at(-1)!.url).toBe('/api/investimento?mes=2026-09'));
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }));
    await waitFor(() => expect(chamadas.at(-1)!.url).toBe('/api/investimento?mes=2026-10'));
  });

  test('salvar envia os valores e confirma "Investimento salvo" com o total novo @spec:AC-628', async () => {
    const u = usuario();
    render(<Investimento />);
    await u.type(await screen.findByLabelText('Meta Ads'), '4.500,50');
    await u.click(screen.getByRole('button', { name: 'Salvar investimento' }));
    expect(await screen.findByText('Investimento salvo')).toBeTruthy();
    const put = chamadas.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body))).toEqual({ mes: '2026-10', valores: { 'Google Ads': 2000, 'Meta Ads': 4500.5 } });
  });

  test('valor inválido avisa e não chama a API @spec:AC-629', async () => {
    const u = usuario();
    render(<Investimento />);
    for (const ruim of ['0', 'abc', '10.000.000,00']) {
      const campo = await screen.findByLabelText('Meta Ads');
      await u.clear(campo);
      await u.type(campo, ruim);
      await u.click(screen.getByRole('button', { name: 'Salvar investimento' }));
      expect((await screen.findByRole('alert')).textContent).toContain('R$ 0,01 a R$ 9.999.999,99');
    }
    expect(chamadas.some((c) => c.init?.method === 'PUT')).toBe(false);
  });

  test('limpar o campo remove o investimento do canal @spec:AC-630', async () => {
    const u = usuario();
    render(<Investimento />);
    await u.clear(await screen.findByLabelText('Google Ads'));
    await u.click(screen.getByRole('button', { name: 'Salvar investimento' }));
    await screen.findByText('Investimento salvo');
    expect(JSON.parse(String(chamadas.find((c) => c.init?.method === 'PUT')!.init!.body)).valores['Google Ads']).toBeNull();
  });

  test('adiciona um canal novo; nome repetido por maiúsculas usa o existente e nome curto é recusado @spec:AC-631', async () => {
    const u = usuario();
    render(<Investimento />);
    await screen.findByLabelText('Meta Ads');
    await u.type(screen.getByLabelText('Novo canal'), 'x');
    await u.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect((await screen.findByRole('alert')).textContent).toContain('de 2 a 60');
    await u.clear(screen.getByLabelText('Novo canal'));
    await u.type(screen.getByLabelText('Novo canal'), ' meta  ads ');
    await u.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    expect(screen.getAllByLabelText(/meta ads/i)).toHaveLength(1);
    await u.type(screen.getByLabelText('Novo canal'), 'TikTok Ads');
    await u.click(screen.getByRole('button', { name: 'Adicionar canal' }));
    await u.type(await screen.findByLabelText('TikTok Ads'), '700');
    await u.click(screen.getByRole('button', { name: 'Salvar investimento' }));
    await screen.findByText('Investimento salvo');
    expect(JSON.parse(String(chamadas.find((c) => c.init?.method === 'PUT')!.init!.body)).valores['TikTok Ads']).toBe(700);
  });
});
