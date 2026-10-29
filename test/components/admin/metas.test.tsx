// T-223 (fase5-metas, US-144): a tela de metas (src/components/admin/metas.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Metas } from '../../../src/components/admin/metas';

const DETALHE = { chave: 'taxa_conversao', valor: 25, atualizadoEm: '2026-10-29T15:00:00Z', atualizadoPorNome: 'Karol' };

describe('T-223: tela de metas', () => {
  let chamadas: Array<{ url: string; init?: RequestInit }>;
  beforeEach(() => {
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'PUT') {
          const { metas } = JSON.parse(String(init.body)) as { metas: Record<string, number | null> };
          return new Response(JSON.stringify({ metas: {}, detalhes: Object.entries(metas).filter(([, v]) => v !== null).map(([chave, valor]) => ({ chave, valor, atualizadoEm: '2026-10-29T16:00:00Z', atualizadoPorNome: 'Karol' })) }));
        }
        return new Response(JSON.stringify({ metas: { taxa_conversao: 25 }, detalhes: [DETALHE] }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('mostra as cinco metas por área, a cadastrada com o valor e as outras "Sem meta" @spec:AC-615', async () => {
    render(<Metas />);
    expect(await screen.findByText('Taxa de conversão')).toBeTruthy();
    for (const area of ['Pipeline', 'Agenda', 'E-mail']) expect(screen.getByRole('region', { name: area })).toBeTruthy();
    for (const rotulo of ['Taxa de presença', 'Taxa de entrega de e-mail', 'Taxa de abertura de e-mail', 'Taxa de cliques de e-mail']) expect(screen.getByLabelText(rotulo)).toBeTruthy();
    expect((screen.getByLabelText('Taxa de conversão') as HTMLInputElement).value).toBe('25');
    expect(screen.getAllByText('Sem meta')).toHaveLength(4);
  });

  test('salvar envia só os campos e confirma "Meta salva" @spec:AC-616', async () => {
    render(<Metas />);
    await userEvent.type(await screen.findByLabelText('Taxa de presença'), '80,5');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar metas' }));
    expect(await screen.findByText('Meta salva')).toBeTruthy();
    const put = chamadas.find((c) => c.init?.method === 'PUT')!;
    expect(JSON.parse(String(put.init!.body)).metas).toMatchObject({ taxa_conversao: 25, taxa_presenca: 80.5, taxa_cliques_email: null });
  });

  test('valor fora de 0,1 a 100 avisa e não chama a API @spec:AC-617', async () => {
    render(<Metas />);
    await userEvent.type(await screen.findByLabelText('Taxa de presença'), '101');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar metas' }));
    expect((await screen.findByRole('alert')).textContent).toContain('de 0,1 a 100');
    expect(chamadas.some((c) => c.init?.method === 'PUT')).toBe(false);
  });

  test('limpar o campo remove a meta e a tela volta a "Sem meta" @spec:AC-618', async () => {
    render(<Metas />);
    await userEvent.clear(await screen.findByLabelText('Taxa de conversão'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar metas' }));
    await waitFor(() => expect(screen.getAllByText('Sem meta')).toHaveLength(5));
    expect(JSON.parse(String(chamadas.find((c) => c.init?.method === 'PUT')!.init!.body)).metas.taxa_conversao).toBeNull();
  });
});
