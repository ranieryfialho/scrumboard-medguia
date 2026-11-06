// @vitest-environment jsdom
//
// T-286 (fase4-pipeline-telas, US-108, AC-735), revisto: a tabela dos arquivados NÃO tem mais altura fixa — a página cresce com as
// linhas (o tamanho vem do seletor "Itens por página"). A área da tabela só rola na horizontal, para telas estreitas.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { TabelaArquivados, type ItemTabelaArquivados } from '../../../src/components/pipeline/tabela-arquivados';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const item = (n: number): ItemTabelaArquivados => ({
  id: `op-${n}`,
  status: n % 2 === 0 ? 'ganho' : 'perdido',
  valor: null,
  dataFechamento: '2026-11-03T12:00:00.000Z',
  lead: { id: `lead-${n}`, nome: `Lead número ${n}`, email: null, telefoneE164: null },
  responsavel: null,
  motivoPerda: null,
});

describe('T-286: tabela dos arquivados sem altura fixa', () => {
  afterEach(cleanup);

  test('com 50 linhas, a tabela cresce com o conteúdo e só rola na horizontal (@spec:AC-735)', () => {
    const itens = Array.from({ length: 50 }, (_, i) => item(i + 1));
    const { container } = render(<TabelaArquivados itens={itens} podeReabrir={false} onReaberto={() => {}} />);

    const area = container.firstElementChild as HTMLElement;
    expect(area.className).toContain('overflow-x-auto');
    expect(area.className).not.toContain('min-h-0');
    expect(area.className).not.toContain('flex-1');
    expect(area.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(screen.getByText('Lead número 50')).toBeTruthy();

    const cabecalho = container.querySelector('thead') as HTMLElement;
    expect(area.contains(cabecalho)).toBe(true);
  });
});
