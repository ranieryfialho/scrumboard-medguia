// T-216 (fase4-admin, US-140): a tela de empresas da rede (src/components/admin/empresas.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Empresas } from '../../../src/components/admin/empresas';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const E = (n: number, nome: string, slug: string, ativo = true) => ({ id: `e-${n}`, nome, slug, ativo, criadoEm: '2026-01-12T12:00:00.000Z', usuariosAtivos: 24 - n, usuariosTotal: 32 - n });

describe('T-216: Empresas', () => {
  const fetchOriginal = globalThis.fetch;
  const locationOriginal = window.location;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let todas: ReturnType<typeof E>[];
  let listaStatus: number;
  let trocaResposta: () => Promise<unknown>;
  let recarregar: ReturnType<typeof vi.fn>;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/admin/empresas?'));

  beforeEach(() => {
    listaStatus = 200;
    trocaResposta = () => resposta(200, { ok: true });
    todas = [E(1, 'Clínica São Lucas', 'saolucas'), E(2, 'DermaCare Centro Estético', 'dermacare'), E(3, 'Instituto Antigo', 'antigo', false)];
    recarregar = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...locationOriginal, reload: recarregar }, configurable: true });
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/admin/empresas?')) {
        if (listaStatus !== 200) return resposta(listaStatus, {});
        const p = new URL(url, 'http://x').searchParams;
        let itens = todas;
        if (p.get('status')) itens = itens.filter((e) => (p.get('status') === 'ativa') === e.ativo);
        if (p.get('busca')) itens = itens.filter((e) => e.nome.toLowerCase().includes(p.get('busca')!.toLowerCase()) || e.slug.includes(p.get('busca')!));
        return resposta(200, { empresas: itens, resumo: { total: 3, ativas: 2, inativas: 1, usuariosAtivos: 60 } });
      }
      if (url === '/api/me') return resposta(200, { empresaAtiva: { id: 'e-1', nome: 'Clínica São Lucas' }, isSuperAdmin: true });
      if (url === '/api/empresa-ativa' && init?.method === 'POST') return trocaResposta();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', { value: locationOriginal, configurable: true });
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup();

  test('abre com o título dentro do grupo (app) e o atalho para a nova empresa @spec:AC-598', async () => {
    render(<Empresas />);
    expect(await screen.findByRole('heading', { name: 'Rede de Organizações & Franquias' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Nova Empresa \/ Clínica/ }).getAttribute('href')).toBe('/admin/empresas/nova');
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/admin/empresas/page.tsx'))).toBe(true);
  });

  test('os cartões e a lista mostram o que existe, com "Atual", usuários e atalhos, sem CNPJ nem plano @spec:AC-600', async () => {
    const u = usuario();
    render(<Empresas />);
    const lista = await screen.findByRole('region', { name: 'Organizações Cadastradas' });
    expect(screen.getByText('Empresas na rede')).toBeTruthy();
    expect(screen.getByText('2 ativas · 1 inativas')).toBeTruthy();
    expect(screen.getByText('60')).toBeTruthy();
    const linhas = within(lista).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0]).getByText('Clínica São Lucas')).toBeTruthy();
    expect(within(linhas[0]).getByText('Atual')).toBeTruthy();
    expect(within(linhas[0]).getByText('tenant: saolucas')).toBeTruthy();
    expect(within(linhas[0]).getByText('Ativa')).toBeTruthy();
    expect(within(linhas[0]).getByText('23 ativos / 31')).toBeTruthy();
    expect(within(linhas[0]).getByText('12/01/2026')).toBeTruthy();
    expect(within(linhas[2]).getByText('Inativa')).toBeTruthy();
    expect(within(linhas[1]).getByRole('link', { name: 'Abrir DermaCare Centro Estético' }).getAttribute('href')).toBe('/admin/empresas/e-2');
    expect(lista.textContent).not.toMatch(/CNPJ|Enterprise|Starter|Pipeline/);

    await u.selectOptions(screen.getByLabelText('Situação'), 'inativa');
    await waitFor(() => expect(urls().at(-1)).toBe('/api/admin/empresas?status=inativa'));
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    await u.type(screen.getByLabelText('Buscar por nome ou identificador'), 'dermacare');
    await waitFor(() => expect(urls().at(-1)).toMatch(/busca=dermacare/));
    await u.clear(screen.getByLabelText('Buscar por nome ou identificador'));
    await u.type(screen.getByLabelText('Buscar por nome ou identificador'), 'zzz');
    expect(await screen.findByText('Nenhuma empresa encontrada')).toBeTruthy();
  });

  test('"Acessar" troca a empresa ativa pela rota existente; na atual fica desabilitado e a recusa aparece @spec:AC-601', async () => {
    const u = usuario();
    render(<Empresas />);
    await screen.findByRole('region', { name: 'Organizações Cadastradas' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Acessar Clínica São Lucas' }) as HTMLButtonElement).disabled).toBe(true));
    await u.click(screen.getByRole('button', { name: 'Acessar DermaCare Centro Estético' }));
    await waitFor(() => expect(recarregar).toHaveBeenCalled());
    const troca = fetchFalso.mock.calls.find((c) => c[0] === '/api/empresa-ativa')!;
    expect(JSON.parse(troca[1].body)).toEqual({ empresaId: 'e-2' });

    recarregar.mockClear();
    trocaResposta = () => resposta(403, { codigo: 'SEM_PERMISSAO' });
    await u.selectOptions(screen.getByLabelText('Empresa ativa'), 'e-3');
    await u.click(screen.getAllByRole('button', { name: 'Acessar' })[0]);
    expect((await screen.findByRole('alert')).textContent).toBe('Você não tem permissão para esta ação.');
    expect(recarregar).not.toHaveBeenCalled();
  });

  test('exportar e planos ficam "em breve" e os blocos informativos do protótipo não existem @spec:AC-602', async () => {
    render(<Empresas />);
    await screen.findByRole('region', { name: 'Organizações Cadastradas' });
    for (const rotulo of ['Exportar Base (CSV)', 'Todos os Planos']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Segregação Lógica|Webhooks & Evolution|Conformidade LGPD|Row-Level Security/i)).toBeFalsy();
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-614', async () => {
    render(<Empresas />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Organizações Cadastradas' });
    cleanup();

    listaStatus = 500;
    render(<Empresas />);
    expect(await screen.findByText(/Não foi possível carregar as empresas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
