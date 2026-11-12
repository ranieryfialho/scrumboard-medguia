// fase6-periodo-personalizado (US-190): o período "Personalizado" (De/Até) nas telas de análises.
// Usa o relatório de marketing como tela de exemplo: as três telas compartilham `FiltroPeriodo` e as funções de `comum.ts`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RelatorioMarketing } from '../../../src/components/analises/relatorio-marketing';
import { nomeDoArquivoCsv, periodoAnteriorDe, periodoDe, rotuloDoPeriodo, validarIntervalo } from '../../../src/components/analises/comum';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const DADOS = {
  resumo: { leads: 120, conectados: 80, reunioesRealizadas: 30, contratos: 6, conversaoFinal: 0.05 },
  agrupar: 'dia',
  serie: [{ inicio: '2026-11-16', leads: 10, reunioes: 2 }],
  porOrigem: [{ origem: 'Google Ads', leads: 80, conectados: 50, reunioesRealizadas: 20, contratos: 5, conversaoFinal: 0.0625, valorGanho: 40000 }],
  origens: ['Google Ads'],
};

function lerBlob(blob: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result));
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsText(blob);
  });
}

describe('fase6-periodo-personalizado: filtro de período', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00Z'));
    fetchFalso = vi.fn((url: string) => (url.startsWith('/api/relatorios/marketing') ? resposta(200, DADOS) : resposta(404, {})));
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup({ advanceTimers: () => undefined });

  async function abrirTela() {
    render(<RelatorioMarketing />);
    await waitFor(() => expect(screen.getByText(/Detalhamento de Leads no Período/)).toBeTruthy());
  }

  function preencher(de: string, ate: string) {
    fireEvent.change(screen.getByLabelText('De'), { target: { value: de } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: ate } });
  }

  test('o filtro tem "Personalizado" com De e Até já preenchidos, e escolher um pronto fecha os campos @spec:AC-800', async () => {
    const u = usuario();
    await abrirTela();
    expect(screen.queryByLabelText('De')).toBeFalsy();

    await u.click(screen.getByRole('button', { name: 'Personalizado' }));
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe('2026-10-20');
    expect((screen.getByLabelText('Até') as HTMLInputElement).value).toBe('2026-11-18');
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(screen.queryByLabelText('De')).toBeFalsy();
  });

  test('aplicar pede o intervalo escolhido e o anterior de mesmo tamanho @spec:AC-801', async () => {
    const u = usuario();
    await abrirTela();
    await u.click(screen.getByRole('button', { name: 'Personalizado' }));
    preencher('2026-02-10', '2026-02-19');
    await u.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(urls().some((url) => url.includes('de=2026-02-10&ate=2026-02-19'))).toBe(true));
    expect(urls().some((url) => url.includes('de=2026-01-31&ate=2026-02-09'))).toBe(true);
    expect(periodoAnteriorDe({ tipo: 'personalizado', de: '2026-02-10', ate: '2026-02-19' })).toEqual({ de: '2026-01-31', ate: '2026-02-09' });
    expect(periodoDe({ tipo: 'personalizado', de: '2026-02-10', ate: '2026-02-19' })).toEqual({ de: '2026-02-10', ate: '2026-02-19' });
  });

  test('intervalo inválido avisa o motivo e não chama o servidor @spec:AC-802', async () => {
    const u = usuario();
    await abrirTela();
    await u.click(screen.getByRole('button', { name: 'Personalizado' }));
    const chamadasAntes = fetchFalso.mock.calls.length;

    preencher('2026-02-19', '2026-02-10');
    await u.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert').textContent).toBe('A data final não pode ser anterior à inicial');

    preencher('', '2026-02-10');
    await u.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert').textContent).toBe('Informe as duas datas');

    preencher('2025-01-01', '2026-02-10');
    await u.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert').textContent).toBe('O intervalo máximo é de 366 dias');

    expect(fetchFalso.mock.calls.length).toBe(chamadasAntes);
    expect(validarIntervalo('2026-02-10', '2026-02-19')).toBeNull();
    expect(validarIntervalo('2025-02-10', '2026-02-10')).toBeNull(); // 366 dias inclusivos ainda vale
  });

  test('o rótulo e o arquivo baixado levam as datas escolhidas @spec:AC-803', async () => {
    const u = usuario();
    const baixados: { nome: string; texto: Promise<string> }[] = [];
    const urlOriginal = globalThis.URL.createObjectURL;
    const revogarOriginal = globalThis.URL.revokeObjectURL;
    let ultimoBlob: Blob | null = null;
    globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
      ultimoBlob = blob;
      return 'blob:falso';
    }) as unknown as typeof URL.createObjectURL;
    globalThis.URL.revokeObjectURL = vi.fn();
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push({ nome: this.download, texto: lerBlob(ultimoBlob as unknown as Blob) });
    });

    try {
      await abrirTela();
      await u.click(screen.getByRole('button', { name: 'Personalizado' }));
      preencher('2026-02-10', '2026-02-19');
      await u.click(screen.getByRole('button', { name: 'Aplicar' }));
      await waitFor(() => expect(urls().some((url) => url.includes('de=2026-02-10&ate=2026-02-19'))).toBe(true));
      // o painel fecha ao aplicar e o próprio botão mostra as datas escolhidas
      expect(screen.queryByLabelText('De')).toBeFalsy();
      expect(screen.getByRole('button', { name: '10/02/2026 – 19/02/2026' })).toBeTruthy();

      await u.click(screen.getByRole('button', { name: /Exportar Relatório \(CSV\)/ }));
      expect(baixados[0].nome).toBe('relatorio-marketing_2026-02-10_a_2026-02-19.csv');
      expect(await baixados[0].texto).toContain('10/02/2026 a 19/02/2026');
    } finally {
      clique.mockRestore();
      globalThis.URL.createObjectURL = urlOriginal;
      globalThis.URL.revokeObjectURL = revogarOriginal;
    }

    expect(rotuloDoPeriodo({ tipo: 'personalizado', de: '2026-02-10', ate: '2026-02-19' })).toBe('10/02/2026 a 19/02/2026');
    expect(rotuloDoPeriodo({ tipo: 'preset', preset: 'mes' })).toBe('Este mês');
    expect(nomeDoArquivoCsv('relatorio-marketing', { tipo: 'personalizado', de: '2026-02-10', ate: '2026-02-19' })).toBe('relatorio-marketing_2026-02-10_a_2026-02-19.csv');
  });
});
