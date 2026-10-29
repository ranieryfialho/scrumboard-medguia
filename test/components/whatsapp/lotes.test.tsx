// T-254 (fase5-whatsapp-lote-disparo, AC-686): a tela de acompanhamento dos lotes.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Lotes } from '../../../src/components/whatsapp/lotes';

const LOTE = (id: string, status: string, o: Record<string, unknown> = {}) => ({
  id, templateNome: `Lote ${id}`, criadoPorNome: 'Karol Mendes', status, total: 4, criadoEm: '2026-10-29T15:00:00Z', enviados: 1, falhas: 1, pendentes: 1, cancelados: 1, ...o,
});

describe('T-254: tela de lotes', () => {
  let lotes: ReturnType<typeof LOTE>[];
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    lotes = [LOTE('a', 'em_andamento'), LOTE('b', 'concluido', { pendentes: 0, enviados: 3 })];
    chamadas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (url === '/api/whatsapp/lote' && !init?.method) return new Response(JSON.stringify({ lotes }));
        if (url === '/api/whatsapp/lote/a') {
          return new Response(JSON.stringify({ lote: lotes[0], itens: [
            { id: 'i1', nome: 'Dra. Ana', telefone: '5511988880001', status: 'enviado', erro: null },
            { id: 'i2', nome: 'Dr. Carlos', telefone: '5511977770002', status: 'falhou', erro: 'NUMERO_SEM_WHATSAPP' },
            { id: 'i3', nome: 'Clínica X', telefone: '5511966660003', status: 'pendente', erro: null },
            { id: 'i4', nome: 'Clínica Y', telefone: '5511955550004', status: 'cancelado', erro: 'SEM_CONSENTIMENTO' },
          ] }));
        }
        if (url === '/api/whatsapp/lote/a/cancelar') return new Response(JSON.stringify({}), { status: 200 });
        return new Response('{}', { status: 404 });
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('lista com situação, progresso e contagens; "Cancelar envio" só no em andamento @spec:AC-686', async () => {
    render(<Lotes />);
    const a = await screen.findByRole('article', { name: 'Lote Lote a' });
    expect(within(a).getByText('Em andamento')).toBeTruthy();
    expect(within(a).getByText('1 enviados · 1 falhas · 1 na fila · 1 cancelados')).toBeTruthy();
    expect(within(a).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75'); // 3 de 4 já resolvidos
    expect(within(a).getByText(/por Karol Mendes · 4 destinatários/)).toBeTruthy();
    expect(within(a).getByRole('button', { name: 'Cancelar envio: Lote a' })).toBeTruthy();
    const b = screen.getByRole('article', { name: 'Lote Lote b' });
    expect(within(b).getByText('Concluído')).toBeTruthy();
    expect(within(b).queryByRole('button', { name: /^Cancelar envio/ })).toBeNull();
  });

  test('ver destinatários mostra a situação de cada um com o motivo em português @spec:AC-686', async () => {
    const u = userEvent.setup();
    render(<Lotes />);
    await u.click(await screen.findByRole('button', { name: 'Ver destinatários: Lote a' }));
    const lista = await screen.findByRole('list', { name: 'Destinatários' });
    expect(within(lista).getByText(/Dra\. Ana/).closest('li')!.textContent).toContain('Enviado');
    expect(within(lista).getByText(/Dr\. Carlos/).closest('li')!.textContent).toContain('Falhou (número sem WhatsApp)');
    expect(within(lista).getByText(/Clínica X/).closest('li')!.textContent).toContain('Na fila');
    expect(within(lista).getByText(/Clínica Y/).closest('li')!.textContent).toContain('Cancelado (consentimento revogado)');
  });

  test('cancelar chama a API, avisa e recarrega @spec:AC-686', async () => {
    const u = userEvent.setup();
    render(<Lotes />);
    await u.click(await screen.findByRole('button', { name: 'Cancelar envio: Lote a' }));
    expect(await screen.findByText('Envio cancelado. O que já saiu não é desfeito.')).toBeTruthy();
    expect(chamadas.some((c) => c.url === '/api/whatsapp/lote/a/cancelar' && c.init?.method === 'POST')).toBe(true);
    expect(chamadas.filter((c) => c.url === '/api/whatsapp/lote' && !c.init?.method).length).toBeGreaterThanOrEqual(2);
  });

  test('atualiza sozinha enquanto houver lote em andamento @spec:AC-686', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Lotes />);
    await screen.findByRole('article', { name: 'Lote Lote a' });
    const leituras = () => chamadas.filter((c) => c.url === '/api/whatsapp/lote' && !c.init?.method).length;
    const antes = leituras();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(leituras()).toBeGreaterThan(antes);
  });
});
