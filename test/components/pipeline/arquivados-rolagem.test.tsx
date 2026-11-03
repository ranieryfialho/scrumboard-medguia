// @vitest-environment jsdom
//
// T-286 (fase4-pipeline-telas, US-108, AC-735): a tabela dos arquivados rola por dentro. O jsdom não calcula layout, então o
// teste confere a ESTRUTURA que faz isso funcionar: a área das linhas tem rolagem própria, pode encolher até a altura do
// quadro e o cabeçalho da tabela fica colado no topo dela.
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

describe('T-286: tabela dos arquivados com rolagem própria', () => {
  afterEach(cleanup);

  test('com 50 linhas, só a área da tabela rola e o cabeçalho fica fixo no topo dela (@spec:AC-735)', () => {
    const itens = Array.from({ length: 50 }, (_, i) => item(i + 1));
    const { container } = render(<TabelaArquivados itens={itens} podeReabrir={false} onReaberto={() => {}} />);

    const area = container.firstElementChild as HTMLElement;
    expect(area.className).toContain('overflow-auto');
    expect(area.className).toContain('min-h-0');
    expect(area.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(screen.getByText('Lead número 50')).toBeTruthy();

    const cabecalho = container.querySelector('thead') as HTMLElement;
    expect(area.contains(cabecalho)).toBe(true);
    expect(cabecalho.className).toContain('sticky');
    expect(cabecalho.className).toContain('top-0');
  });
});
