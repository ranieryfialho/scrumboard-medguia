// @vitest-environment jsdom
//
// Testes de T-150 (fase4-design-system-shell-acesso, US-101): a tela de
// redefinir senha (`src/components/auth/formulario-redefinir-senha.tsx`).
// Mesmo molde de test/components/auth/login.test.tsx: `next/navigation`
// mockado (`useRouter` exige um app router de verdade que não existe em
// teste) e fetch falso para `/api/acesso/redefinir-senha/[token]`. AC-370
// (link expirado/inválido) já tem prova no servidor
// (test/api/acesso.test.ts, T-145) — aqui o GET de validação do token
// sempre responde válido, só para a tela chegar ao formulário.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { FormularioRedefinirSenha } from '@/components/auth/formulario-redefinir-senha';

const fetchOriginal = globalThis.fetch;
const TOKEN = 'token-valido-123';

function instalarFetchFalso() {
  const fetchFalso = vi.fn(
    async () => ({ ok: true, status: 200, json: async () => ({ valido: true }) }) as Response,
  );
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

async function renderizarFormularioValido() {
  instalarFetchFalso();
  render(<FormularioRedefinirSenha token={TOKEN} />);
  return screen.findByLabelText('Nova senha');
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  pushMock.mockClear();
});

describe('T-150: tela de redefinir senha', () => {
  describe('AC-367: os critérios de senha acendem enquanto o usuário digita', () => {
    test('cada critério troca de círculo cinza para marca verde conforme é atendido, e volta a cinza se deixar de ser @spec:AC-367', async () => {
      const campoSenha = await renderizarFormularioValido();
      const user = userEvent.setup();

      const itemComprimento = screen.getByText('Mínimo de 8 caracteres').closest('li') as HTMLElement;
      const itemMaiuscula = screen.getByText('Uma letra maiúscula').closest('li') as HTMLElement;
      const itemNumeroOuSimbolo = screen.getByText('Um número ou símbolo').closest('li') as HTMLElement;

      expect(itemComprimento.getAttribute('data-atendido')).toBe('false');
      expect(itemMaiuscula.getAttribute('data-atendido')).toBe('false');
      expect(itemNumeroOuSimbolo.getAttribute('data-atendido')).toBe('false');

      await user.type(campoSenha, 'abcdefgh');
      expect(itemComprimento.getAttribute('data-atendido')).toBe('true');
      expect(itemMaiuscula.getAttribute('data-atendido')).toBe('false');
      expect(itemNumeroOuSimbolo.getAttribute('data-atendido')).toBe('false');

      await user.type(campoSenha, 'A1');
      expect(itemComprimento.getAttribute('data-atendido')).toBe('true');
      expect(itemMaiuscula.getAttribute('data-atendido')).toBe('true');
      expect(itemNumeroOuSimbolo.getAttribute('data-atendido')).toBe('true');

      // Volta a cinza se deixar de ser atendido.
      await user.clear(campoSenha);
      expect(itemComprimento.getAttribute('data-atendido')).toBe('false');
      expect(itemMaiuscula.getAttribute('data-atendido')).toBe('false');
      expect(itemNumeroOuSimbolo.getAttribute('data-atendido')).toBe('false');
    });
  });

  describe('AC-368: senhas diferentes impedem o envio', () => {
    test('confirmação diferente mostra o aviso e mantém o botão desabilitado até coincidirem e a política ser atendida @spec:AC-368', async () => {
      const campoSenha = await renderizarFormularioValido();
      const user = userEvent.setup();
      const campoConfirmacao = screen.getByLabelText('Confirmação da nova senha') as HTMLInputElement;
      const botaoSalvar = screen.getByRole('button', { name: /Salvar nova senha e entrar/i }) as HTMLButtonElement;

      expect(botaoSalvar.disabled).toBe(true);

      await user.type(campoSenha, 'Abcdef12');
      await user.type(campoConfirmacao, 'Abcdef13');

      expect(screen.getByText('As senhas informadas não coincidem.')).toBeTruthy();
      expect(botaoSalvar.disabled).toBe(true);

      await user.clear(campoConfirmacao);
      await user.type(campoConfirmacao, 'Abcdef12');

      expect(screen.queryByText('As senhas informadas não coincidem.')).toBeNull();
      expect(botaoSalvar.disabled).toBe(false);
    });

    test('senhas iguais mas fora da política mantêm o botão desabilitado, sem mostrar o aviso de divergência @spec:AC-368', async () => {
      const campoSenha = await renderizarFormularioValido();
      const user = userEvent.setup();
      const campoConfirmacao = screen.getByLabelText('Confirmação da nova senha') as HTMLInputElement;
      const botaoSalvar = screen.getByRole('button', { name: /Salvar nova senha e entrar/i }) as HTMLButtonElement;

      await user.type(campoSenha, 'abc');
      await user.type(campoConfirmacao, 'abc');

      expect(screen.queryByText('As senhas informadas não coincidem.')).toBeNull();
      expect(botaoSalvar.disabled).toBe(true);
    });
  });
});
