// @vitest-environment jsdom
//
// Testes de T-148 (fase4-design-system-shell-acesso, US-099): a tela de
// login (`src/app/(auth)/login/page.tsx` e
// `src/components/auth/formulario-login.tsx`). Mesmo molde de
// test/components/shell/casca.test.tsx e test/components/auth/moldura.test.tsx:
// `next/navigation` mockado (`useRouter`/`useSearchParams` exigem um app
// router de verdade que não existe em teste) e fetch falso para
// `/api/auth/sign-in/email`.
//
// AC-360 (contagem regressiva do bloqueio): o componente guarda os
// horários das falhas em `localStorage` (mesma janela/limite do servidor,
// `rate-limit.ts`) — por isso cada teste limpa o `localStorage` antes de
// rodar, e os testes de bloqueio semeiam esse armazenamento diretamente
// para simular tentativas anteriores sem precisar repetir 5 envios.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { JANELA_PADRAO_MS, LIMITE_PADRAO_TENTATIVAS } from '../../../src/lib/auth/rate-limit';

const CHAVE_TENTATIVAS = 'medcrm:login:tentativas-falhas';

const pushMock = vi.fn();
let nextParamAtual: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ get: (chave: string) => (chave === 'next' ? nextParamAtual : null) }),
}));

import { FormularioLogin } from '@/components/auth/formulario-login';

const fetchOriginal = globalThis.fetch;

