// T-239 (fase5-empresa-dados, US-155): os campos cadastrais nas telas de empresas, a lista com plano e
// assentos e o limite de assentos na equipe e no convite.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConvidarUsuario } from '../../../src/components/admin/convidar-usuario';
import { EditarEmpresa } from '../../../src/components/admin/editar-empresa';
import { Empresas } from '../../../src/components/admin/empresas';
import { Equipe } from '../../../src/components/admin/equipe';
import { NovaEmpresa } from '../../../src/components/admin/nova-empresa';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-239: telas com os dados da empresa', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let rotas: Record<string, (init?: { method?: string; body?: string }) => Promise<unknown>>;
  const usuario = () => userEvent.setup();

  beforeEach(() => {
    rotas = {};
    fetchFalso = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      const chave = Object.keys(rotas).find((k) => url.startsWith(k) && (!k.includes('#') || url.includes(k.split('#')[1])));
      return chave ? rotas[chave](init) : resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('nova empresa mostra o erro de cada campo junto dele, inclusive CNPJ repetido @spec:AC-657', async () => {
    const u = usuario();
    rotas['/api/admin/empresas'] = () => resposta(400, { codigo: 'PARAMETRO_INVALIDO', campo: 'cnpj', mensagem: 'O CNPJ é inválido.' });
    render(<NovaEmpresa />);
    await u.type(screen.getByLabelText('Nome da empresa'), 'Hospital Santa Helena');
    await u.type(screen.getByLabelText('Nome do gestor master'), 'Dr. Eduardo');
    await u.type(screen.getByLabelText('E-mail do master'), 'eduardo@hospital.com');
    await u.type(screen.getByLabelText('Razão social'), 'Hospital Santa Helena Ltda');
    await u.type(screen.getByLabelText('CNPJ'), '11222333000182');
    await u.selectOptions(screen.getByLabelText('Plano'), 'starter');
    await u.type(screen.getByLabelText('Assentos'), '5');
    await u.click(screen.getByRole('button', { name: 'Criar e Provisionar Empresa' }));
    const campo = screen.getByLabelText('CNPJ').closest('label')!;
    expect(await within(campo).findByRole('alert')).toBeTruthy();
    expect(within(campo).getByText('O CNPJ é inválido.')).toBeTruthy();

    rotas['/api/admin/empresas'] = () => resposta(409, { codigo: 'CNPJ_EM_USO' });
    await u.click(screen.getByRole('button', { name: 'Criar e Provisionar Empresa' }));
    expect(await within(campo).findByText('Já existe uma empresa com este CNPJ.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plano e cotas de recursos (em breve)' })).toBeNull();
  });

  test('editar mostra os dados salvos, envia as mudanças e mostra o erro dos assentos; "Alterar Cota" virou o campo @spec:AC-658', async () => {
    const u = usuario();
    let patch: () => Promise<unknown> = () => resposta(200, {});
    rotas['/api/admin/empresas/e-1'] = (init) =>
      init?.method === 'PATCH'
        ? patch()
        : resposta(200, {
            empresa: { id: 'e-1', nome: 'Clínica São Lucas', slug: 'saolucas', ativo: true, criadoEm: '2024-01-12T12:00:00.000Z', razaoSocial: 'São Lucas Ltda', cnpj: '11222333000181', cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: 'Campinas', uf: 'SP', plano: 'clinica', assentos: 5 },
            assentosEmUso: 3,
            colaboradores: [],
            resumo: { total: 3, ativos: 2, pendentes: 1, inativos: 0 },
          });
    render(<EditarEmpresa id="e-1" />);
    expect(((await screen.findByLabelText('Razão social')) as HTMLInputElement).value).toBe('São Lucas Ltda');
    expect((screen.getByLabelText('CNPJ') as HTMLInputElement).value).toBe('11222333000181');
    expect((screen.getByLabelText('Plano') as HTMLSelectElement).value).toBe('clinica');
    expect((screen.getByLabelText('Assentos') as HTMLInputElement).value).toBe('5');
    expect(screen.getByText(/3 em uso/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alterar Cota (em breve)' })).toBeNull();
    expect(screen.getByText('tenant:', { exact: false })).toBeTruthy(); // o identificador continua só leitura

    const assentos = screen.getByLabelText('Assentos');
    await u.clear(assentos);
    await u.type(assentos, '2');
    patch = () => resposta(409, { codigo: 'ASSENTOS_ABAIXO_DO_EM_USO' });
    await u.click(screen.getByRole('button', { name: 'Salvar Alterações' }));
    const campo = assentos.closest('label')!;
    expect(await within(campo).findByText('Os assentos não podem ficar abaixo das pessoas já em uso.')).toBeTruthy();
    const corpo = JSON.parse(fetchFalso.mock.calls.filter((c) => c[1]?.method === 'PATCH')[0][1].body);
    expect(corpo).toMatchObject({ razaoSocial: 'São Lucas Ltda', cnpj: '11222333000181', plano: 'clinica', assentos: 2, cidade: 'Campinas' });
  });

  test('a lista mostra o plano e "N de M assentos" em cada linha, e traço onde não há plano @spec:AC-658', async () => {
    rotas['/api/admin/empresas?'] = () =>
      resposta(200, {
        empresas: [
          { id: 'e-1', nome: 'Clínica A', slug: 'a', ativo: true, criadoEm: '2024-01-12T12:00:00.000Z', usuariosAtivos: 3, usuariosTotal: 4, plano: 'enterprise', assentos: 10 },
          { id: 'e-2', nome: 'Clínica B', slug: 'b', ativo: true, criadoEm: '2024-01-12T12:00:00.000Z', usuariosAtivos: 2, usuariosTotal: 2, plano: null, assentos: null },
        ],
        resumo: { total: 2, ativas: 2, inativas: 0, usuariosAtivos: 5 },
      });
    rotas['/api/me'] = () => resposta(200, { empresaAtiva: { id: 'e-1', nome: 'Clínica A' }, isSuperAdmin: true });
    render(<Empresas />);
    expect(await screen.findByText('Enterprise · 3 de 10 assentos')).toBeTruthy();
    expect(screen.getByText('— · 2 assentos, sem limite')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Plano e assentos' })).toBeTruthy();
  });

  test('a equipe mostra "N de M" assentos e o convite com a cota cheia mostra a mensagem em português @spec:AC-659', async () => {
    const u = usuario();
    rotas['/api/equipe?'] = () =>
      resposta(200, {
        colaboradores: [],
        total: 0,
        resumo: { total: 5, ativos: 4, pendentes: 1, inativos: 0 },
        assentos: { emUso: 5, limite: 5 },
      });
    rotas['/api/me'] = () => resposta(200, { papel: 'MASTER', isSuperAdmin: false });
    const { unmount } = render(<Equipe />);
    expect(await screen.findByText('5 de 5')).toBeTruthy();
    expect(screen.getByText('assentos em uso')).toBeTruthy();
    unmount();

    rotas['/api/equipe/convites'] = () => resposta(409, { codigo: 'SEM_ASSENTOS' });
    render(<ConvidarUsuario />);
    await u.type(screen.getByLabelText('Nome completo'), 'Dra. Mariana');
    await u.type(screen.getByLabelText('E-mail corporativo'), 'mariana@clinica.com');
    await u.click(screen.getByLabelText('ATENDENTE'));
    await u.click(screen.getByRole('button', { name: 'Enviar Convite por E-mail' }));
    expect(await screen.findByText('A empresa atingiu o limite de assentos do plano.')).toBeTruthy();
    await waitFor(() => expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/equipe/convites')).toBe(true));
  });
});
