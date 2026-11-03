// @vitest-environment jsdom
//
// T-287 (fase4-pipeline-telas, US-109, AC-738): os telefones e o e-mail do card têm botão de copiar.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Informacoes } from '../../../src/components/pipeline/detalhe/informacoes';
import { BotaoCopiar } from '../../../src/components/pipeline/detalhe/botao-copiar';

describe('T-287: copiar telefone e e-mail', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('cada telefone e o e-mail têm um botão que copia exatamente o texto mostrado @spec:AC-738', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });

    render(
      <Informacoes
        valor={null}
        origem="Meta"
        criadoEm="2026-11-01T12:00:00.000Z"
        responsavelNome={null}
        proximaAcaoEm={null}
        telefones={[
          { numero: '5511987654321', principal: true },
          { numero: '5511911112222', principal: false },
        ]}
        email="contato@clinica.com.br"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copiar telefone 5511987654321' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar telefone 5511911112222' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar e-mail' }));

    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(3));
    expect(escrever.mock.calls.map((c) => c[0])).toEqual(['5511987654321', '5511911112222', 'contato@clinica.com.br']);
    expect(await screen.findAllByText('Copiado')).toHaveLength(1);
  });

  test('se o navegador recusar a cópia, avisa que não foi possível @spec:AC-738', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('negado')) }, configurable: true });
    render(<BotaoCopiar texto="abc" rotulo="Copiar abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar abc' }));
    expect(await screen.findByText('Não foi possível copiar')).toBeTruthy();
  });
});
