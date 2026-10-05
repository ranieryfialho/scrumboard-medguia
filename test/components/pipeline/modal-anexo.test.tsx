// Testes de T-058 (fase2c-anexos, US-036): o modal de dado faltante com
// EVIDENCIA_OBRIGATORIA deixa escolher ou colar o print e só então confirmar.
// jsdom (vitest.config.ts: environmentMatchGlobs para test/components/**).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModalDadoFaltante } from '../../../src/components/pipeline/modal-dado-faltante';

function botaoConfirmar() {
  return screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement;
}

const CARD = 'ffffffff-0000-0000-0000-0000000000b1';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

function abrirModal() {
  const onCancelar = vi.fn();
  const onConfirmar = vi.fn();
  render(
    <ModalDadoFaltante
      codigo="EVIDENCIA_OBRIGATORIA"
      oportunidadeId={CARD}
      aberto
      onCancelar={onCancelar}
      onConfirmar={onConfirmar}
    />
  );
  return { onCancelar, onConfirmar };
}

const PRINT = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'conversa.png', { type: 'image/png' });

describe('T-058: modal de evidência', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFalso = vi.fn();
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('escolher o arquivo envia ao servidor, mostra o nome e confirma com o anexoId @spec:AC-107', async () => {
    fetchFalso.mockReturnValue(resposta(201, { anexoId: 'anexo-123', url: '/api/anexos/anexo-123' }));
    const { onConfirmar } = abrirModal();
    const usuario = userEvent.setup();

    // Antes de anexar nada, confirmar está desabilitado.
    expect(botaoConfirmar().disabled).toBe(true);

    await usuario.upload(screen.getByLabelText('Print ou PDF da evidência'), PRINT());

    expect(await screen.findByText(/Anexado: conversa\.png/)).toBeTruthy();
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe('/api/anexos');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('oportunidadeId')).toBe(CARD);
    expect(((init.body as FormData).get('arquivo') as File).name).toBe('conversa.png');

    expect(botaoConfirmar().disabled).toBe(false);
    await usuario.click(botaoConfirmar());
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).toHaveBeenCalledWith({ anexoId: 'anexo-123' });
  });

  test('colar uma imagem (Ctrl+V) também envia e libera o Confirmar @spec:AC-107', async () => {
    fetchFalso.mockReturnValue(resposta(201, { anexoId: 'anexo-colado' }));
    abrirModal();

    fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { files: [PRINT()] } });

    expect(await screen.findByText(/Anexado: conversa\.png/)).toBeTruthy();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(botaoConfirmar().disabled).toBe(false);
  });

  test('envio recusado mostra o motivo e mantém o Confirmar desabilitado @spec:AC-107', async () => {
    fetchFalso.mockReturnValue(resposta(415, { codigo: 'TIPO_NAO_PERMITIDO' }));
    const { onConfirmar } = abrirModal();
    const usuario = userEvent.setup();

    await usuario.upload(
      screen.getByLabelText('Print ou PDF da evidência'),
      new File(['MZ'], 'foto.png', { type: 'image/png' })
    );

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/Tipo de arquivo não permitido/);
    await waitFor(() => expect(botaoConfirmar().disabled).toBe(true));
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});
