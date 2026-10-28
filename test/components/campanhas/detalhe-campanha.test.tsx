// T-199 (fase4-campanhas, US-131): o detalhe da campanha
// (src/components/campanhas/detalhe-campanha.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const empurrar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: empurrar }) }));

import { DetalheCampanha } from '../../../src/components/campanhas/detalhe-campanha';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const D = (n: number, status: string, tentativas = 1) => ({
  id: `d-${n}`,
  nome: `Pessoa ${String(n).padStart(2, '0')}`,
  email: `pessoa${n}@clinica.com`,
  status,
  tentativas,
  enviadoEm: status === 'PENDENTE' || status === 'RASCUNHO' || status === 'ERRO' ? null : '2026-10-24T12:30:00.000Z',
});

function detalhe(status: string, destinatarios: ReturnType<typeof D>[]) {
  const contagemPorStatus: Record<string, number> = {};
  for (const d of destinatarios) contagemPorStatus[d.status] = (contagemPorStatus[d.status] ?? 0) + 1;
  return {
    campanha: { id: 'camp-1', nome: 'Apresentação MedCRM', assunto: 'Nova inteligência', corpoHtml: '<p>Olá <b>médico</b></p><script>x()</script>', status, criadoEm: '2026-10-24T12:30:00.000Z', criadoPorNome: 'Dr. Roberto Mendes' },
    destinatarios,
    contagemPorStatus,
  };
}

