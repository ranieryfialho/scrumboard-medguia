// Testes de T-050 (fase2-kanban, US-032): únicos testes desta feature que
// precisam de DOM de verdade (clique real em botão) — por isso jsdom, via
// `environmentMatchGlobs` (vitest.config.ts), só pra `test/components/**`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModalDadoFaltante } from '../../../src/components/pipeline/modal-dado-faltante';

afterEach(() => {
  cleanup();
});

describe('T-050: ModalDadoFaltante', () => {
  describe('AC-090: cancelar o modal não faz nenhuma chamada', () => {
    test('clicar em Cancelar chama onCancelar e nunca onConfirmar @spec:AC-090', async () => {
      const onCancelar = vi.fn();
      const onConfirmar = vi.fn();
      const usuario = userEvent.setup();

      render(
        <ModalDadoFaltante codigo="VALOR_OBRIGATORIO" aberto onCancelar={onCancelar} onConfirmar={onConfirmar} />
      );

      await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(onCancelar).toHaveBeenCalledTimes(1);
      expect(onConfirmar).not.toHaveBeenCalled();
    });
  });

  describe('AC-089: preencher e confirmar o modal reenvia a transição com o dado', () => {
    test('VALOR_OBRIGATORIO: preencher o valor e confirmar chama onConfirmar com o número @spec:AC-089', async () => {
      const onCancelar = vi.fn();
      const onConfirmar = vi.fn();
      const usuario = userEvent.setup();

      render(
        <ModalDadoFaltante codigo="VALOR_OBRIGATORIO" aberto onCancelar={onCancelar} onConfirmar={onConfirmar} />
      );

      await usuario.type(screen.getByLabelText('Valor'), '1500');
      await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

      expect(onConfirmar).toHaveBeenCalledTimes(1);
      expect(onConfirmar).toHaveBeenCalledWith({ valor: 1500 });
      expect(onCancelar).not.toHaveBeenCalled();
    });

    test('VALOR_OBRIGATORIO: confirmar sem preencher nada não chama onConfirmar @spec:AC-089', async () => {
      const onCancelar = vi.fn();
      const onConfirmar = vi.fn();
      const usuario = userEvent.setup();

      render(
        <ModalDadoFaltante codigo="VALOR_OBRIGATORIO" aberto onCancelar={onCancelar} onConfirmar={onConfirmar} />
      );

      await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

      expect(onConfirmar).not.toHaveBeenCalled();
    });

    test('JUSTIFICATIVA_OBRIGATORIA: preencher e confirmar chama onConfirmar com o texto @spec:AC-089', async () => {
      const onCancelar = vi.fn();
      const onConfirmar = vi.fn();
      const usuario = userEvent.setup();

      render(
        <ModalDadoFaltante
          codigo="JUSTIFICATIVA_OBRIGATORIA"
          aberto
          onCancelar={onCancelar}
          onConfirmar={onConfirmar}
        />
      );

      await usuario.type(screen.getByLabelText('Justificativa'), 'Reaberto por pedido do cliente');
      await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

      expect(onConfirmar).toHaveBeenCalledWith({ justificativa: 'Reaberto por pedido do cliente' });
    });
  });
});
