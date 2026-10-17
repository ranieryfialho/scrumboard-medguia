// Testes de T-103 (fase2d-kpis, US-063): a tela "Indicadores"
// (src/components/indicadores/painel-kpis.tsx) e o item de menu que leva até
// ela (src/components/layout/sidebar.tsx). Mesmo molde de
// test/components/tarefas/fila-tarefas.test.tsx: fetch falso + mocks de
// `@/lib/supabase/client` e `next/navigation` (o `Sidebar` ainda é código
// legado, Supabase Auth). AC-231 também cobre o redirecionamento "sem
// sessão" executando de fato `src/middleware.ts` contra `/indicadores` — o
// mesmo portão que já protege `/tarefas` e todo o resto do app, só provado
// aqui porque é a primeira vez que a spec referencia esse comportamento.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
      signOut: async () => {},
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { middleware } from '../../../src/middleware';
import { Sidebar } from '../../../src/components/layout/sidebar';
import { PainelKpis } from '../../../src/components/indicadores/painel-kpis';

function usuario(overrides: Partial<{ perfil: string; isSuperAdmin: boolean; ativo: boolean }> = {}) {
  return {
    data: {
      user: {
        user_metadata: {
          perfil: overrides.perfil,
          is_super_admin: overrides.isSuperAdmin ?? false,
          ativo: overrides.ativo ?? true,
        },
      },
    },
  };
}

function indicador(valor: number | null, numerador: number, denominador: number) {
  return { valor, numerador, denominador };
}

// Percentuais distintos entre si (nenhum indicador repete o mesmo
// percentual de outro) — é o que permite usar `screen.getByText('40%')`
// como marcador global de "já carregou", sem ambiguidade entre cartões.
function respostaKpis(overrides: Record<string, ReturnType<typeof indicador>> = {}) {
  const base = {
    conexao: indicador(0.4, 4, 10),
    cumprimentoCadencia: indicador(0.3, 3, 10),
    agendamento: indicador(0.5, 2, 4),
    noShow: indicador(0.2, 1, 5),
    proposta: indicador(0.8, 4, 5),
    ativacaoTrial: indicador(null, 0, 0),
    conversao: indicador(0.9, 9, 10),
  };
  return { ...base, ...overrides };
}

