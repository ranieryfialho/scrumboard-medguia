// T-187 (fase4-tarefas-agenda, US-122): os modais Agendar, Reagendar e Marcar
// como Concluída (src/components/agenda/modais.tsx) — campos obrigatórios,
// mensagens por código, o que foi digitado continua na tela e a evidência pelo
// mesmo modal do funil.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModalAgendar, ModalConcluir, ModalReagendar } from '../../../src/components/agenda/modais';
import type { ReuniaoView } from '../../../src/components/agenda/tipos';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const REUNIAO = {
  id: 'r1',
  oportunidadeId: 'op-1',
  agendadaPara: '2026-06-11T12:00:00Z',
  status: 'aguardando_resultado',
  lead: { id: 'l1', nome: 'Clínica Alfa', telefoneE164: null },
} as unknown as ReuniaoView;

describe('T-187: modais da agenda', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let respostaDaAcao: () => Promise<unknown>;

  const chamadasPost = () => fetchFalso.mock.calls.filter((c) => c[1]?.method === 'POST');

  beforeEach(() => {
    respostaDaAcao = () => resposta(200, {});
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url === '/api/reunioes/elegiveis') return resposta(200, { cards: [{ id: 'op-9', leadNome: 'Clínica Beta' }, { id: 'op-8', leadNome: 'Clínica Gama' }] });
      if (url === '/api/anexos' && init?.method === 'POST') return resposta(201, { anexoId: 'an-9' });
      if (init?.method === 'POST') return respostaDaAcao();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('agendar lista só os cards elegíveis, exige card, data e hora e envia o instante de Brasília @spec:AC-489 @spec:AC-496', async () => {
    const onConcluido = vi.fn();
    const u = userEvent.setup();
    const { container } = render(<ModalAgendar onFechar={() => undefined} onConcluido={onConcluido} />);
    await screen.findByRole('option', { name: 'Clínica Beta' });
    const confirmar = screen.getByRole('button', { name: 'Agendar' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    await u.selectOptions(screen.getByRole('combobox'), 'op-9');
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-06-15' } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '14:00' } });
    expect(confirmar.disabled).toBe(false);

    await u.click(confirmar);
    await waitFor(() => expect(onConcluido).toHaveBeenCalled());
    const [url, init] = chamadasPost().find((c) => c[0] === '/api/reunioes')!;
    expect(url).toBe('/api/reunioes');
    expect(JSON.parse(init.body)).toEqual({ oportunidadeId: 'op-9', agendadaPara: '2026-06-15T17:00:00.000Z' });
    expect(container).toBeTruthy();
  });

  test('quando a API recusa a data ou a rede cai, a mensagem aparece, o modal não fecha e o digitado fica @spec:AC-490 @spec:AC-496', async () => {
    const onConcluido = vi.fn();
    const u = userEvent.setup();
    render(<ModalAgendar onFechar={() => undefined} onConcluido={onConcluido} />);
    await screen.findByRole('option', { name: 'Clínica Beta' });
    await u.selectOptions(screen.getByRole('combobox'), 'op-8');
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2020-01-01' } });
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '09:30' } });

    respostaDaAcao = () => resposta(400, { codigo: 'DATA_NO_PASSADO' });
    await u.click(screen.getByRole('button', { name: 'Agendar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Escolha uma data e uma hora no futuro.');
    expect(onConcluido).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('op-8');
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe('2020-01-01');

    respostaDaAcao = () => Promise.reject(new Error('offline'));
    await u.click(screen.getByRole('button', { name: 'Agendar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível falar com o servidor/));
    expect(onConcluido).not.toHaveBeenCalled();
  });

  test('reagendar pede data e hora futuras e envia a nova data @spec:AC-493 @spec:AC-496', async () => {
    const onConcluido = vi.fn();
    const u = userEvent.setup();
    render(<ModalReagendar reuniao={{ id: 'r1', leadNome: 'Clínica Alfa' }} onFechar={() => undefined} onConcluido={onConcluido} />);
    const confirmar = screen.getByRole('button', { name: 'Reagendar' }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-06-16' } });
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: '10:00' } });
    await u.click(confirmar);
    await waitFor(() => expect(onConcluido).toHaveBeenCalled());
    const [url, init] = chamadasPost()[0];
    expect(url).toBe('/api/reunioes/r1/reagendar');
    expect(JSON.parse(init.body)).toEqual({ agendadaPara: '2026-06-16T13:00:00.000Z' });
  });

  test('concluir sem evidência abre o modal de evidência do funil e tenta de novo com o anexo @spec:AC-492 @spec:AC-496', async () => {
    const onConcluido = vi.fn();
    const u = userEvent.setup();
    render(<ModalConcluir reuniao={REUNIAO} onFechar={() => undefined} onConcluido={onConcluido} />);
    await u.type(screen.getByRole('textbox'), 'Foi ótima');

    respostaDaAcao = () => resposta(422, { codigo: 'EVIDENCIA_OBRIGATORIA' });
    await u.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText('Print ou PDF da evidência')).toBeTruthy();
    expect(onConcluido).not.toHaveBeenCalled();

    const arquivo = new File([new Uint8Array([1, 2, 3])], 'ata.png', { type: 'image/png' });
    await u.upload(document.querySelector('input[type="file"]')!, arquivo);
    await screen.findByText('Anexado: ata.png');

    respostaDaAcao = () => resposta(200, {});
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(onConcluido).toHaveBeenCalled());
    const concluirChamadas = chamadasPost().filter((c) => c[0] === '/api/reunioes/r1/concluir').map((c) => JSON.parse(c[1].body));
    expect(concluirChamadas).toEqual([{ resumo: 'Foi ótima' }, { resumo: 'Foi ótima', anexoId: 'an-9' }]);
  });
});
