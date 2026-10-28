// T-204 (fase4-analises): o filtro de período, os períodos prontos, a formatação e o
// gráfico de linhas em SVG próprio.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { diaEMes, iniciais, moeda, periodoDoPreset, porcentagem } from '../../../src/components/analises/comum';
import { FiltroPeriodo } from '../../../src/components/analises/filtro-periodo';
import { GraficoLinhas } from '../../../src/components/analises/grafico-linhas';

afterEach(cleanup);

describe('T-204: peças compartilhadas de análises', () => {
  test('os períodos prontos viram de/ate de calendário em São Paulo @spec:AC-556 @spec:AC-564', () => {
    const agora = new Date('2026-11-18T12:00:00Z'); // 18/11/2026, quarta
    expect(periodoDoPreset('hoje', agora)).toEqual({ de: '2026-11-18', ate: '2026-11-18' });
    expect(periodoDoPreset('7dias', agora)).toEqual({ de: '2026-11-12', ate: '2026-11-18' });
    expect(periodoDoPreset('30dias', agora)).toEqual({ de: '2026-10-20', ate: '2026-11-18' });
    expect(periodoDoPreset('mes', agora)).toEqual({ de: '2026-11-01', ate: '2026-11-30' });
    expect(periodoDoPreset('trimestre', agora)).toEqual({ de: '2026-10-01', ate: '2026-12-31' });
    // 01h de 1º de dezembro em UTC ainda é 30/11 em São Paulo
    expect(periodoDoPreset('hoje', new Date('2026-12-01T01:00:00Z'))).toEqual({ de: '2026-11-30', ate: '2026-11-30' });
  });

  test('o filtro mostra os botões, marca o escolhido e avisa a troca @spec:AC-556 @spec:AC-564 @spec:AC-568', async () => {
    const aoMudar = vi.fn();
    const u = userEvent.setup();
    render(<FiltroPeriodo valor="mes" presets={['hoje', '30dias', 'mes']} onMudar={aoMudar} />);
    expect(screen.getByRole('button', { name: 'Este mês' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hoje' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Trimestre atual' })).toBeFalsy();
    await u.click(screen.getByRole('button', { name: 'Últimos 30 dias' }));
    expect(aoMudar).toHaveBeenCalledWith('30dias');
  });

  test('a formatação usa vírgula, real e traço sem dado @spec:AC-558', () => {
    expect(porcentagem(0.684)).toBe('68,4%');
    expect(porcentagem(0)).toBe('0,0%');
    expect(porcentagem(null)).toBe('—');
    expect(moeda(428000)).toMatch(/R\$\s?428\.000/);
    expect(moeda(null)).toBe('—');
    expect(diaEMes('2026-10-26')).toBe('26/10');
    expect(iniciais('Dra. Juliana Rocha')).toBe('DJ');
    expect(iniciais('Sem responsável')).toBe('SR');
  });

  test('o gráfico desenha uma linha por série, o eixo e uma tabela para leitor de tela @spec:AC-565 @spec:AC-571', () => {
    const { container } = render(
      <GraficoLinhas
        titulo="Leads e reuniões por dia"
        rotulos={['01/10', '02/10', '03/10']}
        series={[
          { nome: 'Leads', corTraco: 'stroke-primary', corLegenda: 'bg-primary', valores: [10, 40, 25] },
          { nome: 'Reuniões', corTraco: 'stroke-success-text', corLegenda: 'bg-success-text', valores: [2, 5, 3] },
        ]}
      />
    );
    const grafico = screen.getByRole('img', { name: 'Leads e reuniões por dia' });
    expect(grafico.querySelectorAll('polyline')).toHaveLength(2);
    expect(grafico.querySelectorAll('circle')).toHaveLength(6);
    expect(within(grafico as unknown as HTMLElement).getByText('40')).toBeTruthy(); // teto do eixo
    expect(screen.getAllByText('Leads').length).toBeGreaterThanOrEqual(2); // legenda e tabela
    const tabela = container.querySelector('table.sr-only')!;
    expect(within(tabela as HTMLElement).getAllByRole('row')).toHaveLength(4);
    expect(within(tabela as HTMLElement).getByText('02/10').closest('tr')!.textContent).toContain('40');
  });

  test('sem nenhum valor o gráfico avisa "Sem dados no período" @spec:AC-565 @spec:AC-571', () => {
    render(<GraficoLinhas titulo="Vazio" rotulos={['01/10']} series={[{ nome: 'Leads', corTraco: 'stroke-primary', corLegenda: 'bg-primary', valores: [0] }]} />);
    expect(screen.getByText('Sem dados no período')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeFalsy();
    cleanup();
    render(<GraficoLinhas titulo="Sem rótulos" rotulos={[]} series={[]} />);
    expect(screen.getByText('Sem dados no período')).toBeTruthy();
  });
});
