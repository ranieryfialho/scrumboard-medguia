// @vitest-environment jsdom
//
// Testes de T-147 (fase4-design-system-shell-acesso, US-099 a US-103): a
// moldura comum das telas de acesso (`src/components/auth/moldura-acesso.tsx`)
// e o layout do grupo `(auth)` (`src/app/(auth)/layout.tsx`). Mesmo molde de
// test/components/shell/casca.test.tsx: `next/navigation` mockado
// (`useRouter` exige um app router de verdade que não existe em teste) e
// fetch falso para `/api/me`.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { MolduraAcesso } from '@/components/auth/moldura-acesso';
import AuthLayout from '@/app/(auth)/layout';

const fetchOriginal = globalThis.fetch;

function instalarFetchFalso(status: number) {
  const fetchFalso = vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: async () => ({}) } as Response),
  );
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  replaceMock.mockClear();
});

describe('T-147: moldura das telas de acesso', () => {
  // @spec:AC-347
  test('a moldura renderiza o conteúdo sem nenhum artefato do protótipo (seletor de estado, código de história, selo de conformidade)', () => {
    render(
      <MolduraAcesso>
        <p>Formulário de acesso de verdade</p>
      </MolduraAcesso>,
    );

    expect(screen.getByText('Formulário de acesso de verdade')).toBeTruthy();

    const texto = document.body.textContent ?? '';
    expect(texto).not.toMatch(/Estado:/);
    expect(texto).not.toMatch(/Simular Expirado/);
    expect(texto).not.toMatch(/Ver estado de erro do link/);
    expect(texto).not.toMatch(/US-\d{3}/);
    expect(texto).not.toMatch(/HIPAA/);
    expect(texto).not.toMatch(/ISO 27001/);
    expect(texto).not.toMatch(/SSL 256-bit/);
    expect(texto).not.toMatch(/MedGuia Tecnologia em Saúde S\.A\./);

    // rodapé com afirmações verdadeiras (Q-042): conexão segura e © 2026 MedGuia.
    expect(screen.getByText('Conexão segura')).toBeTruthy();
    expect(texto).toMatch(/© 2026 MedGuia/);
  });

  // @spec:AC-362
  test('quem já tem sessão válida e abre uma tela de acesso é levado para /pipeline, sem ver o formulário', async () => {
    instalarFetchFalso(200);

    render(
      <AuthLayout>
        <p>Formulário de login</p>
      </AuthLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/pipeline'));

    expect(screen.queryByText('Formulário de login')).toBeNull();
  });

  // @spec:AC-362
  test('sem sessão, a tela de acesso é renderizada normalmente, sem redirecionar', async () => {
    instalarFetchFalso(401);

    render(
      <AuthLayout>
        <p>Formulário de login</p>
      </AuthLayout>,
    );

    await waitFor(() => expect(screen.getByText('Formulário de login')).toBeTruthy());

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
