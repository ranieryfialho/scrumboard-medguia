// @vitest-environment jsdom
//
// Testes de T-161 (fase4-pipeline-telas, US-107): a tela da lista
// (`src/app/(app)/pipeline/lista/page.tsx`), com `TabelaLista` e
// `FiltrosLista`. `next/navigation` mockado (`useRouter`/`useSearchParams`
// exigem um app router de verdade, mesmo molde de
// test/components/auth/sem-acesso.test.tsx) e fetch falso para
// `GET /api/oportunidades/lista`. A casca (menu com "Lista" marcado, topo)
// vem do layout do grupo `(app)` (T-146) e já está provada em
// test/components/shell/casca.test.tsx; aqui a prova é o que esta tela
// renderiza dentro dela (AC-394).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsIniciais = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => paramsIniciais,
}));

import PipelineListaPage from '../../../src/app/(app)/pipeline/lista/page';

interface ItemListaTeste {
  id: string;
  etapaId: number;
  valor: string | null;
  proximaAcaoEm: string | null;
  lead: { id: string; nome: string; email: string | null; telefoneE164: string | null; origem?: string | null };
  responsavel: { id: string; nome: string } | null;
}

let contador = 0;

function item(overrides: Partial<ItemListaTeste> = {}): ItemListaTeste {
  contador += 1;
  return {
    id: overrides.id ?? `op-${contador}`,
    etapaId: overrides.etapaId ?? 1,
    valor: overrides.valor ?? '1000.00',
    proximaAcaoEm: overrides.proximaAcaoEm ?? null,
    lead: overrides.lead ?? { id: `lead-${contador}`, nome: `Lead ${contador}`, email: null, telefoneE164: null, origem: 'Google Ads' },
    responsavel: overrides.responsavel === undefined ? { id: 'resp-1', nome: 'Carlos Mendes' } : overrides.responsavel,
  };
}

const OPCOES_PADRAO = { itens: [item({ id: 'op-opcoes' })], total: 1, pagina: 1, porPagina: 50 as const };

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let respostaLista: { itens: ItemListaTeste[]; total: number; pagina: number; porPagina: 10 | 25 | 50 };

