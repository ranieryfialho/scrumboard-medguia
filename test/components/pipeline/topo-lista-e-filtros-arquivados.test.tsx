// @vitest-environment jsdom
//
// Testes de T-167 (fase4-pipeline-telas): o topo da lista (AC-417) e a barra
// de filtros dos arquivados (AC-418). `next/navigation` mockado e fetch falso,
// mesmo molde de test/components/pipeline/lista.test.tsx.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsIniciais = new URLSearchParams();
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => paramsIniciais,
}));

import PipelineListaPage from '../../../src/app/(app)/pipeline/lista/page';
import PipelineArquivadosPage from '../../../src/app/(app)/pipeline/arquivados/page';

const INDICADORES_FUNIL = {
  cardsAtivos: { quantidade: 20, valorTotal: '18500.00' },
  toquesEmAtraso: 23,
  propostasAtivas: 1,
  conversao30Dias: { valor: 0.5 },
};

const INDICADORES_ARQUIVADOS = {
  valorGanho: '40000.00',
  negociosFechados: 3,
  conversaoFinal: { valor: 0.5 },
  perdas: { quantidade: 1, taxaPerda: { valor: 0.5 } },
  distribuicaoMotivos: [],
};

function itemLista(id: string, nome: string) {
  return {
    id,
    etapaId: 1,
    valor: '1000.00',
    proximaAcaoEm: null,
    lead: { id: `lead-${id}`, nome, email: null, telefoneE164: null, origem: 'Google Ads' },
    responsavel: { id: 'resp-1', nome: 'Carlos Mendes' },
  };
}

function itemArquivado(id: string, nome: string) {
  return {
    id,
    status: 'perdido' as const,
    valor: null,
    dataFechamento: '2026-10-20T10:00:00.000Z',
    lead: { id: `lead-${id}`, nome, email: null, telefoneE164: null },
    responsavel: { id: 'resp-9', nome: 'Karol Mendes' },
    motivoPerda: { id: 'mot-1', nome: 'Preço' },
  };
}

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let arquivadosVazios = false;

function urlsChamadas(trecho: string): URL[] {
  return fetchFalso.mock.calls
    .map((chamada) => new URL(chamada[0] as string, 'http://localhost'))
    .filter((u) => u.pathname.includes(trecho));
}

