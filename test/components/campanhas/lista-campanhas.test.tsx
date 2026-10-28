// T-197 (fase4-campanhas, US-129): a lista de campanhas
// (src/components/campanhas/lista-campanhas.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ListaCampanhas } from '../../../src/components/campanhas/lista-campanhas';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const C = (n: number, status: string, contagens: Partial<Record<string, number>> = {}) => {
  const c = { rascunho: 0, pendente: 0, enviado: 0, aberto: 0, clicado: 0, erro: 0, ...contagens };
  return {
    id: `c-${n}`,
    nome: `Campanha ${n}`,
    assunto: `Assunto ${n}`,
    status,
    totalDestinatarios: Object.values(c).reduce((a, b) => a + b, 0),
    criadoEm: '2026-10-20T15:00:00.000Z',
    contagens: c,
  };
};

const RESUMO = { disparosNoMes: 28450, taxaEntrega: 99.1, taxaAbertura: 41.8, taxaCliques: 12.4 };

describe('T-197: ListaCampanhas', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let todas: ReturnType<typeof C>[];
  let listaStatus: number;
  let exclusao: () => Promise<unknown>;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/campanhas?'));

  beforeEach(() => {
    todas = [C(1, 'PROCESSANDO', { enviado: 3, aberto: 1, clicado: 1, pendente: 3, erro: 2 }), C(2, 'FINALIZADA', { enviado: 8, aberto: 2 }), C(3, 'RASCUNHO', { rascunho: 5 })];
    listaStatus = 200;
    exclusao = () => resposta(204, null);
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/campanhas?')) {
        if (listaStatus !== 200) return resposta(listaStatus, { codigo: 'SEM_PERMISSAO' });
        const p = new URL(url, 'http://x').searchParams;
        const mapa: Record<string, string> = { rascunho: 'RASCUNHO', enviando: 'PROCESSANDO', concluida: 'FINALIZADA' };
        let itens = todas;
        if (p.get('status')) itens = itens.filter((c) => c.status === mapa[p.get('status')!]);
        if (p.get('busca')) itens = itens.filter((c) => c.nome.toLowerCase().includes(p.get('busca')!.toLowerCase()));
        const pagina = Number(p.get('pagina'));
        const porPagina = Number(p.get('porPagina'));
        return resposta(200, { campanhas: itens.slice((pagina - 1) * porPagina, pagina * porPagina), total: itens.length, resumo: RESUMO });
      }
      if (init?.method === 'DELETE') return exclusao();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título dentro do grupo (app) e, para o atendente, avisa que é de gerente e master @spec:AC-532', async () => {
    render(<ListaCampanhas />);
    expect(await screen.findByRole('heading', { name: 'Campanhas de Comunicação & Mala Direta' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/campanhas/page.tsx'))).toBe(true);
    await screen.findByText('Campanha 1');
    cleanup();

    listaStatus = 403;
    render(<ListaCampanhas />);
    expect(await screen.findByText('Campanhas são para gerente e master')).toBeTruthy();
    expect(screen.queryByText('Campanha 1')).toBeFalsy();
  });

  test('a tabela mostra o andamento, as taxas e a data, sem código CMP nem segmentação @spec:AC-535', async () => {
    render(<ListaCampanhas />);
    const tabela = await screen.findByRole('region', { name: 'Campanhas' });
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(3);
    const enviando = linhas[0];
    expect(within(enviando).getByText('Enviando')).toBeTruthy();
    expect(within(enviando).getByText('5 / 10')).toBeTruthy();
    expect(within(enviando).getByText('na fila: 3')).toBeTruthy();
    expect(within(enviando).getByText('2 falhas')).toBeTruthy();
    expect(within(enviando).getByText(/% concluído/)).toBeTruthy();
    expect(within(enviando).getByText('40,0%')).toBeTruthy(); // abertura: (1+1)/5
    expect(within(enviando).getByText('20,0%')).toBeTruthy(); // cliques: 1/5
    expect(within(linhas[1]).getByText('Concluída')).toBeTruthy();
    expect(within(linhas[1]).getByText('20,0%')).toBeTruthy();
    expect(within(linhas[2]).getByText('Rascunho')).toBeTruthy();
    expect(within(linhas[2]).getByText('Não enviado')).toBeTruthy();
    expect(within(enviando).getByText('20/10/2026')).toBeTruthy();
    expect(screen.queryByText(/CMP-|Pausada/)).toBeFalsy();
    expect(screen.getByText('28.450')).toBeTruthy();
    expect(screen.getByText('99,1%')).toBeTruthy();
    expect(screen.getByText('41,8%')).toBeTruthy();
    expect(screen.getByText('12,4%')).toBeTruthy();
  });

  test('status, busca e período pedem só o recorte ao servidor; Limpar volta ao completo; sem resultado avisa @spec:AC-536', async () => {
    const u = userEvent.setup();
    render(<ListaCampanhas />);
    await screen.findByText('Campanha 1');
    expect(urls()[0]).toBe('/api/campanhas?pagina=1&porPagina=10');
    await u.selectOptions(screen.getByLabelText('Status'), 'rascunho');
    await waitFor(() => expect(urls().at(-1)).toMatch(/status=rascunho/));
    expect(await screen.findByText('Campanha 3')).toBeTruthy();
    expect(screen.queryByText('Campanha 1')).toBeFalsy();
    await u.selectOptions(screen.getByLabelText('Período'), '30');
    await waitFor(() => expect(urls().at(-1)).toMatch(/dias=30/));
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/campanhas?pagina=1&porPagina=10'));
    await u.type(screen.getByLabelText('Buscar por nome da campanha ou assunto'), 'zzz');
    expect(await screen.findByText('Nenhuma campanha encontrada')).toBeTruthy();
    expect(screen.queryByText(/Todos os Tipos/)).toBeFalsy();
  });

  test('a paginação mostra "Exibindo N a M de T campanhas" e troca a página @spec:AC-536', async () => {
    todas = Array.from({ length: 12 }, (_, i) => C(i + 1, 'FINALIZADA', { enviado: 2 }));
    const u = userEvent.setup();
    render(<ListaCampanhas />);
    await screen.findByText('Campanha 1');
    expect(screen.getByText(/Exibindo/).textContent).toMatch(/1 a 10 de 12 campanhas/);
    await u.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(urls().at(-1)).toMatch(/pagina=2/));
    expect(await screen.findByText('Campanha 11')).toBeTruthy();
  });

  test('abrir e criar levam às rotas certas; excluir pede confirmação, chama a API e relê; em envio não há excluir @spec:AC-537', async () => {
    const u = userEvent.setup();
    render(<ListaCampanhas />);
    await screen.findByText('Campanha 1');
    expect(screen.getByRole('link', { name: 'Campanha 2' }).getAttribute('href')).toBe('/campanhas/c-2');
    expect(screen.getByRole('link', { name: /Nova Campanha/ }).getAttribute('href')).toBe('/campanhas/nova');
    expect(screen.queryByRole('button', { name: 'Excluir Campanha 1' })).toBeFalsy();

    await u.click(screen.getByRole('button', { name: 'Excluir Campanha 3' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/"Campanha 3"/)).toBeTruthy();
    expect(fetchFalso.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);

    exclusao = () => resposta(409, { codigo: 'CAMPANHA_EM_ENVIO' });
    await u.click(within(dialogo).getByRole('button', { name: 'Excluir' }));
    expect((await within(dialogo).findByRole('alert')).textContent).toMatch(/está enviando/);

    exclusao = () => resposta(204, null);
    const antes = urls().length;
    await u.click(within(dialogo).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(fetchFalso.mock.calls.filter((c) => c[0] === '/api/campanhas/c-3' && c[1]?.method === 'DELETE')).toHaveLength(2));
    await waitFor(() => expect(urls().length).toBeGreaterThan(antes));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeFalsy());
  });

  test('relê a cada 15 s só com campanha enviando, e Exportar e Auditar aparecem "em breve" @spec:AC-538', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<ListaCampanhas />);
    await vi.waitFor(() => expect(screen.getByText('Campanha 1')).toBeTruthy());
    const antes = urls().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(urls().length).toBeGreaterThan(antes);
    for (const rotulo of ['Exportar Histórico (CSV)', 'Auditar Entregabilidade']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Governança de Entregabilidade|DKIM|DMARC/)).toBeFalsy();
    cleanup();

    todas = [C(2, 'FINALIZADA', { enviado: 2 })];
    render(<ListaCampanhas />);
    await vi.waitFor(() => expect(screen.getByText('Campanha 2')).toBeTruthy());
    const parado = urls().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(urls().length).toBe(parado);
  });

  test('carregando mostra esqueleto, sem campanhas mostra o vazio com o atalho e falha mostra erro com "Tentar de novo" @spec:AC-554', async () => {
    render(<ListaCampanhas />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByText('Campanha 1');
    cleanup();

    todas = [];
    render(<ListaCampanhas />);
    expect(await screen.findByText('Nenhuma campanha ainda')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Nova Campanha/ })).toBeTruthy();
    cleanup();

    listaStatus = 500;
    render(<ListaCampanhas />);
    expect(await screen.findByText(/Não foi possível carregar as campanhas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
