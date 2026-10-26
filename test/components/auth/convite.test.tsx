// @vitest-environment jsdom
//
// Testes de T-151 (fase4-design-system-shell-acesso, US-102): a tela de
// convite (`src/components/auth/formulario-convite.tsx`). Mesmo molde de
// test/components/auth/redefinir-senha.test.tsx: `next/navigation` mockado e
// fetch falso para `/api/acesso/convite/[token]`. AC-371/AC-373/AC-374 já
// têm prova no servidor (test/api/acesso.test.ts, T-145) — aqui o GET de
// validação do token sempre responde válido, só para a tela chegar ao
// formulário de ativação.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { FormularioConvite } from '@/components/auth/formulario-convite';

const fetchOriginal = globalThis.fetch;
const TOKEN = 'token-convite-valido-123';
const CONVITE = {
  valido: true,
  email: 'dra.juliana@saolucas.med.br',
  papel: 'ATENDENTE',
  empresa: { id: 'empresa-1', nome: 'Clínica São Lucas' },
};

function instalarFetchFalso() {
  const fetchFalso = vi.fn(async () => ({ ok: true, status: 200, json: async () => CONVITE }) as Response);
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

async function renderizarFormularioValido() {
  instalarFetchFalso();
  render(<FormularioConvite token={TOKEN} />);
  return screen.findByLabelText('Nome completo');
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  pushMock.mockClear();
});

describe('T-151: tela de convite', () => {
  describe('AC-372: ativar exige nome, senha válida e aceite dos termos', () => {
    test('o botão "Ativar minha conta" começa desabilitado @spec:AC-372', async () => {
      await renderizarFormularioValido();

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(true);
    });

    test('falta o nome mantém o botão desabilitado mesmo com senha válida e aceite marcado @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Definir senha'), 'Abcdef12');
      await user.type(screen.getByLabelText('Confirmar senha'), 'Abcdef12');
      await user.click(screen.getByLabelText(/Li e concordo com os/i));

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(true);
    });

    test('senha fora da política mantém o botão desabilitado mesmo com nome e aceite preenchidos @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Nome completo'), 'Dra. Juliana Ribeiro Rocha');
      await user.type(screen.getByLabelText('Definir senha'), 'abc');
      await user.type(screen.getByLabelText('Confirmar senha'), 'abc');
      await user.click(screen.getByLabelText(/Li e concordo com os/i));

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(true);
    });

    test('confirmação diferente da senha mantém o botão desabilitado mesmo com nome e aceite preenchidos @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Nome completo'), 'Dra. Juliana Ribeiro Rocha');
      await user.type(screen.getByLabelText('Definir senha'), 'Abcdef12');
      await user.type(screen.getByLabelText('Confirmar senha'), 'Abcdef13');
      await user.click(screen.getByLabelText(/Li e concordo com os/i));

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(true);
    });

    test('aceite dos termos não marcado mantém o botão desabilitado mesmo com nome e senha válidos @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Nome completo'), 'Dra. Juliana Ribeiro Rocha');
      await user.type(screen.getByLabelText('Definir senha'), 'Abcdef12');
      await user.type(screen.getByLabelText('Confirmar senha'), 'Abcdef12');

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(true);
    });

    test('nome, senha válida, confirmação igual e aceite marcado liberam o botão @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Nome completo'), 'Dra. Juliana Ribeiro Rocha');
      await user.type(screen.getByLabelText('Definir senha'), 'Abcdef12');
      await user.type(screen.getByLabelText('Confirmar senha'), 'Abcdef12');
      await user.click(screen.getByLabelText(/Li e concordo com os/i));

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(false);
    });

    test('desmarcar o aceite depois de marcado volta a desabilitar o botão @spec:AC-372', async () => {
      await renderizarFormularioValido();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Nome completo'), 'Dra. Juliana Ribeiro Rocha');
      await user.type(screen.getByLabelText('Definir senha'), 'Abcdef12');
      await user.type(screen.getByLabelText('Confirmar senha'), 'Abcdef12');
      const checkboxTermos = screen.getByLabelText(/Li e concordo com os/i);
      await user.click(checkboxTermos);

      const botaoAtivar = screen.getByRole('button', { name: /Ativar minha conta/i }) as HTMLButtonElement;
      expect(botaoAtivar.disabled).toBe(false);

      await user.click(checkboxTermos);
      expect(botaoAtivar.disabled).toBe(true);
    });
  });
});
