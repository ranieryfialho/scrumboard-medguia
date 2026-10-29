// T-249 (fase5-whatsapp-lote-base, AC-669): o bloco "Autoriza receber WhatsApp" no card.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConsentimentoWhatsapp } from '../../../src/components/pipeline/detalhe/consentimento-whatsapp';

describe('T-249: consentimento no card', () => {
  let estado: { consentimento: boolean; em: string | null; porNome: string | null };
  let falhar: boolean;
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    estado = { consentimento: false, em: null, porNome: null };
    falhar = false;
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (falhar && init?.method === 'PUT') return new Response('{}', { status: 500 });
        if (init?.method === 'PUT') {
          const { consentimento } = JSON.parse(String(init.body)) as { consentimento: boolean };
          estado = consentimento ? { consentimento: true, em: '2026-10-29T15:00:00Z', porNome: 'Karol Mendes' } : { consentimento: false, em: null, porNome: null };
        }
        return new Response(JSON.stringify(estado));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('sem consentimento oferece registrar; com consentimento mostra quem e quando e oferece revogar @spec:AC-669', async () => {
    const u = userEvent.setup();
    render(<ConsentimentoWhatsapp leadId="lead-1" />);
    expect(await screen.findByText('Sem consentimento')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Autoriza receber WhatsApp' })).toBeTruthy();
    expect(chamadas[0].url).toBe('/api/leads/lead-1/consentimento');

    await u.click(screen.getByRole('button', { name: 'Registrar consentimento' }));
    expect(await screen.findByText('Consentido por Karol Mendes em 29/10/2026')).toBeTruthy();
    expect(JSON.parse(String(chamadas.at(-1)!.init!.body))).toEqual({ consentimento: true });

    await u.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(await screen.findByText('Sem consentimento')).toBeTruthy();
    expect(JSON.parse(String(chamadas.at(-1)!.init!.body))).toEqual({ consentimento: false });
  });

  test('a falha da API aparece como aviso e a tela continua @spec:AC-669', async () => {
    const u = userEvent.setup();
    falhar = true;
    render(<ConsentimentoWhatsapp leadId="lead-1" />);
    await u.click(await screen.findByRole('button', { name: 'Registrar consentimento' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível salvar o consentimento. Tente de novo.');
    expect(screen.getByText('Sem consentimento')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Registrar consentimento' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