function configurarLista(
  itens: ItemListaTeste[],
  extras: Partial<{ total: number; pagina: number; porPagina: 10 | 25 | 50 }> = {}
) {
  respostaLista = {
    itens,
    total: extras.total ?? itens.length,
    pagina: extras.pagina ?? 1,
    porPagina: extras.porPagina ?? 10,
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

beforeEach(() => {
  contador = 0;
  paramsIniciais = new URLSearchParams();
  routerReplace.mockClear();
  configurarLista([item()]);

  fetchFalso = vi.fn((url: string) => {
    const analisada = new URL(url, 'http://localhost');
    if (!analisada.pathname.includes('/api/oportunidades/lista')) return resposta(404, { codigo: 'NAO_ENCONTRADO' });
    // A chamada de opções (responsável/origem, ASM-137) nunca manda `pagina`.
    if (!analisada.searchParams.has('pagina')) return resposta(200, OPCOES_PADRAO);
    return resposta(200, respostaLista);
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

function ultimaQueryDe(pathnameParcial: string, ehPagina: boolean): URLSearchParams {
  const chamadas = fetchFalso.mock.calls
    .map((chamada) => new URL(chamada[0] as string, 'http://localhost'))
    .filter((u) => u.pathname.includes(pathnameParcial) && u.searchParams.has('pagina') === ehPagina);
  return chamadas[chamadas.length - 1].searchParams;
}

describe('T-161: tela da lista', () => {
  describe('AC-394: a lista aparece dentro da casca, em /pipeline/lista', () => {
    test('mostra o título e a tabela com lead, etapa, responsável, valor e próxima ação @spec:AC-394', async () => {
      configurarLista([
        item({ etapaId: 5, lead: { id: 'l1', nome: 'Clínica Alfa', email: null, telefoneE164: null }, responsavel: { id: 'r1', nome: 'Juliana Rocha' }, valor: '6500.00' }),
      ]);

      render(<PipelineListaPage />);

      expect(await screen.findByText('Pipeline em Lista')).toBeTruthy();
      expect(screen.getByText('Lead')).toBeTruthy();
      expect(screen.getByText('Etapa Atual')).toBeTruthy();
      expect(screen.getByText('Responsável')).toBeTruthy();
      expect(screen.getByText('Valor Estimado')).toBeTruthy();
      expect(screen.getByText('Próxima Ação')).toBeTruthy();

      const tabela = screen.getByRole('table');
      expect(within(tabela).getByText('Clínica Alfa')).toBeTruthy();
      expect(within(tabela).getByText('Qualificando')).toBeTruthy();
      expect(within(tabela).getByText('Juliana Rocha')).toBeTruthy();
      expect(within(tabela).getByText(/R\$\s*6\.500,00/)).toBeTruthy();
    });

    test('sem nenhum lead, mostra o estado vazio em vez da tabela @spec:AC-394', async () => {
      configurarLista([], { total: 0 });

      render(<PipelineListaPage />);

      expect(await screen.findByText('Nenhum lead ainda')).toBeTruthy();
      expect(screen.queryByText('Lead')).toBeNull();
    });
  });

  describe('AC-395: o servidor pagina a lista', () => {
    test('a página 2 de 25 (tamanho 10) mostra "Exibindo 11 a 20 de 25" e os botões de página @spec:AC-395', async () => {
      paramsIniciais = new URLSearchParams('pagina=2&porPagina=10');
      configurarLista(
        Array.from({ length: 10 }, (_, i) => item({ lead: { id: `l${i}`, nome: `Lead ${11 + i}`, email: null, telefoneE164: null } })),
        { total: 25, pagina: 2, porPagina: 10 }
      );

      render(<PipelineListaPage />);

      expect(await screen.findByText('Lead 11')).toBeTruthy();
      expect(screen.getByText('11 a 20')).toBeTruthy();
      expect(screen.getByText('25')).toBeTruthy();
      expect(screen.getByRole('button', { name: '2' })).toBeTruthy();
    });

    test('clicar em "Próxima página" busca a página seguinte no servidor @spec:AC-395', async () => {
      configurarLista([item({ lead: { id: 'l1', nome: 'Primeira Página', email: null, telefoneE164: null } })], {
        total: 25,
        pagina: 1,
        porPagina: 10,
      });

      render(<PipelineListaPage />);
      await screen.findByText('Primeira Página');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByRole('button', { name: 'Próxima página' }));

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('pagina')).toBe('2');
      });
    });

    test('o seletor "Exibir" só oferece 10, 25 e 50 por página @spec:AC-395', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const seletor = screen.getByLabelText('Exibir:') as HTMLSelectElement;
      const valores = [...seletor.options].map((opcao) => opcao.value);
      expect(valores).toEqual(['10', '25', '50']);
    });

    test('escolher "25 por página" busca a primeira página com o novo tamanho @spec:AC-395', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Exibir:'), '25');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('porPagina')).toBe('25');
        expect(query.get('pagina')).toBe('1');
      });
    });
  });

  describe('AC-396: o servidor filtra e ordena a lista', () => {
    test('digitar na busca envia o texto para o servidor @spec:AC-396', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const usuario = userEvent.setup();
      await usuario.type(screen.getByLabelText('Buscar'), 'maria');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('busca')).toBe('maria');
        expect(query.get('pagina')).toBe('1');
      });
    });

    test('escolher uma etapa envia o id da etapa para o servidor @spec:AC-396', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Etapa'), 'Negociação');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('etapaId')).toBe('13');
      });
    });

    test('escolher um responsável (das opções vindas do servidor) filtra por ele @spec:AC-396', async () => {
      configurarLista([item({ responsavel: { id: 'resp-9', nome: 'Patrícia Alvarenga' } })]);
      render(<PipelineListaPage />);
      await screen.findByRole('table');
      await screen.findByRole('option', { name: 'Carlos Mendes' });

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Responsável'), 'Carlos Mendes');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('responsavelId')).toBe('resp-1');
      });
    });

    test('escolher uma origem (dos valores já existentes) filtra por ela @spec:AC-396', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');
      await screen.findByRole('option', { name: 'Google Ads' });

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Origem'), 'Google Ads');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('origem')).toBe('Google Ads');
      });
    });

    test('escolher "Valor (maior primeiro)" ordena por valor decrescente no servidor @spec:AC-396', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const usuario = userEvent.setup();
      await usuario.selectOptions(screen.getByLabelText('Ordenar por'), 'Valor (maior primeiro)');

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('ordenarPor')).toBe('valor');
        expect(query.get('ordem')).toBe('desc');
      });
    });

    test('"Limpar" volta a buscar sem nenhum filtro @spec:AC-396', async () => {
      render(<PipelineListaPage />);
      await screen.findByRole('table');

      const usuario = userEvent.setup();
      await usuario.type(screen.getByLabelText('Buscar'), 'texto');
      await waitFor(() => expect(ultimaQueryDe('/api/oportunidades/lista', true).get('busca')).toBe('texto'));

      await usuario.click(screen.getByRole('button', { name: 'Limpar' }));

      await waitFor(() => {
        const query = ultimaQueryDe('/api/oportunidades/lista', true);
        expect(query.get('busca')).toBeNull();
      });
    });
  });

  describe('AC-399: cada linha leva ao card e a seleção marca linhas', () => {
    test('o nome do lead leva a /pipeline/[id] @spec:AC-399', async () => {
      configurarLista([item({ id: 'op-abc', lead: { id: 'l1', nome: 'Clínica Beta', email: null, telefoneE164: null } })]);

      render(<PipelineListaPage />);

      const link = await screen.findByRole('link', { name: 'Clínica Beta' });
      expect(link.getAttribute('href')).toBe('/pipeline/op-abc');
    });

    test('marcar a linha mostra "1 selecionados" na barra, com as ações em lote "em breve" @spec:AC-399', async () => {
      configurarLista([item({ lead: { id: 'l1', nome: 'Clínica Gama', email: null, telefoneE164: null } })]);
      render(<PipelineListaPage />);
      await screen.findByText('Clínica Gama');

      expect(screen.queryByText(/selecionados/)).toBeNull();

      const usuario = userEvent.setup();
      await usuario.click(screen.getByLabelText('Selecionar Clínica Gama'));

      expect(screen.getByText('1 selecionados')).toBeTruthy();
      const acao = screen.getByRole('button', { name: 'Mover Etapa em Lote (em breve)' });
      expect(acao.getAttribute('aria-disabled')).toBe('true');
    });

    test('marcar o cabeçalho seleciona todas as linhas da página @spec:AC-399', async () => {
      configurarLista([
        item({ lead: { id: 'l1', nome: 'Clínica Um', email: null, telefoneE164: null } }),
        item({ lead: { id: 'l2', nome: 'Clínica Dois', email: null, telefoneE164: null } }),
      ]);
      render(<PipelineListaPage />);
      await screen.findByText('Clínica Um');
      await screen.findByText('Clínica Dois');

      const usuario = userEvent.setup();
      await usuario.click(screen.getByLabelText('Selecionar todos'));

      expect(screen.getByText('2 selecionados')).toBeTruthy();
      expect((screen.getByLabelText('Selecionar Clínica Um') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('Selecionar Clínica Dois') as HTMLInputElement).checked).toBe(true);

      await usuario.click(screen.getByLabelText('Selecionar todos'));
      expect(screen.queryByText(/selecionados/)).toBeNull();
    });
  });
});
