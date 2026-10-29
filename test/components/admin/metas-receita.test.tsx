// T-258 (fase5-meta-receita, AC-687/AC-689): o campo de receita em reais na tela de metas.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Metas } from '../../../src/components/admin/metas';

describe('T-258: tela de metas com a receita', () => {
  let detalhes: Array<{ chave: string; valor: number; atualizadoEm: string; atualizadoPorNome: string | null }>;
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    detalhes = [{ chave: 'receita_mensal', valor: 50000, atualizadoEm: '2026-10-29T15:00:00Z', atualizadoPorNome: 'Karol' }];
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'PUT') return new Response(JSON.stringify({ metas: {}, detalhes }));
        return new Response(JSON.stringify({ metas: {}, detalhes }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('a receita fica no bloco Comercial, em R$, com o valor formatado; as taxas seguem em % @spec:AC-687 @spec:AC-689', async () => {
    render(<Metas />);
    const comercial = await screen.findByRole('region', { name: 'Comercial' });
    const campo = within(comercial).getByLabelText('Receita mensal (Novo MRR)') as HTMLInputElement;
    expect(campo.value).toBe('50.000,00');
    expect(within(comercial).getByText('R$')).toBeTruthy();
    expect(within(comercial).getByText(/R\$\s50\.000 · Karol · 29\/10\/2026/)).toBeTruthy();
    const pipeline = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(pipeline).getByText('%')).toBeTruthy();
    expect(within(pipeline).queryByText('R$')).toBeNull();
  });

  test('aceita 50000, 50.000 e 50.000,50; vazio remove; fora do limite avisa e não grava @spec:AC-687', async () => {
    const u = userEvent.setup();
    render(<Metas />);
    const campo = (await screen.findByLabelText('Receita mensal (Novo MRR)')) as HTMLInputElement;
    const salvar = async (texto: string) => {
      await u.clear(campo);
      if (texto) await u.type(campo, texto);
      await u.click(screen.getByRole('button', { name: 'Salvar metas' }));
    };
    const enviado = () => JSON.parse(String(chamadas.filter((c) => c.init?.method === 'PUT').at(-1)!.init!.body)).metas.receita_mensal;

    await salvar('50000');
    expect(enviado()).toBe(50000);
    await salvar('50.000');
    expect(enviado()).toBe(50000);
    await salvar('50.000,50');
    expect(enviado()).toBe(50000.5);
    await salvar('');
    expect(enviado()).toBeNull();

    const puts = () => chamadas.filter((c) => c.init?.method === 'PUT').length;
    const antes = puts();
    for (const ruim of ['0', '100.000.000', '10,005', 'abc']) {
      await salvar(ruim);
      expect((await screen.findByRole('alert')).textContent).toContain('R$ 0,01 a R$ 99.999.999,99');
    }
    expect(puts()).toBe(antes);
  });
});
