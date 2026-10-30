// T-274 (fase5-email-descadastro, AC-718/AC-719): a prévia e a mensagem de "campanha criada" dizem quantos descadastrados
// ficaram de fora, e a tela de e-mail da empresa mostra a contagem.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EmailEmpresa } from '../../../src/components/admin/email-empresa';
import { NovaCampanha } from '../../../src/components/campanhas/nova-campanha';

const roteador = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => roteador, useSearchParams: () => new URLSearchParams() }));

describe('T-274: descadastrados na tela', () => {
  let descadastradosDaPrevia: number;
  let descadastradosDaCriacao: number;
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    descadastradosDaPrevia = 2;
    descadastradosDaCriacao = 2;
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (url.startsWith('/api/campanhas/previa-destinatarios')) {
          const ids = new URL(url, 'http://x').searchParams.get('etapaIds')!.split(',').map(Number);
          return new Response(JSON.stringify({ porEtapa: ids.map((etapaId) => ({ etapaId, total: 10 })), total: ids.length * 10, valorEmPipeline: 1000, descadastrados: descadastradosDaPrevia }));
        }
        if (url === '/api/campanhas' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'nova-1', totalDestinatarios: 8, descartadosInvalidos: 0, descartadosRepetidos: 0, descartadosDescadastrados: descadastradosDaCriacao }), { status: 201 });
        }
        if (url === '/api/configuracoes/email') return new Response(JSON.stringify({ chaveConfigurada: false, chaveFinal: null, remetente: null, descadastrados: 3 }));
        return new Response('{}', { status: 404 });
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('a prévia das etapas diz quantos descadastrados ficam de fora; sem nenhum, não diz nada @spec:AC-718', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await u.click(await screen.findByLabelText('Follow de longo prazo'));
    expect(await screen.findByText('2 descadastrados ficam de fora.')).toBeTruthy();
    cleanup();

    descadastradosDaPrevia = 1;
    render(<NovaCampanha />);
    await u.click(await screen.findByLabelText('Follow de longo prazo'));
    expect(await screen.findByText('1 descadastrado fica de fora.')).toBeTruthy();
    cleanup();

    descadastradosDaPrevia = 0;
    render(<NovaCampanha />);
    await u.click(await screen.findByLabelText('Follow de longo prazo'));
    await waitFor(() => expect(screen.getByLabelText('Destinatários qualificados').textContent).toBe('10'));
    expect(screen.queryByText(/descadastrad/)).toBeNull();
  });

  test('a mensagem de campanha criada diz quantos descadastrados ficaram de fora @spec:AC-718', async () => {
    const u = userEvent.setup();
    render(<NovaCampanha />);
    await u.type(await screen.findByLabelText('Nome interno da campanha'), 'Reativação');
    await u.type(screen.getByLabelText('Linha de assunto'), 'Novidades');
    await u.click(screen.getByLabelText('Corpo do e-mail'));
    await u.paste('<p>Oi {{nome}}</p>');
    await u.click(screen.getByLabelText('Follow de longo prazo'));
    await waitFor(() => expect(screen.getByLabelText('Destinatários qualificados').textContent).toBe('10'));
    await u.click(screen.getByRole('button', { name: 'Salvar Rascunho' }));
    expect(await screen.findByText(/Campanha criada com 8 destinatários\./)).toBeTruthy();
    expect(screen.getByText(/2 descadastrados ficaram de fora\./)).toBeTruthy();
  });

  test('a tela de e-mail da empresa mostra só a contagem de descadastrados, sem ação de recadastrar @spec:AC-719', async () => {
    render(<EmailEmpresa />);
    expect(await screen.findByText('3 e-mails descadastrados')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /recadastrar|reativar|remover descadastro/i })).toBeNull();
  });
});
