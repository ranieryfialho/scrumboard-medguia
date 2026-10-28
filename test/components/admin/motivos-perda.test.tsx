// T-215 (fase4-admin, US-139): a tela de motivos de perda (src/components/admin/motivos-perda.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MotivosPerda } from '../../../src/components/admin/motivos-perda';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const M = (n: number, nome: string, o: Partial<{ sistemico: boolean; ativo: boolean; mes: number; total: number; edita: boolean }> = {}) => ({
  id: `m-${n}`, nome, sistemico: o.sistemico ?? false, ativo: o.ativo ?? true, usadoNoMes: o.mes ?? 0, usadoTotal: o.total ?? 0, podeEditar: o.edita ?? false,
});

describe('T-215: MotivosPerda', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let eu: { isSuperAdmin: boolean; papel: string };
  let todos: ReturnType<typeof M>[];
  let listaStatus: number;
  let criarResposta: () => Promise<unknown>;
  let alterarResposta: () => Promise<unknown>;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/configuracoes/motivos-perda?'));
  const chamadas = (metodo: string) => fetchFalso.mock.calls.filter((c) => c[1]?.method === metodo);

  beforeEach(() => {
    eu = { isSuperAdmin: false, papel: 'MASTER' };
    listaStatus = 200;
    criarResposta = () => resposta(201, { id: 'novo' });
    alterarResposta = () => resposta(200, {});
    todos = [
      M(1, 'Decisão adiada', { sistemico: true, mes: 14, total: 89 }),
      M(2, 'Preço / orçamento', { sistemico: true, mes: 7, total: 42 }),
      M(3, 'Optou por software de nicho', { mes: 4, total: 19, edita: true }),
      M(4, 'Projeto suspenso', { ativo: false, total: 2, edita: true }),
    ];
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/configuracoes/motivos-perda?')) {
        if (listaStatus !== 200) return resposta(listaStatus, {});
        const p = new URL(url, 'http://x').searchParams;
        let itens = todos.map((m) => ({ ...m, podeEditar: eu.isSuperAdmin && !m.sistemico }));
        if (p.get('tipo')) itens = itens.filter((m) => (p.get('tipo') === 'sistemico') === m.sistemico);
        if (p.get('status')) itens = itens.filter((m) => (p.get('status') === 'ativo') === m.ativo);
        if (p.get('busca')) itens = itens.filter((m) => m.nome.toLowerCase().includes(p.get('busca')!.toLowerCase()));
        return resposta(200, {
          motivos: itens,
          totais: { total: 4, ativos: 3, sistemicos: 2, personalizados: 2 },
          resumo: { perdasNoMes: 25, principal: todos.length ? { nome: 'Decisão adiada', quantidade: 14, percentual: 56 } : null },
        });
      }
      if (url === '/api/me') return resposta(200, eu);
      if (url === '/api/configuracoes/motivos-perda' && init?.method === 'POST') return criarResposta();
      if (url.startsWith('/api/configuracoes/motivos-perda/') && init?.method === 'PATCH') return alterarResposta();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup();

  test('abre com o título dentro do grupo (app) e o aviso do requisito bloqueante @spec:AC-592', async () => {
    render(<MotivosPerda />);
    expect(await screen.findByRole('heading', { name: 'Motivos de Perda & Churn Comercial' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Requisito bloqueante' }).textContent).toMatch(/nenhum card passa para "Perdido" sem um motivo/);
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/configuracoes/motivos-perda/page.tsx'))).toBe(true);
    await screen.findByText('Decisão adiada', { selector: 'td' });
  });

  test('os cartões mostram o catálogo, as perdas do mês e o principal motivo, sem impacto nem conformidade @spec:AC-594', async () => {
    render(<MotivosPerda />);
    await screen.findByText('Catálogo de motivos');
    expect(screen.getByText('3 ativos')).toBeTruthy();
    expect(screen.getByText('2 sistêmicos · 2 personalizados')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
    expect(screen.getAllByText('Decisão adiada').length).toBeGreaterThan(0);
    expect(screen.getByText('56,0% do mês')).toBeTruthy();
    expect(screen.queryByText(/Impacto|vs set|Conformidade/i)).toBeFalsy();
  });

  test('a tabela mostra natureza, uso e situação; a busca, o tipo e a situação pedem o recorte; sem resultado avisa @spec:AC-595', async () => {
    const u = usuario();
    render(<MotivosPerda />);
    const tabela = await screen.findByRole('region', { name: 'Motivos' });
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(4);
    expect(within(linhas[0]).getByText('Sistêmico')).toBeTruthy();
    expect(within(linhas[0]).getByText('14 no mês')).toBeTruthy();
    expect(within(linhas[0]).getByText('Histórico: 89 cards')).toBeTruthy();
    expect(within(linhas[0]).getByText('Ativo')).toBeTruthy();
    expect(within(linhas[0]).queryByRole('button', { name: /Desativar|Ativar/ })).toBeFalsy(); // sistêmico: sem ações
    expect(within(linhas[2]).getByText('Personalizado')).toBeTruthy();
    expect(within(linhas[3]).getByText('Inativo')).toBeTruthy();
    expect(tabela.textContent).not.toMatch(/Top 1|Categoria|Governança Hospitalar/);

    await u.click(screen.getByRole('button', { name: 'Personalizados' }));
    await waitFor(() => expect(urls().at(-1)).toMatch(/tipo=personalizado/));
    await u.selectOptions(screen.getByLabelText('Situação'), 'inativo');
    await waitFor(() => expect(urls().at(-1)).toMatch(/tipo=personalizado&status=inativo/));
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/configuracoes/motivos-perda?'));
    await u.type(screen.getByLabelText('Buscar por nome do motivo'), 'zzz');
    expect(await screen.findByText('Nenhum motivo encontrado')).toBeTruthy();
  });

  test('só o super admin vê criar e (des)ativar, que chamam a API e relêem; o gerente só consulta @spec:AC-596', async () => {
    const u = usuario();
    render(<MotivosPerda />);
    await screen.findByRole('region', { name: 'Motivos' });
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/me')).toBe(true));
    expect(screen.queryByRole('button', { name: '+ Novo Motivo de Perda' })).toBeFalsy();
    expect(screen.queryByRole('button', { name: /^Desativar:/ })).toBeFalsy();
    cleanup();

    eu = { isSuperAdmin: true, papel: 'GERENTE' };
    render(<MotivosPerda />);
    await u.click(await screen.findByRole('button', { name: '+ Novo Motivo de Perda' }));
    const dialogo = await screen.findByRole('dialog');
    const criar = within(dialogo).getByRole('button', { name: 'Criar motivo' }) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);
    await u.type(within(dialogo).getByLabelText('Nome do motivo'), 'Motivo novo');
    criarResposta = () => resposta(409, { codigo: 'MOTIVO_JA_EXISTE' });
    await u.click(criar);
    expect((await within(dialogo).findByRole('alert')).textContent).toBe('Já existe um motivo com esse nome.');
    criarResposta = () => resposta(201, { id: 'novo' });
    const antes = urls().length;
    await u.click(criar);
    await waitFor(() => expect(chamadas('POST').length).toBe(2));
    expect(JSON.parse(chamadas('POST')[1][1].body)).toEqual({ nome: 'Motivo novo' });
    expect(await screen.findByText('Motivo criado.')).toBeTruthy();
    await waitFor(() => expect(urls().length).toBeGreaterThan(antes));

    await u.click(screen.getByRole('button', { name: 'Desativar: Optou por software de nicho' }));
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(1));
    expect(chamadas('PATCH')[0][0]).toBe('/api/configuracoes/motivos-perda/m-3');
    expect(JSON.parse(chamadas('PATCH')[0][1].body)).toEqual({ ativo: false });
    await u.click(screen.getByRole('button', { name: 'Ativar: Projeto suspenso' }));
    await waitFor(() => expect(JSON.parse(chamadas('PATCH')[1][1].body)).toEqual({ ativo: true }));
    expect(screen.queryByRole('button', { name: /Desativar: Decisão adiada/ })).toBeFalsy();
  });

  test('exportar, diretrizes, playbook e ver detalhes ficam "em breve" e os blocos sem dado não existem @spec:AC-597', async () => {
    render(<MotivosPerda />);
    await screen.findByRole('region', { name: 'Motivos' });
    for (const rotulo of ['Exportar Relatório de Churn (CSV)', 'Ver Diretrizes', 'Abrir Playbook de Objeções Médicas']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getAllByRole('button', { name: 'Ver detalhes (em breve)' })).toHaveLength(4);
    expect(screen.queryByText(/Distribuição por Categoria|Ação de Retenção|Governança Multi-Tenant/)).toBeFalsy();
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-614', async () => {
    render(<MotivosPerda />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Motivos' });
    cleanup();

    listaStatus = 500;
    render(<MotivosPerda />);
    expect(await screen.findByText(/Não foi possível carregar os motivos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
