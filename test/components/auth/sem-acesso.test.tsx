// @vitest-environment jsdom
//
// Testes de T-152 (fase4-design-system-shell-acesso, US-103): o painel de
// sem acesso e sessão expirada (`src/components/auth/painel-sem-acesso.tsx`).
// Mesmo molde de test/components/auth/convite.test.tsx: `next/navigation`
// mockado (`useSearchParams` exige um app router de verdade que não existe
// em teste) e fetch falso para `GET /api/me`.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let deParamAtual: string | null = null;

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (chave: string) => (chave === 'de' ? deParamAtual : null) }),
}));

import { PainelSemAcesso } from '@/components/auth/painel-sem-acesso';

const fetchOriginal = globalThis.fetch;

function instalarFetchFalso(resposta: { ok: boolean; corpo?: unknown }) {
  const fetchFalso = vi.fn(
    async () =>
      ({
        ok: resposta.ok,
        status: resposta.ok ? 200 : 401,
        json: async () => resposta.corpo ?? {},
      }) as Response
  );
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  deParamAtual = null;
});

describe('T-152: painel de sem acesso e sessão expirada', () => {
  describe('AC-375: a tela mostra o perfil e o que foi pedido', () => {
    test('mostra "Código 403", o perfil autenticado e o recurso com nome legível @spec:AC-375', async () => {
      deParamAtual = '/indicadores';
      instalarFetchFalso({ ok: true, corpo: { papel: 'ATENDENTE' } });

      render(<PainelSemAcesso />);

      expect(await screen.findByText('Código 403')).toBeTruthy();
      expect(screen.getByText('ATENDENTE')).toBeTruthy();
      expect(screen.getByText('Indicadores')).toBeTruthy();
    });

    test('para rota que o sistema não conhece, mostra o caminho tal como veio @spec:AC-375', async () => {
      deParamAtual = '/relatorio-financeiro-interno';
      instalarFetchFalso({ ok: true, corpo: { papel: 'GERENTE' } });

      render(<PainelSemAcesso />);

      await screen.findByText('Código 403');
      expect(screen.getByText('/relatorio-financeiro-interno')).toBeTruthy();
    });
  });

  describe('AC-376: as ações da tela levam aonde dizem', () => {
    test('os links e o botão "em breve" apontam para os destinos certos @spec:AC-376', async () => {
      deParamAtual = '/indicadores';
      instalarFetchFalso({ ok: true, corpo: { papel: 'ATENDENTE' } });

      render(<PainelSemAcesso />);
      await screen.findByText('Código 403');

      const linkEntrar = screen.getByRole('link', { name: /Entrar novamente/i });
      expect(linkEntrar.getAttribute('href')).toBe('/login');

      const linkTarefas = screen.getByRole('link', { name: /Minhas Tarefas/i });
      expect(linkTarefas.getAttribute('href')).toBe('/tarefas');

      const botaoSolicitar = screen.getByRole('button', {
        name: /Solicitar permissão ao Administrador/i,
      }) as HTMLButtonElement;
      expect(botaoSolicitar.disabled).toBe(true);
      expect(screen.getByText('em breve')).toBeTruthy();
    });
  });

  describe('AC-377: sem sessão, a tela se apresenta como sessão expirada', () => {
    test('título "Sessão Expirada", sem perfil nem recurso, botão principal "Entrar novamente" @spec:AC-377', async () => {
      deParamAtual = '/indicadores';
      instalarFetchFalso({ ok: false });

      render(<PainelSemAcesso />);

      expect(await screen.findByRole('heading', { name: 'Sessão Expirada' })).toBeTruthy();
      expect(screen.queryByText('Código 403')).toBeNull();
      expect(screen.queryByText('ATENDENTE')).toBeNull();
      expect(screen.queryByText('Indicadores')).toBeNull();
      expect(screen.queryByText('Perfil Autenticado:')).toBeNull();
      expect(screen.queryByText('Recurso Solicitado:')).toBeNull();

      const linkEntrar = screen.getByRole('link', { name: /Entrar novamente/i });
      expect(linkEntrar.getAttribute('href')).toBe('/login');
      expect(screen.queryByRole('link', { name: /Minhas Tarefas/i })).toBeNull();
    });
  });
});
