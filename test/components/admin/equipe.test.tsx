// T-213 (fase4-admin, US-137): a tela da equipe (src/components/admin/equipe.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Equipe } from '../../../src/components/admin/equipe';
import { ultimoAcessoTexto } from '../../../src/components/admin/comum';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const P = (n: number, nome: string, papel: string, status: string, ultimoAcesso: string | null = null) => ({
  usuarioId: `u-${n}`, nome, email: `${nome.split(' ')[0].toLowerCase()}@clinica.com`, papel, status, ultimoAcesso,
});

const EQUIPE = [
  P(1, 'Roberto Mendes', 'MASTER', 'ativo', new Date(Date.now() - 4 * 60_000).toISOString()),
  P(2, 'Juliana Rocha', 'GERENTE', 'ativo', new Date(Date.now() - 3 * 3600_000).toISOString()),
  P(3, 'Carlos Mendes', 'ATENDENTE', 'ativo', new Date(Date.now() - 5 * 86_400_000).toISOString()),
  P(4, 'Mariana Dias', 'ATENDENTE', 'pendente'),
  P(5, 'Lucas Nogueira', 'ATENDENTE', 'inativo', '2026-09-01T12:00:00.000Z'),
];
const RESUMO = { total: 5, ativos: 3, pendentes: 1, inativos: 1 };

