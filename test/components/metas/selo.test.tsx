// T-223 (fase5-metas, US-145/US-146): regra de "meta atingida", o selo no cartão e os atalhos
// "Configurar Metas" dos relatórios.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { descreverMeta } from '../../../src/lib/metas/catalogo';
import { CartaoIndicador } from '../../../src/components/pipeline/pecas/cartao-indicador';
import { IndicadoresFunil } from '../../../src/components/pipeline/indicadores-funil';

function fetchCom(metas: Record<string, number>, extra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/metas')) return new Response(JSON.stringify({ metas, detalhes: [] }));
      const corpo = Object.entries(extra).find(([k]) => url.startsWith(k))?.[1];
      return new Response(JSON.stringify(corpo ?? {}), { status: corpo ? 200 : 404 });
    })
  );
}

const FUNIL = (valor: number | null) => ({
  cardsAtivos: { quantidade: 3, valorTotal: '0' },
  toquesEmAtraso: 0,
  propostasAtivas: 0,
  conversao30Dias: { valor },
});

describe('T-223: selo de meta', () => {
  beforeEach(() => fetchCom({}));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('"atingida" é valor >= meta; sem meta ou sem valor não há selo @spec:AC-625', () => {
    expect(descreverMeta(30, 25)).toEqual({ texto: 'Meta 25%', atingida: true });
    expect(descreverMeta(25, 25)?.atingida).toBe(true);
    expect(descreverMeta(20, 25)).toEqual({ texto: 'Meta 25%', atingida: false });
    expect(descreverMeta(30, undefined)).toBeNull();
    expect(descreverMeta(null, 25)).toBeNull();
    render(<CartaoIndicador titulo="X" valor="—" icone="flag" meta={descreverMeta(null, 25)} />);
    expect(screen.queryByText(/Meta/)).toBeNull();
  });

  test('o cartão mostra "Meta N%" e, atingida, o selo "Meta atingida" @spec:AC-624', () => {
    render(
      <>
        <CartaoIndicador titulo="Taxa de entrega" valor="98,0%" icone="verified" meta={descreverMeta(98, 95)} />
        <CartaoIndicador titulo="Taxa de abertura única" valor="20,0%" icone="drafts" meta={descreverMeta(20, 40)} />
      </>
    );
    expect(screen.getByText('Meta 95%')).toBeTruthy();
    expect(screen.getByText('Meta 40%')).toBeTruthy();
    expect(screen.getAllByText('Meta atingida')).toHaveLength(1);
  });

  test('taxa de conversão do pipeline: 30% com meta 25% é atingida, 20% não @spec:AC-621', async () => {
    fetchCom({ taxa_conversao: 25 });
    const { unmount } = render(<IndicadoresFunil dados={FUNIL(0.3) as never} />);
    expect(await screen.findByText('Meta 25%')).toBeTruthy();
    expect(screen.getByText('Meta atingida')).toBeTruthy();
    unmount();
    render(<IndicadoresFunil dados={FUNIL(0.2) as never} />);
    expect(await screen.findByText('Meta 25%')).toBeTruthy();
    expect(screen.queryByText('Meta atingida')).toBeNull();
  });

  test('sem meta cadastrada o indicador do pipeline não mostra nada @spec:AC-625', async () => {
    render(<IndicadoresFunil dados={FUNIL(0.3) as never} />);
    expect(await screen.findByText('Taxa de Conversão')).toBeTruthy();
    expect(screen.queryByText(/Meta/)).toBeNull();
  });
});
