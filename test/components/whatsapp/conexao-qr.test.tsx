// T-192 (fase4-whatsapp, US-126): a tela de conexão (src/components/whatsapp/conexao-qr.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConexaoQr } from '../../../src/components/whatsapp/conexao-qr';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-192: ConexaoQr', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let status: { state: string; instance: string | null };
  let qrResposta: () => Promise<unknown>;
  let papel: string;

  const chamadas = (url: string) => fetchFalso.mock.calls.filter((c) => c[0] === url).length;

  beforeEach(() => {
    status = { state: 'close', instance: 'matriz' };
    papel = 'GERENTE';
    qrResposta = () => resposta(200, { base64: 'data:image/png;base64,AAAA', webhookRegistrado: true });
    fetchFalso = vi.fn((url: string) => {
      if (url === '/api/whatsapp/status') return resposta(200, status);
      if (url === '/api/whatsapp/qrcode') return qrResposta();
      if (url.startsWith('/api/whatsapp/conversas')) return resposta(200, { resumo: { ativasHoje: 1, naoLidas: 0, mensagensHoje: { recebidas: 7, enviadas: 3 } } });
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título, o selo do estado real e "Atualizar Status" @spec:AC-517', async () => {
    const u = userEvent.setup();
    render(<ConexaoQr />);
    expect(await screen.findByRole('heading', { name: 'Conexão de Instância WhatsApp & QR Code' })).toBeTruthy();
    expect(await screen.findByText('Sessão desconectada')).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/whatsapp/conexao/page.tsx'))).toBe(true);

    status = { state: 'open', instance: 'matriz' };
    const antes = chamadas('/api/whatsapp/status');
    await u.click(screen.getByRole('button', { name: 'Atualizar Status' }));
    expect(await screen.findByText('Sessão ativa: Instância matriz')).toBeTruthy();
    expect(chamadas('/api/whatsapp/status')).toBeGreaterThan(antes);
    cleanup();

    status = { state: 'not_configured', instance: null };
    render(<ConexaoQr />);
    expect(await screen.findByText('WhatsApp não configurado')).toBeTruthy();
  });

  test('os cartões mostram o estado e as mensagens de hoje, sem latência, aparelho nem diagnóstico @spec:AC-518', async () => {
    render(<ConexaoQr />);
    await screen.findByText('Status da conexão');
    expect(screen.getAllByText('Desconectado').length).toBeGreaterThan(0);
    expect(await screen.findByText('10')).toBeTruthy();
    expect(screen.getByText('7 recebidas · 3 enviadas')).toBeTruthy();
    expect(screen.queryByText(/Latência|Aparelho pareado|Diagnóstico|Criptografia|IP de conexão/i)).toBeFalsy();
  });

  test('gerar o QR mostra a imagem e os passos, consulta o estado a cada 3 s e troca por "Conectado" @spec:AC-519', async () => {
    const u = userEvent.setup();
    render(<ConexaoQr />);
    await u.click(await screen.findByRole('button', { name: 'Gerar Novo QR Code' }));
    const imagem = (await screen.findByAltText('QR Code WhatsApp')) as HTMLImageElement;
    expect(imagem.src).toContain('data:image/png;base64,AAAA');
    expect(screen.getByText('Abra o WhatsApp no celular da clínica')).toBeTruthy();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    cleanup();
    render(<ConexaoQr />);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Gerar Novo QR Code' })).toBeTruthy());
    fireClick(screen.getByRole('button', { name: 'Gerar Novo QR Code' }));
    await vi.waitFor(() => expect(screen.getByAltText('QR Code WhatsApp')).toBeTruthy());
    const antes = chamadas('/api/whatsapp/status');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(chamadas('/api/whatsapp/status')).toBeGreaterThan(antes);
    status = { state: 'open', instance: 'matriz' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await vi.waitFor(() => expect(screen.getByText(/Conectado\. A sessão do WhatsApp já está ativa/)).toBeTruthy());
    expect(screen.queryByAltText('QR Code WhatsApp')).toBeFalsy();
    const depois = chamadas('/api/whatsapp/status');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(chamadas('/api/whatsapp/status')).toBe(depois);
  });

  test('já conectada, o QR não aparece e a sessão ativa é avisada @spec:AC-519', async () => {
    const u = userEvent.setup();
    status = { state: 'close', instance: 'matriz' };
    qrResposta = () => {
      status = { state: 'open', instance: 'matriz' };
      return resposta(200, { state: 'open' });
    };
    render(<ConexaoQr />);
    await u.click(await screen.findByRole('button', { name: 'Gerar Novo QR Code' }));
    expect(await screen.findByText(/Conectado\. A sessão do WhatsApp já está ativa/)).toBeTruthy();
    expect(screen.queryByAltText('QR Code WhatsApp')).toBeFalsy();
  });

  test('os erros do QR explicam o que fazer e o webhook inativo é avisado @spec:AC-520', async () => {
    const u = userEvent.setup();
    render(<ConexaoQr />);
    const gerar = await screen.findByRole('button', { name: 'Gerar Novo QR Code' });

    qrResposta = () => resposta(409, { codigo: 'WHATSAPP_NAO_CONFIGURADO' });
    await u.click(gerar);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/ainda não tem uma instância/);
    expect(within(alerta).getByRole('link', { name: 'Configurar o WhatsApp' }).getAttribute('href')).toBe('/whatsapp/configuracao');
    expect(screen.queryByAltText('QR Code WhatsApp')).toBeFalsy();

    qrResposta = () => resposta(502, { codigo: 'FALHA_EVOLUTION' });
    await u.click(gerar);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/indisponível/));

    qrResposta = () => resposta(403, { codigo: 'SEM_PERMISSAO' });
    await u.click(gerar);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Só MASTER e GERENTE/));

    qrResposta = () => Promise.reject(new Error('offline'));
    await u.click(gerar);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível falar com o servidor/));

    qrResposta = () => resposta(200, { base64: 'data:image/png;base64,BBBB', webhookRegistrado: false });
    await u.click(gerar);
    expect(await screen.findByAltText('QR Code WhatsApp')).toBeTruthy();
    expect(screen.getByText(/a entrada de mensagens \(webhook\) não foi ativada/)).toBeTruthy();
  });

  test('o estado é relido sozinho a cada 15 segundos @spec:AC-521', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<ConexaoQr />);
    await vi.waitFor(() => expect(screen.getByText('Sessão desconectada')).toBeTruthy());
    status = { state: 'open', instance: 'matriz' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await vi.waitFor(() => expect(screen.getByText('Sessão ativa: Instância matriz')).toBeTruthy());
  });

  test('desconectar, pareamento e nova instância aparecem "em breve"; a instância é uma só @spec:AC-522', async () => {
    render(<ConexaoQr />);
    await screen.findByRole('region', { name: 'Instâncias' });
    // T-304: "Desconectar Sessão" é real (fica travado enquanto não há sessão conectada); pareamento e nova instância seguem "em breve".
    expect((screen.getByRole('button', { name: 'Desconectar Sessão' }) as HTMLButtonElement).disabled).toBe(true);
    for (const rotulo of ['Código Numérico (Pairing)', 'Nova Instância']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    const instancias = screen.getByRole('region', { name: 'Instâncias' });
    expect(within(instancias).getAllByRole('article')).toHaveLength(1);
    expect(within(instancias).getByText('matriz')).toBeTruthy();
    expect(within(instancias).getByRole('button', { name: 'Reconectar' })).toBeTruthy();
    expect(within(instancias).getByRole('link', { name: 'Configurações Evolution' }).getAttribute('href')).toBe('/whatsapp/configuracao');
  });

  test('carregando mostra esqueleto, falha mostra erro com "Tentar de novo" e não configurado explica @spec:AC-531', async () => {
    render(<ConexaoQr />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByText('Sessão desconectada');
    cleanup();

    fetchFalso.mockImplementation((url: string) => (url === '/api/whatsapp/status' ? resposta(500, {}) : resposta(200, {})));
    render(<ConexaoQr />);
    expect(await screen.findByText(/Não foi possível consultar o estado/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});

function fireClick(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