describe('T-213: Equipe', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let eu: { email: string; papel: string; isSuperAdmin: boolean };
  let listaStatus: number;
  let patchResposta: () => Promise<unknown>;
  let reenvioResposta: () => Promise<unknown>;
  let lista: typeof EQUIPE;

  const urls = () => fetchFalso.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/equipe?'));
  const chamadas = (metodo: string) => fetchFalso.mock.calls.filter((c) => c[1]?.method === metodo);

  beforeEach(() => {
    eu = { email: 'roberto@clinica.com', papel: 'MASTER', isSuperAdmin: false };
    listaStatus = 200;
    lista = EQUIPE;
    patchResposta = () => resposta(200, {});
    reenvioResposta = () => resposta(200, { emailEnviado: true, linkConvite: 'https://x/convite/abc' });
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith('/api/equipe?')) {
        if (listaStatus !== 200) return resposta(listaStatus, {});
        const p = new URL(url, 'http://x').searchParams;
        let itens = lista;
        if (p.get('papel')) itens = itens.filter((c) => c.papel === p.get('papel'));
        if (p.get('status')) itens = itens.filter((c) => c.status === p.get('status'));
        if (p.get('busca')) itens = itens.filter((c) => c.nome.toLowerCase().includes(p.get('busca')!.toLowerCase()));
        const pagina = Number(p.get('pagina'));
        const por = Number(p.get('porPagina'));
        return resposta(200, { colaboradores: itens.slice((pagina - 1) * por, pagina * por), total: itens.length, resumo: RESUMO });
      }
      if (url === '/api/me') return resposta(200, eu);
      if (url.includes('/reenviar-convite') && init?.method === 'POST') return reenvioResposta();
      if (url.startsWith('/api/equipe/') && init?.method === 'PATCH') return patchResposta();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup();

  test('abre com o título dentro do grupo (app) e o atalho para convidar @spec:AC-577', async () => {
    render(<Equipe />);
    expect(await screen.findByRole('heading', { name: 'Gestão da Equipe e Acessos' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Convidar Usuário/ }).getAttribute('href')).toBe('/equipe/convidar');
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/equipe/page.tsx'))).toBe(true);
    await screen.findByText('Juliana Rocha');
  });

  test('os quatro cartões vêm do resumo, sem assentos, login médio nem LGPD @spec:AC-580', async () => {
    render(<Equipe />);
    await screen.findByText('Total de colaboradores');
    for (const titulo of ['Usuários ativos', 'Convites pendentes', 'Inativos']) expect(screen.getByText(titulo)).toBeTruthy();
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/assentos|login médio|LGPD|2FA/i)).toBeFalsy();
  });

  test('a tabela mostra papel, situação e último acesso; busca, filtros e paginação pedem o recorte ao servidor @spec:AC-581', async () => {
    const u = usuario();
    render(<Equipe />);
    const tabela = await screen.findByRole('region', { name: 'Colaboradores' });
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(5);
    expect(within(linhas[0]).getByText('Roberto Mendes')).toBeTruthy();
    expect(within(linhas[0]).getByText('MASTER')).toBeTruthy();
    expect(within(linhas[0]).getByText('Ativo')).toBeTruthy();
    expect(within(linhas[0]).getByText('Há 4 min')).toBeTruthy();
    expect(within(linhas[1]).getByText('Há 3 h')).toBeTruthy();
    expect(within(linhas[2]).getByText('Há 5 dias')).toBeTruthy();
    expect(within(linhas[3]).getByText('Pendente')).toBeTruthy();
    expect(within(linhas[3]).getByText('Nunca acessou')).toBeTruthy();
    expect(within(linhas[4]).getByText('Inativo')).toBeTruthy();
    expect(within(linhas[4]).getByText('01/09/2026')).toBeTruthy();
    expect(urls()[0]).toBe('/api/equipe?pagina=1&porPagina=10');
    expect(tabela.textContent).not.toMatch(/Squad|2FA|IP /);
    expect(within(tabela).getByText(/Exibindo/).textContent).toMatch(/1 a 5 de 5 colaboradores/);

    await u.selectOptions(screen.getByLabelText('Papel'), 'ATENDENTE');
    await waitFor(() => expect(urls().at(-1)).toMatch(/papel=ATENDENTE/));
    await u.selectOptions(screen.getByLabelText('Situação'), 'pendente');
    await waitFor(() => expect(urls().at(-1)).toMatch(/papel=ATENDENTE&status=pendente/));
    await u.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(urls().at(-1)).toBe('/api/equipe?pagina=1&porPagina=10'));
    await u.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'zzz');
    expect(await screen.findByText('Nenhum colaborador encontrado')).toBeTruthy();
    expect(ultimoAcessoTexto(null)).toBe('Nunca acessou');
  });

  test('o master troca o papel pela tabela e o gerente não vê a troca nem o desativar @spec:AC-582', async () => {
    const u = usuario();
    render(<Equipe />);
    await u.selectOptions(await screen.findByLabelText('Papel de Carlos Mendes'), 'GERENTE');
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(1));
    expect(chamadas('PATCH')[0][0]).toBe('/api/equipe/u-3');
    expect(JSON.parse(chamadas('PATCH')[0][1].body)).toEqual({ papel: 'GERENTE' });
    expect(await screen.findByText('Papel de Carlos Mendes atualizado.')).toBeTruthy();
    // a própria linha do master não tem troca nem desativar
    expect(screen.queryByLabelText('Papel de Roberto Mendes')).toBeFalsy();
    expect(screen.queryByRole('button', { name: /Desativar: Roberto/ })).toBeFalsy();

    patchResposta = () => resposta(422, { codigo: 'ULTIMO_MASTER' });
    await u.selectOptions(screen.getByLabelText('Papel de Juliana Rocha'), 'ATENDENTE');
    expect((await screen.findByRole('alert')).textContent).toBe('A empresa precisa ter pelo menos um MASTER ativo.');
    cleanup();

    eu = { email: 'juliana@clinica.com', papel: 'GERENTE', isSuperAdmin: false };
    render(<Equipe />);
    await screen.findByText('Carlos Mendes');
    await waitFor(() => expect(fetchFalso.mock.calls.filter((c) => c[0] === '/api/me').length).toBeGreaterThan(1));
    expect(screen.queryByLabelText('Papel de Carlos Mendes')).toBeFalsy();
    expect(screen.queryByRole('button', { name: /Desativar: Carlos/ })).toBeFalsy();
  });

  test('desativar e reativar pedem confirmação com o nome e chamam a API @spec:AC-583', async () => {
    const u = usuario();
    render(<Equipe />);
    await u.click(await screen.findByRole('button', { name: 'Desativar: Carlos Mendes' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/Carlos Mendes perde o acesso a esta empresa agora/)).toBeTruthy();
    expect(chamadas('PATCH')).toHaveLength(0);
    await u.click(within(dialogo).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('PATCH')[0][1].body)).toEqual({ ativo: false });
    expect(await screen.findByText('Carlos Mendes foi desativado.')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: 'Reativar: Lucas Nogueira' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(chamadas('PATCH')).toHaveLength(2));
    expect(JSON.parse(chamadas('PATCH')[1][1].body)).toEqual({ ativo: true });

    patchResposta = () => resposta(422, { codigo: 'NAO_PODE_ALTERAR_A_SI' });
    await u.click(screen.getByRole('button', { name: 'Desativar: Juliana Rocha' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desativar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Você não pode alterar o seu próprio acesso.');
  });

  test('"Reenviar convite" só aparece para pendentes e mostra o link quando o e-mail não sai @spec:AC-584', async () => {
    const u = usuario();
    render(<Equipe />);
    expect(screen.queryByRole('button', { name: /Reenviar convite: Carlos/ })).toBeFalsy();
    await u.click(await screen.findByRole('button', { name: 'Reenviar convite: Mariana Dias' }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
    expect(chamadas('POST')[0][0]).toBe('/api/equipe/u-4/reenviar-convite');
    expect(await screen.findByText('Convite reenviado para mariana@clinica.com.')).toBeTruthy();

    reenvioResposta = () => resposta(200, { emailEnviado: false, linkConvite: 'https://x/convite/zzz' });
    await u.click(screen.getByRole('button', { name: 'Reenviar convite: Mariana Dias' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/o e-mail não pôde ser enviado.*https:\/\/x\/convite\/zzz/);
    reenvioResposta = () => resposta(422, { codigo: 'CONVITE_NAO_PENDENTE' });
    await u.click(screen.getByRole('button', { name: 'Reenviar convite: Mariana Dias' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Esta pessoa não tem convite pendente.');
  });

  test('Políticas, exportar, frentes, logs e IP ficam "em breve" e a seleção em massa e o bloco LGPD não existem @spec:AC-585', async () => {
    render(<Equipe />);
    await screen.findByText('Juliana Rocha');
    for (const rotulo of ['Políticas & Perfis', 'Exportar Auditoria (CSV)', 'Todas as Frentes Comerciais', 'Logs de Auditoria', 'Configurar IP Allowlist & Sessão']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/Políticas LGPD vigentes|Auditoria criptográfica|Segurança e Acesso Restrito/i)).toBeFalsy();
  });

  test('carregando mostra esqueleto, sem equipe mostra o vazio e falha mostra erro com "Tentar de novo" @spec:AC-614', async () => {
    render(<Equipe />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByText('Juliana Rocha');
    cleanup();

    lista = [];
    render(<Equipe />);
    expect(await screen.findByText('Nenhum colaborador encontrado')).toBeTruthy();
    cleanup();

    listaStatus = 500;
    render(<Equipe />);
    expect(await screen.findByText(/Não foi possível carregar a equipe/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