function instalarFetchFalso(resolucao: () => Promise<{ status: number }>) {
  const fetchFalso = vi.fn(async () => {
    const { status } = await resolucao();
    return { ok: status < 400, status, json: async () => ({}) } as Response;
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

function semearFalhas(quantidade: number, agoraMs: number = Date.now()): void {
  const falhas = Array.from({ length: quantidade }, (_, indice) => agoraMs - indice * 1000);
  window.localStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify(falhas));
}

async function preencherFormulario(email: string, senha: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('E-mail institucional'), email);
  await user.type(screen.getByLabelText('Senha de acesso'), senha);
  return user;
}

beforeEach(() => {
  window.localStorage.removeItem(CHAVE_TENTATIVAS);
  pushMock.mockClear();
  nextParamAtual = null;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  vi.useRealTimers();
});

describe('T-148: tela de login', () => {
  describe('AC-358: login correto leva ao sistema', () => {
    test('com e-mail e senha corretos e `next` do mesmo site, vai para o `next` @spec:AC-358', async () => {
      nextParamAtual = '/tarefas';
      instalarFetchFalso(async () => ({ status: 200 }));
      render(<FormularioLogin />);

      const user = await preencherFormulario('ana@clinica.com.br', 'senha-correta-123');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/tarefas'));
    });

    test('sem `next`, vai para /pipeline @spec:AC-358', async () => {
      nextParamAtual = null;
      instalarFetchFalso(async () => ({ status: 200 }));
      render(<FormularioLogin />);

      const user = await preencherFormulario('ana@clinica.com.br', 'senha-correta-123');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/pipeline'));
    });

    test('um `next` de outro domínio (`//site.com`, `https://…`) é ignorado, vai para /pipeline @spec:AC-358', async () => {
      instalarFetchFalso(async () => ({ status: 200 }));

      nextParamAtual = '//site.com';
      const { unmount } = render(<FormularioLogin />);
      let user = await preencherFormulario('ana@clinica.com.br', 'senha-correta-123');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/pipeline'));
      unmount();

      pushMock.mockClear();
      nextParamAtual = 'https://site-externo.com/pagina';
      render(<FormularioLogin />);
      user = await preencherFormulario('ana@clinica.com.br', 'senha-correta-123');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/pipeline'));
    });
  });

  describe('AC-359: credenciais erradas mostram o aviso com as tentativas que restam', () => {
    test('na 2ª tentativa dentro da janela, mostra "Credenciais Inválidas" dizendo que restam 3 tentativas, com realce vermelho nos campos @spec:AC-359', async () => {
      semearFalhas(1);
      instalarFetchFalso(async () => ({ status: 401 }));
      render(<FormularioLogin />);

      const user = await preencherFormulario('ana@clinica.com.br', 'senha-errada');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));

      const banner = await screen.findByText('Credenciais Inválidas');
      expect(banner).toBeTruthy();
      expect(banner.parentElement?.textContent).toMatch(/restam.*3 tentativas/i);

      expect(screen.getByLabelText('E-mail institucional').className).toMatch(/ring-danger-text/);
      expect(screen.getByLabelText('Senha de acesso').className).toMatch(/ring-danger-text/);
    });

    test('a mensagem é a mesma para e-mail inexistente e para usuário inativo (não revela se a conta existe) @spec:AC-359', async () => {
      instalarFetchFalso(async () => ({ status: 401 }));
      const { unmount } = render(<FormularioLogin />);
      let user = await preencherFormulario('inexistente@clinica.com.br', 'qualquer-senha');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));
      const mensagemInexistente = (await screen.findByText('Credenciais Inválidas')).parentElement?.textContent;
      unmount();

      window.localStorage.removeItem(CHAVE_TENTATIVAS);
      render(<FormularioLogin />);
      user = await preencherFormulario('inativo@clinica.com.br', 'qualquer-senha');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));
      const mensagemInativo = (await screen.findByText('Credenciais Inválidas')).parentElement?.textContent;

      expect(mensagemInexistente).toEqual(mensagemInativo);
    });
  });

  describe('AC-360: excesso de tentativas bloqueia a tela com contagem regressiva', () => {
    test(`na ${LIMITE_PADRAO_TENTATIVAS}ª tentativa incorreta, mostra "Acesso Temporariamente Suspenso" com contagem mm:ss e desabilita campos e botão @spec:AC-360`, async () => {
      semearFalhas(LIMITE_PADRAO_TENTATIVAS - 1);
      instalarFetchFalso(async () => ({ status: 401 }));
      render(<FormularioLogin />);

      const user = await preencherFormulario('ana@clinica.com.br', 'senha-errada');
      await user.click(screen.getByRole('button', { name: /Entrar na Plataforma/i }));

      expect(await screen.findByText('Acesso Temporariamente Suspenso')).toBeTruthy();
      expect(screen.getByText(/Acesso bloqueado por segurança por/i).textContent).toMatch(/\d{1,2}:\d{2}/);

      expect((screen.getByRole('button', { name: /Acesso Bloqueado Temporariamente/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText('E-mail institucional') as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByLabelText('Senha de acesso') as HTMLInputElement).disabled).toBe(true);
    });

    test('abrir a tela de novo ainda dentro do bloqueio já mostra o aviso e os campos desabilitados @spec:AC-360', () => {
      semearFalhas(LIMITE_PADRAO_TENTATIVAS);
      render(<FormularioLogin />);

      expect(screen.getByText('Acesso Temporariamente Suspenso')).toBeTruthy();
      expect((screen.getByRole('button', { name: /Acesso Bloqueado Temporariamente/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    test('quando a contagem chega a zero, o formulário volta a funcionar @spec:AC-360', () => {
      vi.useFakeTimers();
      semearFalhas(LIMITE_PADRAO_TENTATIVAS);
      render(<FormularioLogin />);

      expect(screen.getByText('Acesso Temporariamente Suspenso')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(JANELA_PADRAO_MS + 1000);
      });

      expect(screen.queryByText('Acesso Temporariamente Suspenso')).toBeNull();
      expect((screen.getByRole('button', { name: /Entrar na Plataforma/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByLabelText('E-mail institucional') as HTMLInputElement).disabled).toBe(false);
    });
  });

  describe('AC-361: enquanto envia, o botão não aceita novo clique', () => {
    test('clicar de novo em "Entrar na Plataforma" durante o envio não dispara um segundo envio @spec:AC-361', async () => {
      let resolverFetch: (() => void) | undefined;
      const fetchFalso = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolverFetch = () => resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
          }),
      );
      globalThis.fetch = fetchFalso as unknown as typeof fetch;

      render(<FormularioLogin />);
      await preencherFormulario('ana@clinica.com.br', 'senha-correta-123');

      const botao = screen.getByRole('button', { name: /Entrar na Plataforma/i });
      fireEvent.click(botao);

      await waitFor(() => expect(screen.getByRole('status', { name: /Enviando/i })).toBeTruthy());
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);

      // Segundo clique durante o envio: o botão está desabilitado, então o
      // `form.onSubmit` não dispara de novo — mesmo chamando-o diretamente.
      fireEvent.click(screen.getByRole('button'));
      expect(fetchFalso).toHaveBeenCalledTimes(1);

      resolverFetch?.();
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/pipeline'));
    });
  });
});
