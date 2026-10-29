// T-234 (fase5-acoes-rapidas, US-152): "Promover a Lead" nas conversas avulsas.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PromoverLead } from '../../../src/components/whatsapp/promover-lead';
import { ContextoCard } from '../../../src/components/whatsapp/contexto-card';

describe('T-234: promover a lead', () => {
  let chamadas: Array<{ url: string; init?: RequestInit }>;
  let resposta: { status: number; corpo: unknown };
  const assign = vi.fn();
  const locationOriginal = window.location;

  beforeEach(() => {
    chamadas = [];
    resposta = { status: 201, corpo: { leadId: 'l1', oportunidadeId: 'card-9', mensagensVinculadas: 3 } };
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        return new Response(JSON.stringify(resposta.corpo), { status: resposta.status });
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: locationOriginal });
  });

  test('digitar o nome e promover envia número e nome e leva ao card @spec:AC-650', async () => {
    const u = userEvent.setup();
    render(<PromoverLead numero="5511988880001" />);
    await u.type(screen.getByLabelText('Nome do lead para 5511988880001'), 'Dra. Ana');
    await u.click(screen.getByRole('button', { name: 'Promover a Lead' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/pipeline/card-9'));
    expect(chamadas[0].url).toBe('/api/whatsapp/promover');
    expect(JSON.parse(String(chamadas[0].init!.body))).toEqual({ numero: '5511988880001', nome: 'Dra. Ana' });
  });

  test('a recusa aparece em português e não navega @spec:AC-650', async () => {
    const u = userEvent.setup();
    resposta = { status: 409, corpo: { codigo: 'NUMERO_JA_E_LEAD' } };
    render(<PromoverLead numero="5511988880001" />);
    await u.type(screen.getByLabelText(/Nome do lead/), 'Ana');
    await u.click(screen.getByRole('button', { name: 'Promover a Lead' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Este número já é de um lead.');
    expect(assign).not.toHaveBeenCalled();
  });

  test('só a conversa avulsa (sem lead e sem card) oferece promover @spec:AC-650', () => {
    const base = { chave: 'x', numero: '5511988880001', nome: null, ultimaMensagem: '', ultimaEm: '2026-10-29T12:00:00Z', ultimaDirecao: 'recebida', naoLidas: 0, respondida: false };
    const { rerender } = render(<ContextoCard conversa={{ ...base, leadId: null, card: null } as never} />);
    expect(screen.getByRole('button', { name: 'Promover a Lead' })).toBeTruthy();
    rerender(<ContextoCard conversa={{ ...base, leadId: 'lead-1', card: null } as never} />);
    expect(screen.queryByRole('button', { name: 'Promover a Lead' })).toBeNull();
  });
});
