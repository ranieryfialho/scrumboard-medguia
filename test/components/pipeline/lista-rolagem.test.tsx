// @vitest-environment jsdom
//
// T-285 (fase4-pipeline-telas, US-107, AC-734): a tabela da lista rola por dentro. O jsdom não calcula layout, então o teste
// confere a ESTRUTURA que faz isso funcionar: o quadro pode encolher até a altura da tela, a área das linhas tem rolagem
// própria e o cabeçalho da tabela fica colado no topo dela.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { TabelaLista, type ItemTabelaLista } from '../../../src/components/pipeline/tabela-lista';

const item = (n: number): ItemTabelaLista => ({
  id: `op-${n}`,
  etapaId: 1,
  valor: null,
  proximaAcaoEm: null,
  lead: { id: `lead-${n}`, nome: `Lead número ${n}`, email: null, telefoneE164: null },
  responsavel: null,
});

describe('T-285: tabela da lista com rolagem própria', () => {
  afterEach(cleanup);

  test('com 50 linhas, só a área da tabela rola e o cabeçalho fica fixo no topo dela (@spec:AC-734)', () => {
    const itens = Array.from({ length: 50 }, (_, i) => item(i + 1));
    const { container } = render(
      <TabelaLista itens={itens} selecionados={new Set()} onAlternarSelecao={() => {}} onAlternarTodos={() => {}} />
    );

    const quadro = container.firstElementChild as HTMLElement;
    expect(quadro.className).toContain('min-h-0');
    expect(quadro.className).toContain('flex-col');

    const area = container.querySelector('.overflow-auto') as HTMLElement;
    expect(area).not.toBeNull();
    expect(area.className).toContain('min-h-0');
    expect(area.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(screen.getByText('Lead número 50')).toBeTruthy();

    const cabecalho = container.querySelector('thead') as HTMLElement;
    expect(area.contains(cabecalho)).toBe(true);
    expect(cabecalho.className).toContain('sticky');
    expect(cabecalho.className).toContain('top-0');
  });
});