/** Mesmos números dos exemplos da spec (AC-221/AC-222) — pode repetir percentual entre cartões, por isso as asserções usam `cartao(titulo)` em vez de busca global. */
function respostaKpisExemploSpec() {
  return respostaKpis({
    conexao: indicador(0.4, 4, 10),
    cumprimentoCadencia: indicador(0.4, 2, 5),
    agendamento: indicador(0.5, 2, 4),
  });
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

/** Escopa as asserções no cartão do indicador (evita ambiguidade quando dois cartões têm o mesmo percentual). */
function cartao(titulo: string): HTMLElement {
  const elemento = screen.getByText(titulo).closest('[data-slot="card"]');
  if (!elemento) throw new Error(`Cartão "${titulo}" não encontrado.`);
  return elemento as HTMLElement;
}

describe('T-103: Sidebar (item "Indicadores") e PainelKpis', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let kpisAtuais: unknown;
  let kpisFalhar: boolean;

  beforeEach(() => {
    getUserMock.mockReset();
    kpisAtuais = respostaKpis();
    kpisFalhar = false;

    fetchFalso = vi.fn((url: string) => {
      if (url.startsWith('/api/relatorios/kpis')) {
        if (kpisFalhar) return resposta(500, { codigo: 'ERRO_INTERNO' });
        return resposta(200, kpisAtuais);
      }
      if (url === '/api/empresas') return resposta(200, []);
      return resposta(404, { codigo: 'NAO_ENCONTRADO' });
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = fetchOriginal;
  });

  describe('AC-231: a página exige login e tem item no menu', () => {
    test('MASTER vê "Indicadores" no menu levando a /indicadores @spec:AC-231', async () => {
      getUserMock.mockResolvedValue(usuario({ perfil: 'MASTER' }));
      render(<Sidebar abaAtiva="dashboard" setAbaAtiva={() => {}} />);

      const link = await screen.findByRole('link', { name: /indicadores/i });
      expect(link.getAttribute('href')).toBe('/indicadores');
    });

    test('GERENTE vê "Indicadores" no menu @spec:AC-231', async () => {
      getUserMock.mockResolvedValue(usuario({ perfil: 'GERENTE' }));
      render(<Sidebar abaAtiva="dashboard" setAbaAtiva={() => {}} />);

      const link = await screen.findByRole('link', { name: /indicadores/i });
      expect(link.getAttribute('href')).toBe('/indicadores');
    });

    test('super admin vê "Indicadores" no menu @spec:AC-231', async () => {
      getUserMock.mockResolvedValue(usuario({ isSuperAdmin: true }));
      render(<Sidebar abaAtiva="dashboard" setAbaAtiva={() => {}} />);

      const link = await screen.findByRole('link', { name: /indicadores/i });
      expect(link.getAttribute('href')).toBe('/indicadores');
    });

    test('ATENDENTE não vê "Indicadores" no menu @spec:AC-231', async () => {
      getUserMock.mockResolvedValue(usuario({ perfil: 'ATENDENTE' }));
      render(<Sidebar abaAtiva="dashboard" setAbaAtiva={() => {}} />);

      // Espera a permissão carregar (outro item sempre presente) antes de
      // afirmar a ausência — senão o teste passaria mesmo antes do efeito rodar.
      await screen.findByRole('link', { name: /minhas tarefas/i });
      expect(screen.queryByRole('link', { name: /indicadores/i })).toBeNull();
    });

    // Mesmo truque de fila-tarefas.test.tsx: `NextRequest`/`NextResponse`
    // constroem seus próprios `Headers` (não o `globalThis.Headers` do
    // jsdom deste arquivo); troca só pra esta chamada.
    test('sem sessão, o acesso a /indicadores é redirecionado para o login @spec:AC-231', async () => {
      const requisicao = new NextRequest('http://localhost/indicadores');
      vi.stubGlobal('Headers', requisicao.headers.constructor);

      const resposta = await middleware(requisicao);

      expect(resposta.status).toBe(307);
      const destino = new URL(resposta.headers.get('location') ?? '', 'http://localhost');
      expect(destino.pathname).toBe('/login');
    });
  });

  describe('AC-232: a página mostra cada indicador com a conta', () => {
    test('cada indicador aparece com percentual, nome por extenso e "N de M" @spec:AC-232', async () => {
      kpisAtuais = respostaKpisExemploSpec();
      render(<PainelKpis />);
      await screen.findByText('Taxa de conexão');

      const cartaoConexao = cartao('Taxa de conexão');
      expect(within(cartaoConexao).getByText('40%')).toBeTruthy();
      expect(within(cartaoConexao).getByText('4 de 10')).toBeTruthy();

      const cartaoCadencia = cartao('Cumprimento da régua de 18 toques');
      expect(within(cartaoCadencia).getByText('40%')).toBeTruthy();
      expect(within(cartaoCadencia).getByText('2 de 5')).toBeTruthy();

      const cartaoAgendamento = cartao('Taxa de agendamento');
      expect(within(cartaoAgendamento).getByText('50%')).toBeTruthy();
      expect(within(cartaoAgendamento).getByText('2 de 4')).toBeTruthy();
    });

    test('indicador sem valor mostra "—" e "sem dados no período" @spec:AC-232', async () => {
      render(<PainelKpis />);
      await screen.findByText('Ativação no trial');

      const cartaoTrial = cartao('Ativação no trial');
      expect(within(cartaoTrial).getByText('—')).toBeTruthy();
      expect(within(cartaoTrial).getByText('sem dados no período')).toBeTruthy();
      expect(within(cartaoTrial).queryByText('0%')).toBeNull();
    });
  });

  describe('AC-233: filtros da página recarregam os números', () => {
    test('mudar o período chama a rota com os novos filtros e substitui os números @spec:AC-233', async () => {
      render(<PainelKpis />);
      await screen.findByText('40%');

      kpisAtuais = respostaKpis({ conexao: indicador(0.7, 7, 10) });

      fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-01-01' } });
      fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-01-31' } });

      await waitFor(() => expect(screen.getByText('70%')).toBeTruthy());

      const chamouComAmbasAsDatas = fetchFalso.mock.calls.some((chamada) => {
        const url = chamada[0] as string;
        return url.includes('de=2026-01-01') && url.includes('ate=2026-01-31');
      });
      expect(chamouComAmbasAsDatas).toBe(true);
    });

    test('escolher um responsável (ao sair do campo) recarrega com responsavelId @spec:AC-233', async () => {
      render(<PainelKpis />);
      await screen.findByText('40%');

      kpisAtuais = respostaKpis({ conexao: indicador(0.95, 19, 20) });

      const usuarioEvento = userEvent.setup();
      const campoResponsavel = screen.getByLabelText('Responsável (ID)');
      await usuarioEvento.type(campoResponsavel, '11111111-1111-1111-1111-111111111111');
      await usuarioEvento.tab();

      await waitFor(() => expect(screen.getByText('95%')).toBeTruthy());

      const chamouComResponsavel = fetchFalso.mock.calls.some((chamada) =>
        (chamada[0] as string).includes('responsavelId=11111111-1111-1111-1111-111111111111')
      );
      expect(chamouComResponsavel).toBe(true);
    });

    test('mostra "Carregando" enquanto a rota responde @spec:AC-233', async () => {
      let resolver!: (valor: unknown) => void;
      fetchFalso.mockImplementationOnce(
        () => new Promise((resolve) => { resolver = resolve; })
      );

      render(<PainelKpis />);

      expect(await screen.findByText(/carregando indicadores/i)).toBeTruthy();

      resolver({ ok: true, status: 200, json: () => Promise.resolve(respostaKpis()) });
      await screen.findByText('40%');
    });

    test('falha da rota mostra erro com "Tentar de novo" e mantém os números anteriores @spec:AC-233', async () => {
      render(<PainelKpis />);
      await screen.findByText('40%');

      kpisFalhar = true;
      fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-02-01' } });

      await screen.findByText(/não foi possível carregar os indicadores/i);
      // Números anteriores continuam na tela — não foram apagados pela falha.
      expect(screen.getByText('40%')).toBeTruthy();

      kpisFalhar = false;
      kpisAtuais = respostaKpis({ conexao: indicador(0.6, 6, 10) });
      const usuarioEvento = userEvent.setup();
      await usuarioEvento.click(screen.getByRole('button', { name: /tentar de novo/i }));

      await waitFor(() => expect(screen.getByText('60%')).toBeTruthy());
      expect(screen.queryByText(/não foi possível carregar os indicadores/i)).toBeNull();
    });
  });
});
