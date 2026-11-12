// fase6-atendimento-lead (US-182): a tela do horário de atendimento (src/components/admin/horario-atendimento.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HorarioAtendimento } from '../../../src/components/admin/horario-atendimento';
import { HORARIO_PADRAO } from '../../../src/domain/atendimento/horario-comercial';

describe('fase6-atendimento-lead: tela do horário de atendimento', () => {
  let chamadas: Array<{ url: string; init?: RequestInit }>;
  let respostaDoSalvar: { status: number; corpo: unknown };

  beforeEach(() => {
    chamadas = [];
    respostaDoSalvar = { status: 200, corpo: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'PUT') {
          const enviado = JSON.parse(String(init.body)) as { horario: unknown };
          const corpo = respostaDoSalvar.corpo ?? { horario: enviado.horario, padrao: false };
          return new Response(JSON.stringify(corpo), { status: respostaDoSalvar.status });
        }
        return new Response(JSON.stringify({ horario: HORARIO_PADRAO, padrao: true }));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test('mostra os sete dias com "Atende" e os horários, e o padrão quando nada foi salvo @spec:AC-809', async () => {
    render(<HorarioAtendimento />);
    expect(await screen.findByText('Segunda-feira')).toBeTruthy();

    for (const nome of ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']) {
      expect(screen.getByLabelText(`Atende ${nome}`)).toBeTruthy();
      expect(screen.getByLabelText(`Abre ${nome}`)).toBeTruthy();
      expect(screen.getByLabelText(`Fecha ${nome}`)).toBeTruthy();
    }
    expect((screen.getByLabelText('Atende Segunda-feira') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Abre Segunda-feira') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText('Fecha Segunda-feira') as HTMLInputElement).value).toBe('18:00');
    expect((screen.getByLabelText('Atende Sábado') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Abre Sábado') as HTMLInputElement).disabled).toBe(true); // sem atendimento, sem horário
    expect(screen.getByText(/esta é a sugestão padrão/)).toBeTruthy();
  });

  test('salvar envia o horário editado e confirma "Horário salvo" @spec:AC-809', async () => {
    const u = userEvent.setup();
    render(<HorarioAtendimento />);
    await screen.findByText('Segunda-feira');

    await u.click(screen.getByLabelText('Atende Sábado'));
    fireEvent.change(screen.getByLabelText('Abre Sábado'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByLabelText('Fecha Sábado'), { target: { value: '13:00' } });
    await u.click(screen.getByRole('button', { name: 'Salvar horário' }));

    expect(await screen.findByText('Horário salvo')).toBeTruthy();
    const put = chamadas.find((c) => c.init?.method === 'PUT')!;
    expect(put.url).toBe('/api/configuracoes/horario-atendimento');
    expect(JSON.parse(String(put.init!.body)).horario.sab).toEqual({ atende: true, abre: '08:00', fecha: '13:00' });
    expect(screen.queryByText(/esta é a sugestão padrão/)).toBeNull(); // agora há um horário salvo
  });

  test('horário recusado pelo servidor mostra a mensagem e não diz que salvou @spec:AC-811', async () => {
    respostaDoSalvar = { status: 400, corpo: { codigo: 'HORARIO_INVALIDO', mensagem: 'O horário de fechamento precisa ser depois do de abertura.' } };
    const u = userEvent.setup();
    render(<HorarioAtendimento />);
    await screen.findByText('Segunda-feira');

    fireEvent.change(screen.getByLabelText('Fecha Segunda-feira'), { target: { value: '08:00' } });
    await u.click(screen.getByRole('button', { name: 'Salvar horário' }));

    expect((await screen.findByRole('alert')).textContent).toContain('depois do de abertura');
    expect(screen.queryByText('Horário salvo')).toBeNull();
  });
});
