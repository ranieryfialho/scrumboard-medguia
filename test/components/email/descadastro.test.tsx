// T-274 (fase5-email-descadastro, AC-715): a página pública de confirmação do descadastro.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Descadastro } from '../../../src/components/email/descadastro';

describe('T-274: página pública de descadastro', () => {
  let chamadas: Array<{ url: string; method: string }>;
  let tokenValido: boolean;

  beforeEach(() => {
    chamadas = [];
    tokenValido = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, method: init?.method ?? 'GET' });
        if (!tokenValido) return new Response(JSON.stringify({ codigo: 'LINK_INVALIDO' }), { status: init?.method === 'POST' ? 400 : 404 });
        if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true, empresaNome: 'Clínica Demo' }));
        return new Response(JSON.stringify({ empresaNome: 'Clínica Demo', emailMascarado: 'm***@clinica.com' }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('abrir não descadastra: pergunta, com a empresa e o e-mail mascarado; confirmar descadastra e agradece @spec:AC-715', async () => {
    const u = userEvent.setup();
    render(<Descadastro token="abc.def" />);
    expect(await screen.findByRole('heading', { name: 'Deseja deixar de receber e-mails de Clínica Demo?' })).toBeTruthy();
    expect(screen.getByText(/m\*\*\*@clinica\.com/)).toBeTruthy();
    expect(chamadas).toEqual([{ url: '/api/descadastro/abc.def', method: 'GET' }]); // nada de POST ao abrir

    await u.click(screen.getByRole('button', { name: 'Confirmar descadastro' }));
    expect(await screen.findByText('Você não receberá mais e-mails de Clínica Demo.')).toBeTruthy();
    expect(chamadas.at(-1)).toEqual({ url: '/api/descadastro/abc.def', method: 'POST' });
    expect(screen.queryByRole('button', { name: 'Confirmar descadastro' })).toBeNull();
  });

  test('link inválido mostra "Link inválido" sem nada da empresa nem do e-mail @spec:AC-715', async () => {
    tokenValido = false;
    render(<Descadastro token="lixo" />);
    expect(await screen.findByRole('heading', { name: 'Link inválido' })).toBeTruthy();
    expect(screen.queryByText(/Clínica Demo|clinica\.com/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar descadastro' })).toBeNull();
  });

  test('falha de rede mostra um aviso e não diz que descadastrou @spec:AC-715', async () => {
    const u = userEvent.setup();
    render(<Descadastro token="abc.def" />);
    await u.click(await screen.findByRole('button', { name: 'Confirmar descadastro' }));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    // a primeira confirmação já deu certo no stub anterior; refaz o cenário de falha numa página nova
    cleanup();
    render(<Descadastro token="abc.def" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Não foi possível concluir'));
    expect(screen.queryByText(/Você não receberá mais/)).toBeNull();
  });
});