describe('T-199: DetalheCampanha', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let atual: ReturnType<typeof detalhe>;
  let codigoDaLeitura: number;
  let acao: () => Promise<unknown>;

  const chamadas = (metodo: string) => fetchFalso.mock.calls.filter((c) => c[1]?.method === metodo);
  const leituras = () => fetchFalso.mock.calls.filter((c) => c[0] === '/api/campanhas/camp-1' && !c[1]?.method).length;

  beforeEach(() => {
    empurrar.mockReset();
    atual = detalhe('PROCESSANDO', [D(1, 'CLICADO'), D(2, 'ABERTO'), D(3, 'ENVIADO'), D(4, 'ENVIADO'), D(5, 'ERRO', 2), D(6, 'PENDENTE', 0), D(7, 'PENDENTE', 0)]);
    codigoDaLeitura = 200;
    acao = () => resposta(200, {});
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url === '/api/campanhas/camp-1' && !init?.method) return codigoDaLeitura === 200 ? resposta(200, atual) : resposta(codigoDaLeitura, {});
      if (url.startsWith('/api/campanhas/camp-1') && init?.method) return acao();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  test('mostra nome, assunto, status, criada em e criada por, e o voltar @spec:AC-547', async () => {
    render(<DetalheCampanha id="camp-1" />);
    expect(await screen.findByRole('heading', { name: 'Apresentação MedCRM' })).toBeTruthy();
    expect(screen.getByText('Assunto: Nova inteligência')).toBeTruthy();
    expect(screen.getByText('Enviando')).toBeTruthy();
    expect(screen.getByText(/Criada em 24\/10\/2026 · Criada por Dr\. Roberto Mendes · 7 destinatários/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('/campanhas');
    cleanup();

    codigoDaLeitura = 404;
    render(<DetalheCampanha id="camp-1" />);
    expect(await screen.findByText('Campanha não encontrada')).toBeTruthy();
  });

  test('a barra e os cartões vêm das contagens, sem benchmark nem bounce @spec:AC-548', async () => {
    render(<DetalheCampanha id="camp-1" />);
    const barra = await screen.findByRole('region', { name: 'Progresso do envio' });
    // enviados = 4 (clicado, aberto, 2 enviados); falhas 1; na fila 2; total 7 → 5/7 = 71%
    expect(within(barra).getByText('71% concluído')).toBeTruthy();
    expect(within(barra).getByText('4 enviados')).toBeTruthy();
    expect(within(barra).getByText('2 na fila')).toBeTruthy();
    expect(within(barra).getByText('1 falhas')).toBeTruthy();
    expect(screen.getByText('Volume total de disparo')).toBeTruthy();
    expect(screen.getByText('80,0%')).toBeTruthy(); // entrega 4/(4+1)
    expect(screen.getByText('50,0%')).toBeTruthy(); // abertura (1+1)/4
    expect(screen.getByText('25,0%')).toBeTruthy(); // cliques 1/4
    expect(screen.getByText('2 abriram')).toBeTruthy();
    expect(screen.getByText('1 cliques únicos')).toBeTruthy();
    expect(screen.queryByText(/bench|bounce|Mediana|conversas diretas/i)).toBeFalsy();
  });

  test('Play pede confirmação e chama iniciar; em envio fica desabilitado; reenviar falhas chama a rota e relê @spec:AC-549', async () => {
    const u = userEvent.setup();
    atual = detalhe('RASCUNHO', [D(1, 'RASCUNHO', 0), D(2, 'RASCUNHO', 0)]);
    render(<DetalheCampanha id="camp-1" />);
    await u.click(await screen.findByRole('button', { name: 'Iniciar Disparo' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/Os 2 destinatários entram na fila de envio agora/)).toBeTruthy();
    expect(chamadas('POST')).toHaveLength(0);

    acao = () => resposta(409, { codigo: 'CAMPANHA_JA_INICIADA' });
    await u.click(within(dialogo).getByRole('button', { name: 'Iniciar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Esta campanha já foi iniciada.');

    acao = () => resposta(200, { status: 'PROCESSANDO' });
    await u.click(screen.getByRole('button', { name: 'Iniciar Disparo' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Iniciar' }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(2));
    expect(chamadas('POST')[1][0]).toBe('/api/campanhas/camp-1/iniciar');
    expect(await screen.findByText(/Disparo iniciado/)).toBeTruthy();
    cleanup();

    atual = detalhe('PROCESSANDO', [D(1, 'ERRO'), D(2, 'ENVIADO')]);
    render(<DetalheCampanha id="camp-1" />);
    await screen.findByRole('heading', { name: 'Apresentação MedCRM' });
    expect((screen.getByRole('button', { name: 'Iniciar Disparo' }) as HTMLButtonElement).disabled).toBe(true);
    const antes = leituras();
    await u.click(screen.getByRole('button', { name: 'Reenviar Falhas (1)' }));
    await waitFor(() => expect(chamadas('POST').at(-1)![0]).toBe('/api/campanhas/camp-1/reenviar-falhas'));
    await waitFor(() => expect(leituras()).toBeGreaterThan(antes));
    await u.click(screen.getByRole('button', { name: 'Reenviar 1 Falha Agora' }));
    await waitFor(() => expect(chamadas('POST').filter((c) => String(c[0]).endsWith('/reenviar-falhas'))).toHaveLength(2));
  });

  test('a tabela filtra por status e busca, 20 por página, sem os campos que não existem @spec:AC-550', async () => {
    const u = userEvent.setup();
    atual = detalhe('FINALIZADA', [...Array.from({ length: 22 }, (_, i) => D(i + 1, 'ENVIADO')), D(23, 'CLICADO'), D(24, 'ABERTO'), D(25, 'ERRO')]);
    render(<DetalheCampanha id="camp-1" />);
    await screen.findByText('Pessoa 01');
    const grupo = screen.getByRole('group', { name: 'Filtro de destinatários' });
    expect(within(grupo).getByRole('button', { name: 'Todos (25)' })).toBeTruthy();
    expect(within(grupo).getByRole('button', { name: 'Abertos (2)' })).toBeTruthy();
    expect(within(grupo).getByRole('button', { name: 'Clicados (1)' })).toBeTruthy();
    expect(within(grupo).getByRole('button', { name: 'Enviados/Não abertos (22)' })).toBeTruthy();
    expect(within(grupo).getByRole('button', { name: 'Falhas (1)' })).toBeTruthy();
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(20);
    expect(screen.getByText(/Exibindo/).textContent).toMatch(/1 a 20 de 25 destinatários/);
    await u.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);

    await u.click(within(grupo).getByRole('button', { name: 'Falhas (1)' }));
    const linhas = screen.getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(1);
    expect(within(linhas[0]).getByText('Falha')).toBeTruthy();
    expect(within(linhas[0]).getByText('pessoa25@clinica.com')).toBeTruthy();
    await u.click(within(grupo).getByRole('button', { name: 'Todos (25)' }));
    await u.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'pessoa23@');
    expect(within(screen.getAllByRole('row')[1]).getByText('Clicou')).toBeTruthy();
    await u.clear(screen.getByLabelText('Buscar por nome ou e-mail'));
    await u.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'zzz');
    expect(await screen.findByText('Nenhum destinatário neste filtro')).toBeTruthy();
    expect(screen.queryByText(/Etapa funil|Último evento/i)).toBeFalsy();
  });

  test('editar leva ao rascunho, excluir pede confirmação e volta à lista, e a prévia isola o conteúdo @spec:AC-551', async () => {
    const u = userEvent.setup();
    atual = detalhe('RASCUNHO', [D(1, 'RASCUNHO', 0)]);
    render(<DetalheCampanha id="camp-1" />);
    expect((await screen.findByRole('link', { name: 'Editar' })).getAttribute('href')).toBe('/campanhas/nova?rascunho=camp-1');

    await u.click(screen.getByRole('tab', { name: 'Conteúdo Enviado (Prévia)' }));
    const quadro = screen.getByTitle('Prévia do e-mail');
    expect(quadro.getAttribute('sandbox')).toBe('');
    expect(quadro.getAttribute('srcdoc')).toContain('<b>médico</b>');

    await u.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/"Apresentação MedCRM"/)).toBeTruthy();
    expect(chamadas('DELETE')).toHaveLength(0);
    await u.click(within(dialogo).getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(empurrar).toHaveBeenCalledWith('/campanhas'));
    expect(chamadas('DELETE')[0][0]).toBe('/api/campanhas/camp-1');
    cleanup();

    atual = detalhe('PROCESSANDO', [D(1, 'ENVIADO')]);
    render(<DetalheCampanha id="camp-1" />);
    await screen.findByRole('heading', { name: 'Apresentação MedCRM' });
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeFalsy();
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeFalsy();
    for (const rotulo of ['Pausar Disparo', 'CSV', 'Mapa de Calor de Cliques e Links', 'Eventos em Linha do Tempo (Log)']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Desempenho dos Links|Impacto Direto no Funil/)).toBeFalsy();
  });

  test('relê a cada 15 s enquanto envia e para quando conclui @spec:AC-552', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<DetalheCampanha id="camp-1" />);
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Apresentação MedCRM' })).toBeTruthy());
    const antes = leituras();
    atual = detalhe('FINALIZADA', [D(1, 'ENVIADO'), D(2, 'ENVIADO')]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await vi.waitFor(() => expect(screen.getByText('Concluída')).toBeTruthy());
    expect(leituras()).toBeGreaterThan(antes);
    const depois = leituras();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(leituras()).toBe(depois);
  });

  test('carregando mostra esqueleto, sem destinatários mostra o vazio e falha mostra erro com "Tentar de novo" @spec:AC-554', async () => {
    render(<DetalheCampanha id="camp-1" />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('heading', { name: 'Apresentação MedCRM' });
    cleanup();

    atual = detalhe('RASCUNHO', []);
    render(<DetalheCampanha id="camp-1" />);
    expect(await screen.findByText('Nenhum destinatário')).toBeTruthy();
    cleanup();

    codigoDaLeitura = 500;
    render(<DetalheCampanha id="camp-1" />);
    expect(await screen.findByText(/Não foi possível carregar a campanha/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
