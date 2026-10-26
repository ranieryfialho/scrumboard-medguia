// @vitest-environment jsdom
//
// Testes de T-149 (fase4-design-system-shell-acesso, US-100): a tela de
// "esqueci minha senha" (`src/components/auth/formulario-esqueci-senha.tsx`).
// Mesmo molde de test/components/auth/login.test.tsx: fetch falso para
// `/api/acesso/esqueci-senha` (AC-364/AC-365 já são do servidor, T-145 — não
// repetidos aqui).
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FormularioEsqueciSenha } from '@/components/auth/formulario-esqueci-senha';

const fetchOriginal = globalThis.fetch;

function instalarFetchFalso() {
  const fetchFalso = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ solicitado: true }) }) as Response);
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

describe('T-149: tela de esqueci minha senha', () => {
  describe('AC-363: e-mail inválido é recusado na própria tela', () => {
    test('texto que não é e-mail mostra o erro em vermelho e nada é enviado ao servidor @spec:AC-363', async () => {
      const fetchFalso = instalarFetchFalso();
      render(<FormularioEsqueciSenha />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('E-mail cadastrado'), 'nao-e-um-email');
      await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));

      expect(await screen.findByText('Por favor, insira um e-mail válido.')).toBeTruthy();
      expect(fetchFalso).not.toHaveBeenCalled();
      expect(screen.queryByText('Instruções enviadas!')).toBeNull();
    });

    test('corrigir o e-mail e enviar de novo tira o erro da tela @spec:AC-363', async () => {
      const fetchFalso = instalarFetchFalso();
      render(<FormularioEsqueciSenha />);

      const user = userEvent.setup();
      const campo = screen.getByLabelText('E-mail cadastrado');
      await user.type(campo, 'nao-e-um-email');
      await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));
      expect(await screen.findByText('Por favor, insira um e-mail válido.')).toBeTruthy();

      await user.clear(campo);
      await user.type(campo, 'ana@clinica.com.br');
      await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));

      await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Por favor, insira um e-mail válido.')).toBeNull();
    });
  });

  describe('AC-366: dá para tentar outro e-mail', () => {
    test('na tela de confirmação, "Tentar outro e-mail" volta o formulário vazio @spec:AC-366', async () => {
      instalarFetchFalso();
      render(<FormularioEsqueciSenha />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('E-mail cadastrado'), 'ana@clinica.com.br');
      await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));

      expect(await screen.findByText('Instruções enviadas!')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Tentar outro e-mail/i }));

      expect(screen.queryByText('Instruções enviadas!')).toBeNull();
      const campoNovo = screen.getByLabelText('E-mail cadastrado') as HTMLInputElement;
      expect(campoNovo.value).toBe('');
    });

    test('na tela de confirmação, "Voltar ao login" leva a /login @spec:AC-366', async () => {
      instalarFetchFalso();
      render(<FormularioEsqueciSenha />);

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('E-mail cadastrado'), 'ana@clinica.com.br');
      await user.click(screen.getByRole('button', { name: /Enviar link de recuperação/i }));

      const link = (await screen.findByRole('link', { name: /Voltar ao login/i })) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/login');
    });
  });
});
