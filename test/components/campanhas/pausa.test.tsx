// T-269 (fase5-email-disparo, US-172/US-173): as telas de campanha com pausa, o motivo de cada falha e o aviso de chave.
// Cobre AC-712 (detalhe e lista) e a parte de tela do AC-713.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DetalheCampanha } from '../../../src/components/campanhas/detalhe-campanha';
import { ListaCampanhas } from '../../../src/components/campanhas/lista-campanhas';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const D = (n: number, status: string, erro: string | null = null) => ({ id: `d-${n}`, nome: `Pessoa ${n}`, email: `pessoa${n}@clinica.com`, status, tentativas: status === 'ERRO' ? 1 : 0, enviadoEm: null, erro });

function detalhe(status: string, destinatarios: ReturnType<typeof D>[]) {
  const contagemPorStatus: Record<string, number> = {};
  for (const d of destinatarios) contagemPorStatus[d.status] = (contagemPorStatus[d.status] ?? 0) + 1;
  return { campanha: { id: 'camp-1', nome: 'Campanha de teste', assunto: 'Assunto', corpoHtml: '<p>Oi</p>', status, criadoEm: '2026-10-24T12:30:00.000Z', criadoPorNome: null }, destinatarios, contagemPorStatus };
}

describe('T-269: telas de campanha com pausa e motivo da falha', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let atual: ReturnType<typeof detalhe>;
  let acao: () => Promise<unknown>;
  const chamadas = (caminho: string) => fetchFalso.mock.calls.filter((c) => c[0] === `/api/campanhas/camp-1${caminho}` && c[1]?.method === 'POST');

  beforeEach(() => {
    atual = detalhe('PROCESSANDO', [D(1, 'PENDENTE'), D(2, 'ENVIADO')]);
    acao = () => resposta(200, {});
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url === '/api/campanhas/camp-1' && !init?.method) return resposta(200, atual);
      if (url.startsWith('/api/campanhas/camp-1') && init?.method) return acao();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('em andamento mostra "Pausar" e pausar chama a rota; pausada mostra "Retomar" e o selo "Pausada" @spec:AC-712', async () => {
    const usuario = userEvent.setup();
    render(<DetalheCampanha id="camp-1" />);
    const pausar = await screen.findByRole('button', { name: 'Pausar' });
    expect(screen.queryByRole('button', { name: 'Retomar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();

    atual = detalhe('PAUSADA', [D(1, 'PAUSADO'), D(2, 'ENVIADO')]);
    await usuario.click(pausar);
    expect(chamadas('/pausar')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Retomar' })).toBeTruthy();
    expect(screen.getByText('Pausada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull(); // a pausada também não é excluída

    atual = detalhe('PROCESSANDO', [D(1, 'PENDENTE'), D(2, 'ENVIADO')]);
    await usuario.click(screen.getByRole('button', { name: 'Retomar' }));
    expect(chamadas('/retomar')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Pausar' })).toBeTruthy();
  });

  test('os contadores incluem "Pausados" e "Descadastrados" e "Reenviar falhas" some na pausada @spec:AC-712', async () => {
    atual = detalhe('PAUSADA', [D(1, 'PAUSADO'), D(2, 'PAUSADO'), D(3, 'DESCADASTRADO'), D(4, 'ERRO', 'RESEND_RECUSOU'), D(5, 'ENVIADO')]);
    render(<DetalheCampanha id="camp-1" />);
    expect(await screen.findByText('2 pausados')).toBeTruthy();
    expect(screen.getByText('1 descadastrados')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reenviar Falhas/i })).toBeNull();
  });

  test('cada falha mostra o motivo em português; sem chave leva ao atalho de configuração @spec:AC-712', async () => {
    atual = detalhe('FINALIZADA', [D(1, 'ERRO', 'SEM_CHAVE_RESEND'), D(2, 'ERRO', 'RESEND_RECUSOU'), D(3, 'ERRO', 'FALHA_DE_REDE'), D(4, 'ERRO', 'INTERROMPIDO')]);
    render(<DetalheCampanha id="camp-1" />);
    const semChave = (await screen.findByText(/Chave do Resend não configurada/)).closest('p') as HTMLElement;
    expect(within(semChave).getByRole('link', { name: 'Configurar' }).getAttribute('href')).toBe('/configuracoes/email');
    expect(screen.getByText(/O Resend recusou o envio para este e-mail/)).toBeTruthy();
    expect(screen.getByText(/Falha de conexão com o Resend/)).toBeTruthy();
    expect(screen.getByText(/O envio foi interrompido; confira antes de reenviar/)).toBeTruthy();
  });

  test('a lista mostra o selo "Pausada" e não oferece excluir a pausada @spec:AC-712', async () => {
    const C = (n: number, status: string, extra: Record<string, number> = {}) => ({
      id: `c-${n}`, nome: `Campanha ${n}`, assunto: `Assunto ${n}`, status, totalDestinatarios: 3, criadoEm: '2026-10-20T15:00:00.000Z',
      contagens: { rascunho: 0, pendente: 0, enviado: 1, aberto: 0, clicado: 0, erro: 0, enviando: 0, pausado: 0, descadastrado: 0, ...extra },
    });
    globalThis.fetch = vi.fn((url: string) =>
      url.startsWith('/api/campanhas?')
        ? resposta(200, { campanhas: [C(1, 'PAUSADA', { pausado: 2 }), C(2, 'FINALIZADA')], total: 2, resumo: { disparosNoMes: 1, taxaEntrega: 100, taxaAbertura: 0, taxaCliques: 0 } })
        : resposta(404, {})
    ) as unknown as typeof fetch;
    render(<ListaCampanhas />);
    expect(await screen.findByText('Campanha 1')).toBeTruthy();
    expect(screen.getByText('Pausada')).toBeTruthy();
    expect(screen.getByText('pausados: 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir Campanha 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Excluir Campanha 2' })).toBeTruthy();
  });

  test('iniciar sem a chave do Resend avisa que a empresa ainda não tem a chave e leva ao atalho @spec:AC-713', async () => {
    atual = detalhe('RASCUNHO', [D(1, 'RASCUNHO')]);
    acao = () => resposta(409, { codigo: 'CHAVE_RESEND_NAO_CONFIGURADA' });
    const usuario = userEvent.setup();
    render(<DetalheCampanha id="camp-1" />);
    await usuario.click(await screen.findByRole('button', { name: 'Iniciar Disparo' }));
    await usuario.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Iniciar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('A empresa ainda não tem a chave do Resend');
    await waitFor(() => expect(within(alerta).getByRole('link', { name: 'Configurar a chave' }).getAttribute('href')).toBe('/configuracoes/email'));
  });
});
