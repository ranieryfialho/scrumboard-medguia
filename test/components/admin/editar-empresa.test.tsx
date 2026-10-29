// T-217 (fase4-admin, US-142): a tela de edição da empresa (src/components/admin/editar-empresa.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditarEmpresa } from '../../../src/components/admin/editar-empresa';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const PESSOAS = [
  { usuarioId: 'u1', nome: 'Dr. Roberto Mendes', email: 'roberto@x.com', papel: 'MASTER', status: 'ativo', ultimoAcesso: null },
  { usuarioId: 'u2', nome: 'Mariana Dias', email: 'mariana@x.com', papel: 'ATENDENTE', status: 'pendente', ultimoAcesso: null },
];

describe('T-217: EditarEmpresa', () => {
  const fetchOriginal = globalThis.fetch;
  const locationOriginal = window.location;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let ativa: boolean;
  let pessoas: typeof PESSOAS;
  let detalheStatus: number;
  let patchResposta: () => Promise<unknown>;
  let trocaResposta: () => Promise<unknown>;
  let recarregar: ReturnType<typeof vi.fn>;

  const chamadas = (metodo: string) => fetchFalso.mock.calls.filter((c) => c[1]?.method === metodo);

  beforeEach(() => {
    ativa = true;
    pessoas = PESSOAS;
    detalheStatus = 200;
    patchResposta = () => resposta(200, {});
    trocaResposta = () => resposta(200, { ok: true });
    recarregar = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...locationOriginal, reload: recarregar }, configurable: true });
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url === '/api/admin/empresas/e-1' && init?.method === 'PATCH') return patchResposta();
      if (url === '/api/admin/empresas/e-1') {
        if (detalheStatus !== 200) return resposta(detalheStatus, {});
        return resposta(200, {
          empresa: { id: 'e-1', nome: 'Clínica São Lucas', slug: 'saolucas', ativo: ativa, criadoEm: '2024-01-12T12:00:00.000Z' },
          colaboradores: pessoas,
          resumo: { total: pessoas.length, ativos: pessoas.filter((p) => p.status === 'ativo').length, pendentes: pessoas.filter((p) => p.status === 'pendente').length, inativos: 0 },
        });
      }
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

  test('mostra o nome, a situação, o identificador somente leitura e a data, dentro do grupo (app); desconhecida mostra "não encontrada" @spec:AC-608', async () => {
    render(<EditarEmpresa id="e-1" />);
    expect(await screen.findByRole('heading', { name: 'Clínica São Lucas' })).toBeTruthy();
    expect(screen.getByText('Ativa')).toBeTruthy();
    expect(screen.getByText('tenant: saolucas')).toBeTruthy();
    expect(screen.getByText('Criada em 12/01/2024')).toBeTruthy();
    expect(screen.getByText('Inalterável após a criação.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Voltar para Rede de Empresas' })[0].getAttribute('href')).toBe('/admin/empresas');
    expect(screen.getByText('Usuários ativos')).toBeTruthy();
    expect(screen.getByText('Convites pendentes')).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/admin/empresas/[id]/page.tsx'))).toBe(true);
    cleanup();

    detalheStatus = 404;
    render(<EditarEmpresa id="e-1" />);
    expect(await screen.findByText('Empresa não encontrada')).toBeTruthy();
  });

  test('salvar manda o nome (e os dados cadastrais); suspender e reativar pedem confirmação com o nome; a empresa atual não suspende @spec:AC-609', async () => {
    const u = usuario();
    render(<EditarEmpresa id="e-1" />);
    const salvar = (await screen.findByRole('button', { name: 'Salvar Alterações' })) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    const nome = screen.getByLabelText('Nome da empresa') as HTMLInputElement;
    await u.clear(nome);
    await u.type(nome, 'Clínica São Lucas Matriz');
    expect(salvar.disabled).toBe(false);
    await u.click(salvar);
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('PATCH')[0][1].body)).toMatchObject({ nome: 'Clínica São Lucas Matriz' });
    expect(await screen.findByText('Alterações salvas.')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Suspender' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/Clínica São Lucas fica sem acesso: os 2 usuários não conseguem entrar/)).toBeTruthy();
    expect(chamadas('PATCH')).toHaveLength(1);
    patchResposta = () => resposta(422, { codigo: 'EMPRESA_ATUAL' });
    await u.click(within(dialogo).getByRole('button', { name: 'Suspender' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Você não pode suspender a empresa em que está agora.');

    patchResposta = () => resposta(200, {});
    await u.click(screen.getByRole('button', { name: 'Suspender' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(3));
    expect(JSON.parse(chamadas('PATCH')[2][1].body)).toEqual({ ativo: false });
    cleanup();

    ativa = false;
    render(<EditarEmpresa id="e-1" />);
    expect(await screen.findByText('Inativa')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Reativar' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(JSON.parse(chamadas('PATCH').at(-1)![1].body)).toEqual({ ativo: true }));
  });

  test('lista as pessoas da empresa com papel e situação e "Acessar esta empresa" troca a empresa ativa @spec:AC-611', async () => {
    const u = usuario();
    render(<EditarEmpresa id="e-1" />);
    const lista = await screen.findByRole('region', { name: 'Usuários da Empresa' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain('Dr. Roberto Mendes');
    expect(itens[0].textContent).toContain('MASTER');
    expect(itens[0].textContent).toContain('Ativo');
    expect(itens[1].textContent).toContain('Pendente');

    await u.click(screen.getByRole('button', { name: 'Acessar esta empresa' }));
    await waitFor(() => expect(recarregar).toHaveBeenCalled());
    expect(JSON.parse(chamadas('POST')[0][1].body)).toEqual({ empresaId: 'e-1' });
    cleanup();

    pessoas = [];
    render(<EditarEmpresa id="e-1" />);
    expect(await screen.findByText('Nenhuma pessoa nesta empresa')).toBeTruthy();
  });

  test('impersonate, cota, integrações, políticas e arquivar ficam "em breve" e plano, CNPJ e infraestrutura não existem @spec:AC-612', async () => {
    render(<EditarEmpresa id="e-1" />);
    await screen.findByRole('heading', { name: 'Clínica São Lucas' });
    for (const rotulo of ['Impersonate / Acessar como Master', 'Integrações & WhatsApp Evolution', 'Logs de Auditoria', 'Políticas de governança e dados', 'Desativar e Arquivar Tenant']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Volume no Pipeline|Fechamentos|PostgreSQL|Backup/i)).toBeFalsy();
    expect(screen.queryByRole('button', { name: 'Alterar Cota (em breve)' })).toBeNull(); // virou o campo de assentos (fase5-empresa-dados)
  });

  test('carregando mostra esqueleto e a falha mostra erro com "Tentar de novo" @spec:AC-614', async () => {
    render(<EditarEmpresa id="e-1" />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('heading', { name: 'Clínica São Lucas' });
    cleanup();

    detalheStatus = 500;
    render(<EditarEmpresa id="e-1" />);
    expect(await screen.findByText(/Não foi possível carregar a empresa/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