beforeEach(() => {
  paramsIniciais = new URLSearchParams();
  routerReplace.mockClear();
  arquivadosVazios = false;

  fetchFalso = vi.fn((url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/pipeline/indicadores') {
      return resposta(200, u.searchParams.get('visao') === 'arquivados' ? INDICADORES_ARQUIVADOS : INDICADORES_FUNIL);
    }
    if (u.pathname === '/api/oportunidades/lista') {
      const itens = [itemLista('op-1', 'Clínica Alfa')];
      return resposta(200, { itens, total: 20, pagina: 1, porPagina: 10 });
    }
    if (u.pathname === '/api/oportunidades/arquivados') {
      const algumFiltro = ['busca', 'motivoPerdaId', 'responsavelId', 'de'].some((chave) => u.searchParams.has(chave));
      const itens = arquivadosVazios && algumFiltro ? [] : [itemArquivado('arq-1', 'Clínica Beta')];
      return resposta(200, { itens, total: itens.length, pagina: 1, porPagina: 10 });
    }
    if (u.pathname === '/api/motivos-perda') return resposta(200, { itens: [{ id: 'mot-1', nome: 'Preço' }] });
    if (u.pathname === '/api/me') return resposta(200, { papel: 'MASTER', isSuperAdmin: false });
    if (u.pathname === '/api/oportunidades' && init?.method === 'POST') {
      return resposta(201, { id: 'novo-1', version: 1 });
    }
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = fetchOriginal;
});

describe('T-167: topo da lista e filtros dos arquivados', () => {
  describe('AC-417: o topo da lista traz o total, os indicadores, o atalho para o funil e o "Novo Card"', () => {
    test('mostra o total de leads com o valor somado e os quatro cartões de indicadores @spec:AC-417', async () => {
      render(<PipelineListaPage />);

      expect(await screen.findByText('20 leads')).toBeTruthy();
      // O valor aparece no total do topo e na legenda do cartão "Cards Ativos".
      expect(screen.getAllByText(/18\.500,00/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Cards Ativos')).toBeTruthy();
      expect(screen.getByText('Toques em Atraso')).toBeTruthy();
      expect(screen.getByText('Propostas Ativas')).toBeTruthy();
      expect(screen.getByText('Taxa de Conversão')).toBeTruthy();
    });

    test('"Exportar CSV" aparece para MASTER/GERENTE (AC-455) e "Alternar para Funil Kanban" leva a /pipeline @spec:AC-417', async () => {
      render(<PipelineListaPage />);

      await screen.findByText('20 leads');
      expect(await screen.findByRole('button', { name: 'Exportar CSV' })).toBeTruthy();
      expect(screen.queryByText('Exportar CSV/XLS')).toBeNull();

      const alternar = screen.getByRole('link', { name: /Alternar para Funil Kanban/ });
      expect(alternar.getAttribute('href')).toBe('/pipeline');
    });

    test('"Novo Card" abre o modal "Novo Lead" e, ao salvar, cria o card e recarrega a tabela @spec:AC-417', async () => {
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);
      await screen.findByText('20 leads');
      const listasAntes = urlsChamadas('/api/oportunidades/lista').filter((u) => u.searchParams.has('pagina')).length;

      await usuario.click(screen.getByRole('button', { name: /Novo Card/ }));
      expect(await screen.findByText('Novo Lead no Pipeline')).toBeTruthy();

      await usuario.type(screen.getByLabelText('Nome da Clínica / Médico *'), 'Clínica Vitae');
      await usuario.type(screen.getByLabelText('WhatsApp / Telefone *'), '11988887777');
      await usuario.selectOptions(screen.getByLabelText('Origem do Lead *'), 'Outro');
      await usuario.type(screen.getByLabelText('Qual origem?'), 'Indicação');
      await usuario.click(screen.getByRole('button', { name: 'Criar Card na Entrada' }));

      await waitFor(() => {
        const posts = fetchFalso.mock.calls.filter(
          (chamada) => new URL(chamada[0] as string, 'http://localhost').pathname === '/api/oportunidades' && chamada[1]?.method === 'POST'
        );
        expect(posts).toHaveLength(1);
        expect(JSON.parse(posts[0][1].body as string).novoLead.nome).toBe('Clínica Vitae');
      });
      await waitFor(() => {
        const listasDepois = urlsChamadas('/api/oportunidades/lista').filter((u) => u.searchParams.has('pagina')).length;
        expect(listasDepois).toBeGreaterThan(listasAntes);
      });
    });
  });

  describe('AC-822: a lista filtra por período e escolhe a data', () => {
    test('o período e a data escolhida viram parâmetros do pedido, e a lista volta à página 1 @spec:AC-822', async () => {
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);
      await screen.findByText('20 leads');

      await usuario.click(screen.getByRole('button', { name: /^Período/ }));
      await usuario.selectOptions(screen.getByLabelText('Data do período'), 'movimentacao'); // o painel fecha ao aplicar: a data se escolhe antes
      await usuario.click(screen.getByRole('button', { name: 'Personalizado' }));
      fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-02-28' } });
      await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        const ultimas = urlsChamadas('/api/oportunidades/lista').filter((u) => u.searchParams.get('data') === 'movimentacao');
        const ultima = ultimas[ultimas.length - 1];
        expect(ultima.searchParams.get('de')).toBe('2026-02-01');
        expect(ultima.searchParams.get('ate')).toBe('2026-02-28');
        expect(ultima.searchParams.get('pagina')).toBe('1');
      });
    });
  });

  describe('AC-418: a tela de arquivados oferece os filtros que a API já aplica', () => {
    test('busca, motivo, consultor e data viram parâmetros do pedido ao servidor e voltam à página 1 @spec:AC-418', async () => {
      const usuario = userEvent.setup();
      render(<PipelineArquivadosPage />);
      await screen.findByText('Clínica Beta');

      await usuario.type(screen.getByLabelText('Buscar nos arquivados'), 'Beta');
      await usuario.selectOptions(screen.getByLabelText('Motivo de perda'), 'mot-1');
      await usuario.selectOptions(screen.getByLabelText('Consultor'), 'resp-9');
      // AC-823: o antigo "Fechados desde" virou o período completo (De/Até + qual data).
      await usuario.click(screen.getByRole('button', { name: /^Período/ }));
      await usuario.click(screen.getByRole('button', { name: 'Personalizado' }));
      fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-31' } });
      await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));

      await waitFor(() => {
        const ultimas = urlsChamadas('/api/oportunidades/arquivados').filter((u) => u.searchParams.has('busca'));
        const ultima = ultimas[ultimas.length - 1];
        expect(ultima.searchParams.get('busca')).toBe('Beta');
        expect(ultima.searchParams.get('motivoPerdaId')).toBe('mot-1');
        expect(ultima.searchParams.get('responsavelId')).toBe('resp-9');
        expect(ultima.searchParams.get('de')).toBe('2026-10-01');
        expect(ultima.searchParams.get('ate')).toBe('2026-10-31');
        expect(ultima.searchParams.get('data')).toBe('entrada');
        expect(ultima.searchParams.get('pagina')).toBe('1');
      });
    });

    test('sem resultado mostra "Nenhum card arquivado com estes filtros" e "Limpar" devolve a lista completa @spec:AC-418', async () => {
      arquivadosVazios = true;
      const usuario = userEvent.setup();
      render(<PipelineArquivadosPage />);
      await screen.findByText('Clínica Beta');

      await usuario.type(screen.getByLabelText('Buscar nos arquivados'), 'xyz');
      expect(await screen.findByText('Nenhum card arquivado com estes filtros')).toBeTruthy();

      await usuario.click(screen.getByRole('button', { name: /Limpar/ }));
      expect(await screen.findByText('Clínica Beta')).toBeTruthy();
      expect((screen.getByLabelText('Buscar nos arquivados') as HTMLInputElement).value).toBe('');
    });
  });
});
