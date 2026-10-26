// @vitest-environment jsdom
//
// Teste de T-153 (fase4-design-system-shell-acesso): garantia transversal
// de que nenhuma das cinco telas de acesso traz artefato do protótipo
// (seletor de estado, código de história/critério, afirmação de
// certificação ou versão/razão social inventadas). Roda por último,
// depois de T-148 a T-152, reusando o mesmo molde de mocks de
// `next/navigation` e fetch falso usado nos testes dessas tarefas.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
let nextParamAtual: string | null = null;
let deParamAtual: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({
    get: (chave: string) => {
      if (chave === 'next') return nextParamAtual;
      if (chave === 'de') return deParamAtual;
      return null;
    },
  }),
}));

import { FormularioLogin } from '@/components/auth/formulario-login';
import { FormularioEsqueciSenha } from '@/components/auth/formulario-esqueci-senha';
import { FormularioRedefinirSenha } from '@/components/auth/formulario-redefinir-senha';
import { FormularioConvite } from '@/components/auth/formulario-convite';
import { PainelSemAcesso } from '@/components/auth/painel-sem-acesso';

const fetchOriginal = globalThis.fetch;
const TOKEN = 'token-valido-123';
const CONVITE = {
  valido: true,
  email: 'dra.juliana@saolucas.med.br',
  papel: 'ATENDENTE',
  empresa: { id: 'empresa-1', nome: 'Clínica São Lucas' },
};

function instalarFetchFalso(corpo: unknown) {
  const fetchFalso = vi.fn(async () => ({ ok: true, status: 200, json: async () => corpo }) as Response);
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
  return fetchFalso;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
  pushMock.mockClear();
  nextParamAtual = null;
  deParamAtual = null;
});

const PADROES_PROIBIDOS = [
  /Estado:/,
  /Simular Expirado/,
  /Ver estado de erro do link/,
  /\bUS-\d{3}\b/,
  /\bAC-\d{3}\b/,
  /HIPAA/,
  /ISO\s*27001/,
  /SSL\s*256-?bit/,
];

function verificarSemArtefatos(container: HTMLElement) {
  const texto = container.textContent ?? '';
  for (const padrao of PADROES_PROIBIDOS) {
    expect(texto).not.toMatch(padrao);
  }
}

describe('T-153: nenhuma tela de acesso traz artefato do protótipo', () => {
  describe('AC-347: as telas de acesso não trazem artefatos do protótipo', () => {
    test('tela de login não traz artefato do protótipo @spec:AC-347', async () => {
      instalarFetchFalso({});
      const { container } = render(<FormularioLogin />);
      await screen.findByLabelText(/E-mail/i);
      verificarSemArtefatos(container);
    });

    test('tela de esqueci minha senha não traz artefato do protótipo @spec:AC-347', async () => {
      instalarFetchFalso({ solicitado: true });
      const { container } = render(<FormularioEsqueciSenha />);
      await screen.findByLabelText('E-mail cadastrado');
      verificarSemArtefatos(container);
    });

    test('tela de redefinir senha não traz artefato do protótipo @spec:AC-347', async () => {
      instalarFetchFalso({ valido: true });
      const { container } = render(<FormularioRedefinirSenha token={TOKEN} />);
      await screen.findByLabelText('Nova senha');
      verificarSemArtefatos(container);
    });

    test('tela de convite não traz artefato do protótipo @spec:AC-347', async () => {
      instalarFetchFalso(CONVITE);
      const { container } = render(<FormularioConvite token={TOKEN} />);
      await screen.findByLabelText('Nome completo');
      verificarSemArtefatos(container);
    });

    test('tela de sem acesso não traz artefato do protótipo @spec:AC-347', async () => {
      deParamAtual = '/indicadores';
      instalarFetchFalso({ papel: 'ATENDENTE' });
      const { container } = render(<PainelSemAcesso />);
      await screen.findByText('Código 403');
      verificarSemArtefatos(container);
    });

    test('tela de sessão expirada não traz artefato do protótipo @spec:AC-347', async () => {
      deParamAtual = '/indicadores';
      const fetchFalso = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response);
      globalThis.fetch = fetchFalso as unknown as typeof fetch;
      const { container } = render(<PainelSemAcesso />);
      await screen.findByRole('heading', { name: 'Sessão Expirada' });
      verificarSemArtefatos(container);
    });
  });
});
