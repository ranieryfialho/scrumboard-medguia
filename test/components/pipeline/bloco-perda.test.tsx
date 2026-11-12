// fase6-perdas-por-lead (US-193): o bloco "Perda" do detalhe do card (src/components/pipeline/detalhe/bloco-perda.tsx).
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { BlocoPerda } from '../../../src/components/pipeline/detalhe/bloco-perda';

afterEach(cleanup);

describe('fase6-perdas-por-lead: bloco "Perda" no card', () => {
  test('mostra motivo, etapa em que estava, responsável e a data e hora da perda em São Paulo @spec:AC-813', () => {
    render(<BlocoPerda perda={{ motivo: 'Preço', etapaOrigem: 'Proposta', ocorridoEm: '2026-02-15T13:00:00.000Z', automatica: false }} responsavelNome="Ana" />);
    const bloco = screen.getByRole('region', { name: 'Perda' });
    expect(within(bloco).getByText('Preço')).toBeTruthy();
    expect(within(bloco).getByText('Proposta')).toBeTruthy();
    expect(within(bloco).getByText('Ana')).toBeTruthy();
    expect(bloco.textContent).toMatch(/15\/02\/2026,? 10:00/); // 13:00 UTC = 10:00 em São Paulo
    expect(within(bloco).queryByText('Perda automática')).toBeNull();
  });

  test('sem motivo, sem responsável e sem data usa os textos de "não informado"; fora de Perdido não há bloco @spec:AC-814', () => {
    const { rerender, container } = render(<BlocoPerda perda={{ motivo: null, etapaOrigem: null, ocorridoEm: null, automatica: false }} responsavelNome={null} />);
    const bloco = screen.getByRole('region', { name: 'Perda' });
    expect(within(bloco).getByText('Sem motivo informado')).toBeTruthy();
    expect(within(bloco).getByText('Sem responsável')).toBeTruthy();
    expect(within(bloco).getByText('Não registrada')).toBeTruthy(); // etapa
    expect(within(bloco).getByText('Não registrado')).toBeTruthy(); // data

    rerender(<BlocoPerda perda={null} responsavelNome="Ana" />);
    expect(container.querySelector('section')).toBeNull();
    rerender(<BlocoPerda perda={undefined} responsavelNome="Ana" />);
    expect(container.querySelector('section')).toBeNull();
  });

  test('a perda da cadência esgotada leva a marca "Perda automática" @spec:AC-815', () => {
    render(<BlocoPerda perda={{ motivo: 'Cadência esgotada', etapaOrigem: '3º dia de contato', ocorridoEm: '2026-02-10T11:00:00.000Z', automatica: true }} responsavelNome="Ana" />);
    const bloco = screen.getByRole('region', { name: 'Perda' });
    expect(within(bloco).getByText('Cadência esgotada')).toBeTruthy();
    expect(within(bloco).getByText('Perda automática')).toBeTruthy();
  });
});
