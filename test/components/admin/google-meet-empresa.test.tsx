// T-301 (fase4-tarefas-agenda, AC-765/AC-766): a tela "Google Meet" da empresa (src/components/admin/google-meet-empresa.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GoogleMeetEmpresa } from '../../../src/components/admin/google-meet-empresa';

let parametros = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => parametros }));

describe('T-301: tela do Google Meet da empresa', () => {
  let estado: { configuradoNoServidor: boolean; conectado: boolean; conta: string | null };
  let chamadas: Array<{ url: string; metodo: string }>;

  beforeEach(() => {
    parametros = new URLSearchParams();
    estado = { configuradoNoServidor: true, conectado: false, conta: null };
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, metodo: init?.method ?? 'GET' });
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ conectado: false, conta: null }));
        return new Response(JSON.stringify(estado));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('sem conta, oferece "Conectar com o Google" apontando para a rota de conexão @spec:AC-765', async () => {
    render(<GoogleMeetEmpresa />);
    expect(await screen.findByText('Não conectado')).toBeTruthy();
    const conectar = screen.getByRole('link', { name: /Conectar com o Google/ });
    expect(conectar.getAttribute('href')).toBe('/api/integracoes/google/conectar');
    expect(screen.queryByRole('button', { name: 'Desconectar' })).toBeNull();
    expect(screen.getByText(/Ao conectar, entre com a conta da empresa/)).toBeTruthy();
  });

  test('conectado, mostra a conta e oferece trocar ou desconectar, que pede confirmação @spec:AC-766', async () => {
    estado = { configuradoNoServidor: true, conectado: true, conta: 'contato@medguia.com.br' };
    const confirmar = vi.spyOn(window, 'confirm');
    const u = userEvent.setup();
    render(<GoogleMeetEmpresa />);
    expect(await screen.findByText('Conta: contato@medguia.com.br')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Trocar a conta conectada/ })).toBeTruthy();

    confirmar.mockReturnValueOnce(false);
    await u.click(screen.getByRole('button', { name: 'Desconectar' }));
    expect(chamadas.some((c) => c.metodo === 'DELETE')).toBe(false);

    confirmar.mockReturnValueOnce(true);
    await u.click(screen.getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(screen.getByText('Não conectado')).toBeTruthy());
    expect(chamadas.filter((c) => c.metodo === 'DELETE')).toEqual([{ url: '/api/integracoes/google', metodo: 'DELETE' }]);
  });

  test('sem as credenciais do Google no servidor explica o que falta e não oferece conectar @spec:AC-765', async () => {
    estado = { configuradoNoServidor: false, conectado: false, conta: null };
    render(<GoogleMeetEmpresa />);
    expect(await screen.findByText('O servidor ainda não tem as credenciais do Google.')).toBeTruthy();
    expect(screen.getByText(/GOOGLE_OAUTH_CLIENT_ID/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Conectar com o Google/ })).toBeNull();
  });

  test('o retorno do Google na URL vira aviso: sucesso e cada motivo de erro @spec:AC-765', async () => {
    parametros = new URLSearchParams('conectado=1');
    render(<GoogleMeetEmpresa />);
    expect((await screen.findByRole('status')).textContent).toContain('Google conectado');
    cleanup();

    for (const [erro, trecho] of [
      ['negado', 'cancelada'],
      ['estado', 'expirou'],
      ['falha', 'recusou'],
      ['segredo', 'SEGREDO_CONFIGURACOES'],
      ['nao_configurado', 'credenciais'],
    ] as const) {
      parametros = new URLSearchParams(`erro=${erro}`);
      render(<GoogleMeetEmpresa />);
      expect((await screen.findByRole('alert')).textContent, erro).toContain(trecho);
      cleanup();
    }
  });

  test('se o estado não carrega, mostra o erro com "Tentar de novo" @spec:AC-766', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    render(<GoogleMeetEmpresa />);
    expect(await screen.findByText('Não foi possível carregar o estado do Google.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
