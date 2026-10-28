// T-214 (fase4-admin, US-138): a tela de convite (src/components/admin/convidar-usuario.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConvidarUsuario } from '../../../src/components/admin/convidar-usuario';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-214: ConvidarUsuario', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let eu: { papel: string; isSuperAdmin: boolean };
  let convite: () => Promise<unknown>;

  const posts = () => fetchFalso.mock.calls.filter((c) => c[0] === '/api/equipe/convites');
  const botao = () => screen.getByRole('button', { name: 'Enviar Convite por E-mail' }) as HTMLButtonElement;

  beforeEach(() => {
    eu = { papel: 'MASTER', isSuperAdmin: false };
    convite = () => resposta(201, { usuarioId: 'u1', emailEnviado: true, linkConvite: 'https://crm.teste/convite/abc', reativado: false });
    fetchFalso = vi.fn((url: string) => {
      if (url === '/api/me') return resposta(200, eu);
      if (url === '/api/equipe/convites') return convite();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  const usuario = () => userEvent.setup();

  test('abre com o título, a volta para a equipe e o cancelar, dentro do grupo (app) @spec:AC-586', async () => {
    render(<ConvidarUsuario />);
    expect(screen.getByRole('heading', { name: 'Convidar Novo Usuário para a Equipe' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voltar para Gestão da Equipe/ }).getAttribute('href')).toBe('/equipe');
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/equipe');
    expect(screen.getByRole('region', { name: 'Dados Cadastrais do Colaborador' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Definição de Papel e Permissões' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/equipe/convidar/page.tsx'))).toBe(true);
  });

  test('o botão só habilita com nome, e-mail válido e papel; a prévia e a matriz acompanham; o gerente só vê atendente @spec:AC-589', async () => {
    const u = usuario();
    render(<ConvidarUsuario />);
    expect(botao().disabled).toBe(true);
    await u.type(screen.getByLabelText('Nome completo'), 'Dra. Mariana Vasconcelos');
    await u.type(screen.getByLabelText('E-mail corporativo'), 'mariana');
    expect(screen.getByText('Informe um e-mail válido.')).toBeTruthy();
    await u.type(screen.getByLabelText('E-mail corporativo'), '@clinica.com');
    expect(botao().disabled).toBe(true);
    await u.click(screen.getByLabelText('ATENDENTE'));
    expect(botao().disabled).toBe(false);

    const previa = screen.getByRole('region', { name: 'Prévia do card de usuário' });
    expect(within(previa).getByText('Dra. Mariana Vasconcelos')).toBeTruthy();
    expect(within(previa).getByText('mariana@clinica.com')).toBeTruthy();
    expect(within(previa).getByText('ATENDENTE')).toBeTruthy();
    expect(within(previa).getByText('Pendente')).toBeTruthy();
    expect(within(previa).getByText('DM')).toBeTruthy();
    const matriz = screen.getByRole('region', { name: 'Matriz de Acessos' });
    expect(within(matriz).getByText(/Indicadores e relatórios/)).toBeTruthy(); // bloqueado para o atendente
    expect(within(matriz).getByText('Agenda de reuniões')).toBeTruthy();
    await u.click(screen.getByLabelText('MASTER'));
    expect(within(screen.getByRole('region', { name: 'Matriz de Acessos' })).getByText('Convidar qualquer papel')).toBeTruthy();
    expect(screen.getByText(/Validade do convite: /).textContent).toContain('24 horas');
    cleanup();

    eu = { papel: 'GERENTE', isSuperAdmin: false };
    render(<ConvidarUsuario />);
    await screen.findByText('Como gerente, você só convida atendentes.');
    expect(screen.getByLabelText('ATENDENTE')).toBeTruthy();
    expect(screen.queryByLabelText('MASTER')).toBeFalsy();
    expect(screen.queryByLabelText('GERENTE')).toBeFalsy();
  });

  test('o resultado mostra o link copiável e avisa quando o e-mail não saiu; os erros mantêm o que foi digitado @spec:AC-590', async () => {
    const u = usuario();
    const escrever = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    render(<ConvidarUsuario />);
    await u.type(screen.getByLabelText('Nome completo'), 'Dra. Nova');
    await u.type(screen.getByLabelText('E-mail corporativo'), 'nova@clinica.com');
    await u.click(screen.getByLabelText('GERENTE'));

    await u.click(botao());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ nome: 'Dra. Nova', email: 'nova@clinica.com', papel: 'GERENTE' });
    expect(await screen.findByText('Convite criado para nova@clinica.com')).toBeTruthy();
    expect(screen.getByText('https://crm.teste/convite/abc')).toBeTruthy();
    expect(screen.queryByText(/O e-mail não pôde ser enviado/)).toBeFalsy();
    await u.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(escrever).toHaveBeenCalledWith('https://crm.teste/convite/abc');

    convite = () => resposta(201, { emailEnviado: false, linkConvite: 'https://crm.teste/convite/def', reativado: false });
    await u.click(botao());
    expect(await screen.findByText('O e-mail não pôde ser enviado: copie o link e envie manualmente.')).toBeTruthy();

    convite = () => resposta(409, { codigo: 'JA_E_COLABORADOR' });
    await u.click(botao());
    expect((await screen.findByRole('alert')).textContent).toBe('Esta pessoa já faz parte da equipe.');
    expect((screen.getByLabelText('Nome completo') as HTMLInputElement).value).toBe('Dra. Nova');
    convite = () => resposta(403, { codigo: 'SEM_PERMISSAO' });
    await u.click(botao());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Você não tem permissão para esta ação.'));
    convite = () => Promise.reject(new Error('offline'));
    await u.click(botao());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível enviar o convite/));
    expect((screen.getByLabelText('E-mail corporativo') as HTMLInputElement).value).toBe('nova@clinica.com');
  });

  test('WhatsApp, departamento, 2FA, leads, validade e boas-vindas ficam "em breve"; licenças e garantias não existem @spec:AC-591', async () => {
    render(<ConvidarUsuario />);
    for (const rotulo of ['WhatsApp Corporativo', 'Departamento / Squad', 'Exigir 2FA no primeiro acesso', 'Atribuir leads automaticamente', 'Validade do token', 'Mensagem personalizada de boas-vindas']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/licenças|Garantias de Governança|HIPAA/i)).toBeFalsy();
  });
});
