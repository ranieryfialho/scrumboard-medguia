// @vitest-environment jsdom
//
// T-284 (fase4-pipeline-telas, US-106, AC-733): a coluna do funil rola por dentro. O jsdom não calcula layout, então o teste
// confere a ESTRUTURA que faz isso funcionar: a lista de cards tem rolagem própria, o título e o contador ficam fora dela, e
// a coluna pode encolher até a altura do quadro.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

import { ColunaEtapa } from '../../../src/components/pipeline/coluna-etapa';
import type { CardBoard } from '../../../src/components/pipeline/card-oportunidade';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const card = (n: number): CardBoard => ({
  id: `op-${n}`,
  etapaId: 1,
  leadId: `lead-${n}`,
  leadNome: `Lead número ${n}`,
  responsavelId: null,
  responsavelNome: null,
  valor: null,
  version: 1,
});

describe('T-284: coluna do funil com rolagem própria', () => {
  afterEach(cleanup);

  test('com 200 cards, a lista rola por dentro e o título e o contador ficam fora da rolagem (@spec:AC-733)', () => {
    const cards = Array.from({ length: 200 }, (_, i) => card(i + 1));
    const { container } = render(
      <DndContext>
        <ColunaEtapa etapaId={1} nome="Entrada de leads" cards={cards} podeReceberDrop arrastando={false} oportunidadesAtrasadas={new Set()} />
      </DndContext>
    );

    const coluna = container.querySelector('[data-etapa-id="1"]') as HTMLElement;
    expect(coluna.className).toContain('flex-col');
    expect(coluna.className).toContain('min-h-0'); // pode encolher até a altura do quadro

    const rolagem = coluna.querySelector('.overflow-y-auto') as HTMLElement | null;
    expect(rolagem, 'a lista de cards precisa ter rolagem própria').not.toBeNull();
    expect(rolagem?.textContent).toContain('Lead número 1');
    expect(rolagem?.textContent).toContain('Lead número 200'); // os 200 estão dentro da área que rola

    // o título e o contador não rolam junto
    const titulo = screen.getByRole('heading', { name: 'Entrada de leads' });
    expect(rolagem?.contains(titulo)).toBe(false);
    expect(screen.getByText('200 cards • R$ 0,00')).toBeTruthy();
  });

  test('uma coluna vazia continua mostrando "Vazio" dentro da área de cards (@spec:AC-733)', () => {
    const { container } = render(
      <DndContext>
        <ColunaEtapa etapaId={2} nome="1º dia de contato" cards={[]} podeReceberDrop arrastando={false} oportunidadesAtrasadas={new Set()} />
      </DndContext>
    );
    const rolagem = container.querySelector('[data-etapa-id="2"] .overflow-y-auto') as HTMLElement;
    expect(rolagem.textContent).toContain('Vazio');
  });
});
