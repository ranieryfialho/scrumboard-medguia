// @vitest-environment jsdom
//
// Testes de T-180 (fase4-pipeline-lote, US-118): o botão "Exportar CSV" da lista
// e dos arquivados — pede o arquivo com os mesmos filtros da tela (sem a página),
// entrega como download, some para ATENDENTE e mostra o andamento e os motivos de
// recusa. Fetch falso; o arquivo em si tem prova nos testes do servidor (T-179).
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

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response);
}

function respostaDeArquivo(nome: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-disposition': `attachment; filename="${nome}"` }),
    blob: () => Promise.resolve(new Blob(['Lead;Etapa\r\n'], { type: 'text/csv' })),
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

const ITEM_LISTA = {
  id: 'c1',
  etapaId: 2,
  valor: '1000.00',
  proximaAcaoEm: null,
  lead: { id: 'l1', nome: 'Clínica Alfa', email: null, telefoneE164: null, origem: 'Google Ads' },
  responsavel: { id: 'r1', nome: 'Carlos Mendes' },
};

const ITEM_ARQUIVADO = {
  id: 'a1',
  status: 'perdido',
  valor: null,
  dataFechamento: '2026-10-20T10:00:00.000Z',
  lead: { id: 'l9', nome: 'Clínica Beta', email: null, telefoneE164: null },
  responsavel: { id: 'r1', nome: 'Carlos Mendes' },
  motivoPerda: { id: 'm1', nome: 'Preço' },
};

const fetchOriginal = globalThis.fetch;
let fetchFalso: ReturnType<typeof vi.fn>;
let papel: string;
let respostaDaExportacao: () => Promise<Response>;
const criarEndereco = vi.fn(() => 'blob:csv');
const revogarEndereco = vi.fn();
let downloads: string[];

function chamadasDeExportacao(tela: 'lista' | 'arquivados') {
  return fetchFalso.mock.calls
    .map(([url]) => new URL(url as string, 'http://localhost'))
    .filter((u) => u.pathname === `/api/oportunidades/${tela}/exportar`);
}

beforeEach(() => {
  paramsIniciais = new URLSearchParams();
  routerReplace.mockClear();
  papel = 'GERENTE';
  downloads = [];
  respostaDaExportacao = () => respostaDeArquivo('pipeline-lista-2026-10-27.csv');

  fetchFalso = vi.fn((url: string) => {
    const u = new URL(url, 'http://localhost');
    if (u.pathname === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
    if (u.pathname === '/api/oportunidades/lista') {
      return resposta(200, { itens: [ITEM_LISTA], total: 1, pagina: 1, porPagina: 10 });
    }
    if (u.pathname === '/api/oportunidades/arquivados') {
      return resposta(200, { itens: [ITEM_ARQUIVADO], total: 1, pagina: 1, porPagina: 10 });
    }
    if (u.pathname === '/api/pipeline/indicadores') return resposta(404, {});
    if (u.pathname === '/api/motivos-perda') return resposta(200, { itens: [{ id: 'm1', nome: 'Preço' }] });
    if (u.pathname.endsWith('/exportar')) return respostaDaExportacao();
    return resposta(404, { codigo: 'NAO_ENCONTRADO' });
  });
  globalThis.fetch = fetchFalso as unknown as typeof fetch;

  URL.createObjectURL = criarEndereco as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revogarEndereco;
  criarEndereco.mockClear();
  revogarEndereco.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = fetchOriginal;
});

describe('T-180: botão "Exportar CSV" da lista e dos arquivados', () => {
  describe('AC-455: exportar a lista baixa o arquivo com os filtros atuais', () => {
    test('pede a exportação com os filtros e a ordenação da tela, sem a página, e baixa com o nome do servidor @spec:AC-455', async () => {
      paramsIniciais = new URLSearchParams('busca=ana&origem=Google Ads&etapaId=2&ordenarPor=valor&ordem=asc&pagina=3&porPagina=25');
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);

      await usuario.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

      await waitFor(() => expect(chamadasDeExportacao('lista')).toHaveLength(1));
      const parametros = chamadasDeExportacao('lista')[0].searchParams;
      expect(parametros.get('busca')).toBe('ana');
      expect(parametros.get('origem')).toBe('Google Ads');
      expect(parametros.get('etapaId')).toBe('2');
      expect(parametros.get('ordenarPor')).toBe('valor');
      expect(parametros.get('ordem')).toBe('asc');
      expect(parametros.has('pagina')).toBe(false);
      expect(parametros.has('porPagina')).toBe(false);

      await waitFor(() => expect(downloads).toEqual(['pipeline-lista-2026-10-27.csv']));
      expect(criarEndereco).toHaveBeenCalledTimes(1);
      expect(revogarEndereco).toHaveBeenCalledWith('blob:csv');
    });
  });

  describe('AC-822: a exportação da lista leva o período escolhido', () => {
    test('a exportação traz de/ate/data iguais aos da tela @spec:AC-822', async () => {
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);
      await screen.findByRole('button', { name: 'Exportar CSV' });

      await usuario.click(screen.getByRole('button', { name: /^Período/ }));
      await usuario.click(screen.getByRole('button', { name: 'Personalizado' }));
      fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-02-01' } });
      fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-02-28' } });
      await usuario.click(screen.getByRole('button', { name: 'Aplicar' }));
      await usuario.selectOptions(screen.getByLabelText('Data do período'), 'movimentacao');

      await usuario.click(screen.getByRole('button', { name: 'Exportar CSV' }));
      await waitFor(() => expect(chamadasDeExportacao('lista')).toHaveLength(1));
      const parametros = chamadasDeExportacao('lista')[0].searchParams;
      expect(parametros.get('de')).toBe('2026-02-01');
      expect(parametros.get('ate')).toBe('2026-02-28');
      expect(parametros.get('data')).toBe('movimentacao');
    });
  });

  describe('AC-456: exportar os arquivados respeita a aba e os filtros', () => {
    test('manda a aba (tipo) e os filtros da tela, sem a página, e baixa o arquivo @spec:AC-456', async () => {
      respostaDaExportacao = () => respostaDeArquivo('pipeline-arquivados-2026-10-27.csv');
      paramsIniciais = new URLSearchParams('aba=perdidos&busca=beta&motivoPerdaId=m1&pagina=2');
      const usuario = userEvent.setup();
      render(<PipelineArquivadosPage />);

      await usuario.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

      await waitFor(() => expect(chamadasDeExportacao('arquivados')).toHaveLength(1));
      const parametros = chamadasDeExportacao('arquivados')[0].searchParams;
      expect(parametros.get('tipo')).toBe('perdido');
      expect(parametros.get('busca')).toBe('beta');
      expect(parametros.get('motivoPerdaId')).toBe('m1');
      expect(parametros.has('pagina')).toBe(false);
      expect(parametros.has('porPagina')).toBe(false);

      await waitFor(() => expect(downloads).toEqual(['pipeline-arquivados-2026-10-27.csv']));
    });
  });

  describe('AC-457: só MASTER e GERENTE exportam', () => {
    test('ATENDENTE não vê o botão nas duas telas, e MASTER vê @spec:AC-457', async () => {
      papel = 'ATENDENTE';
      render(<PipelineListaPage />);
      await screen.findByText('Clínica Alfa');
      await waitFor(() => expect(fetchFalso.mock.calls.some(([url]) => url === '/api/me')).toBe(true));
      expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
      cleanup();

      render(<PipelineArquivadosPage />);
      await screen.findByText('Clínica Beta');
      await waitFor(() => expect(fetchFalso.mock.calls.filter(([url]) => url === '/api/me').length).toBeGreaterThan(1));
      expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
      cleanup();

      papel = 'MASTER';
      render(<PipelineListaPage />);
      expect(await screen.findByRole('button', { name: 'Exportar CSV' })).toBeTruthy();
    });
  });

  describe('AC-460: a tela mostra o andamento da exportação e o erro', () => {
    test('enquanto baixa, mostra "Gerando..." com o botão desabilitado, e depois volta ao normal @spec:AC-460', async () => {
      let liberar: () => void = () => undefined;
      respostaDaExportacao = () =>
        new Promise<Response>((resolver) => {
          liberar = () => resolver(respostaDeArquivo('pipeline-lista-2026-10-27.csv') as unknown as Response);
        }) as Promise<Response>;
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);

      await usuario.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

      const gerando = (await screen.findByRole('button', { name: 'Gerando...' })) as HTMLButtonElement;
      expect(gerando.disabled).toBe(true);

      liberar();
      expect(await screen.findByRole('button', { name: 'Exportar CSV' })).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Exportar CSV' }) as HTMLButtonElement).disabled).toBe(false);
    });

    test.each([
      [422, 'NADA_PARA_EXPORTAR', 'Nenhum card para exportar com estes filtros.'],
      [422, 'LIMITE_EXCEDIDO', 'Muitos cards para exportar: refine os filtros.'],
      [403, 'SEM_PERMISSAO', 'Você não tem permissão para exportar.'],
      [500, 'ERRO_QUALQUER', 'Não foi possível exportar. Tente de novo.'],
    ])('recusa %i %s mostra a mensagem, não baixa nada e o botão volta ao normal @spec:AC-460', async (status, codigo, mensagem) => {
      respostaDaExportacao = () => resposta(status, { codigo });
      const usuario = userEvent.setup();
      render(<PipelineListaPage />);

      await usuario.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

      expect((await screen.findByRole('alert')).textContent).toBe(mensagem);
      expect(downloads).toHaveLength(0);
      expect(criarEndereco).not.toHaveBeenCalled();
      expect((screen.getByRole('button', { name: 'Exportar CSV' }) as HTMLButtonElement).disabled).toBe(false);
    });

    test('o botão também trata falha de rede nos arquivados @spec:AC-460', async () => {
      respostaDaExportacao = () => Promise.reject(new Error('sem rede'));
      const usuario = userEvent.setup();
      render(<PipelineArquivadosPage />);

      await usuario.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

      expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível exportar. Tente de novo.');
      expect(downloads).toHaveLength(0);
    });
  });
});
