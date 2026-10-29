// T-217 (fase4-admin, US-141): a tela de nova empresa (src/components/admin/nova-empresa.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NovaEmpresa } from '../../../src/components/admin/nova-empresa';
import { sugerirSlug } from '../../../src/components/admin/comum';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-217: NovaEmpresa', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let criar: () => Promise<unknown>;

  const posts = () => fetchFalso.mock.calls.filter((c) => c[0] === '/api/admin/empresas');
  const botao = () => screen.getByRole('button', { name: 'Criar e Provisionar Empresa' }) as HTMLButtonElement;
  const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

  beforeEach(() => {
    criar = () => resposta(201, { id: 'e-9', slug: 'hospital-santa-helena', emailEnviado: true, linkConvite: 'https://crm.teste/convite/abc' });
    fetchFalso = vi.fn((url: string) => (url === '/api/admin/empresas' ? criar() : resposta(404, {})));
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup();
  /** fase5-empresa-dados: razão social, CNPJ, plano e assentos passaram a ser obrigatórios. */
  async function preencherDados(u: ReturnType<typeof usuario>) {
    await u.type(campo('Razão social'), 'Hospital Santa Helena Ltda');
    await u.type(campo('CNPJ'), '11.222.333/0001-81');
    await u.selectOptions(screen.getByLabelText('Plano'), 'clinica');
    await u.type(campo('Assentos'), '30');
  }

  test('abre com o título, a volta e o cancelar, dentro do grupo (app) @spec:AC-603', () => {
    render(<NovaEmpresa />);
    expect(screen.getByRole('heading', { name: 'Cadastrar Nova Empresa ou Filial' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voltar para Gestão de Empresas/ }).getAttribute('href')).toBe('/admin/empresas');
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/admin/empresas');
    expect(screen.getByRole('region', { name: 'Identificação Cadastral' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Administrador Master Inicial' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/admin/empresas/nova/page.tsx'))).toBe(true);
  });

  test('sugere o identificador, mostra o resumo, envia e mostra o link; o erro de identificador aparece no campo @spec:AC-606', async () => {
    const u = usuario();
    const escrever = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    render(<NovaEmpresa />);
    expect(botao().disabled).toBe(true);
    await u.type(campo('Nome da empresa'), 'Hospital Santa Hélena');
    expect(campo('Identificador do tenant').value).toBe('hospital-santa-helena');
    const resumo = screen.getByRole('region', { name: 'Resumo do Provisionamento' });
    expect(within(resumo).getByText('app/hospital-santa-helena')).toBeTruthy();
    await u.type(campo('Nome do gestor master'), 'Dr. Eduardo Sampaio');
    await u.type(campo('E-mail do master'), 'eduardo@hospital.com');
    expect(within(resumo).getByText('Dr. Eduardo Sampaio')).toBeTruthy();
    expect(botao().disabled).toBe(true);
    await preencherDados(u);
    expect(botao().disabled).toBe(false);

    // ao editar o identificador, o nome deixa de sobrescrevê-lo
    await u.clear(campo('Identificador do tenant'));
    await u.type(campo('Identificador do tenant'), 'santa-helena');
    await u.type(campo('Nome da empresa'), ' SP');
    expect(campo('Identificador do tenant').value).toBe('santa-helena');

    criar = () => resposta(409, { codigo: 'SLUG_EM_USO' });
    await u.click(botao());
    expect(await screen.findByText('Esse identificador já está em uso.')).toBeTruthy();
    expect(campo('Nome da empresa').value).toBe('Hospital Santa Hélena SP');

    criar = () => resposta(400, { codigo: 'PARAMETRO_INVALIDO', campo: 'masterEmail', mensagem: 'Informe um e-mail válido para o administrador master.' });
    await u.click(botao());
    expect(await screen.findByText('Informe um e-mail válido para o administrador master.')).toBeTruthy();

    criar = () => resposta(201, { id: 'e-9', slug: 'santa-helena', emailEnviado: false, linkConvite: 'https://crm.teste/convite/abc' });
    await u.click(botao());
    expect(await screen.findByText('Empresa criada.')).toBeTruthy();
    expect(screen.getByText('https://crm.teste/convite/abc')).toBeTruthy();
    expect(screen.getByText('O e-mail não pôde ser enviado: copie o link e envie manualmente.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir a empresa' }).getAttribute('href')).toBe('/admin/empresas/e-9');
    await u.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(escrever).toHaveBeenCalledWith('https://crm.teste/convite/abc');
    expect(JSON.parse(posts().at(-1)![1].body)).toMatchObject({ nome: 'Hospital Santa Hélena SP', slug: 'santa-helena', masterNome: 'Dr. Eduardo Sampaio', masterEmail: 'eduardo@hospital.com', razaoSocial: 'Hospital Santa Helena Ltda', cnpj: '11.222.333/0001-81', plano: 'clinica', assentos: 30 });
    expect(botao().disabled).toBe(true);

    expect(sugerirSlug('  Clínica São Lucás — Matriz!! ')).toBe('clinica-sao-lucas-matriz');
    expect(sugerirSlug('A'.repeat(60)).length).toBe(40);
  });

  test('o item genérico "em breve" de plano e cotas foi trocado pelos campos reais; o que o CRM não usa continua fora @spec:AC-607', () => {
    render(<NovaEmpresa />);
    expect(screen.queryByRole('button', { name: 'Plano e cotas de recursos (em breve)' })).toBeNull();
    for (const rotulo of ['Razão social', 'CNPJ', 'CEP', 'Logradouro', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF', 'Plano', 'Assentos']) expect(screen.getByLabelText(rotulo)).toBeTruthy();
    expect(screen.queryByText(/Especialidade|Cargo|Celular|Conformidade CFM|Manual Técnico/i)).toBeFalsy();
  });

  test('o envio falho mantém o que foi digitado e mostra o motivo @spec:AC-614', async () => {
    const u = usuario();
    criar = () => Promise.reject(new Error('offline'));
    render(<NovaEmpresa />);
    await u.type(campo('Nome da empresa'), 'Clínica Teste');
    await u.type(campo('Nome do gestor master'), 'Fulano');
    await u.type(campo('E-mail do master'), 'fulano@x.com');
    await preencherDados(u);
    await u.click(botao());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível criar a empresa/));
    expect(campo('Nome da empresa').value).toBe('Clínica Teste');
  });
});
