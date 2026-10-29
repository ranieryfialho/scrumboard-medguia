// T-263 (fase5-email-config, AC-694): a tela de e-mail da empresa (src/components/admin/email-empresa.tsx).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EmailEmpresa } from '../../../src/components/admin/email-empresa';

describe('T-263: tela de e-mail da empresa', () => {
  let estado: { chaveConfigurada: boolean; chaveFinal: string | null; remetente: string | null };
  let respostaDoPut: () => Response;
  let chamadas: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    estado = { chaveConfigurada: true, chaveFinal: 'abcd', remetente: 'Clínica <contato@clinica.com>' };
    chamadas = [];
    respostaDoPut = () => {
      throw new Error('sem resposta definida');
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, init });
        if (init?.method === 'PUT') return respostaDoPut();
        return new Response(JSON.stringify(estado));
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const put = () => JSON.parse(String(chamadas.filter((c) => c.init?.method === 'PUT').at(-1)!.init!.body));

  test('mostra só o final da chave, nunca a chave, e o remetente atual @spec:AC-694', async () => {
    render(<EmailEmpresa />);
    expect(await screen.findByText('Chave configurada (termina em …abcd)')).toBeTruthy();
    expect((screen.getByLabelText('Chave do Resend') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Chave do Resend') as HTMLInputElement).type).toBe('password');
    expect((screen.getByLabelText('Remetente') as HTMLInputElement).value).toBe('Clínica <contato@clinica.com>');
    cleanup();

    estado = { chaveConfigurada: false, chaveFinal: null, remetente: null };
    render(<EmailEmpresa />);
    expect(await screen.findByText('Chave não configurada')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remover chave' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('salvar manda a chave só se foi digitada (em branco mantém a atual), confirma e limpa o campo @spec:AC-694', async () => {
    const u = userEvent.setup();
    respostaDoPut = () => new Response(JSON.stringify({ chaveConfigurada: true, chaveFinal: 'wxyz', remetente: 'novo@clinica.com' }));
    render(<EmailEmpresa />);
    const remetente = await screen.findByLabelText('Remetente');
    await u.clear(remetente);
    await u.type(remetente, 'novo@clinica.com');
    await u.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    expect(await screen.findByText('Configuração salva')).toBeTruthy();
    expect(put()).toEqual({ remetente: 'novo@clinica.com' }); // sem `chave`: mantém a atual

    await u.type(screen.getByLabelText('Chave do Resend'), 're_nova_chave_1234567890abcdefwxyz');
    await u.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    await screen.findByText('Chave configurada (termina em …wxyz)');
    expect(put()).toEqual({ remetente: 'novo@clinica.com', chave: 're_nova_chave_1234567890abcdefwxyz' });
    expect((screen.getByLabelText('Chave do Resend') as HTMLInputElement).value).toBe('');
  });

  test('o erro de cada campo aparece junto dele @spec:AC-694', async () => {
    const u = userEvent.setup();
    respostaDoPut = () => new Response(JSON.stringify({ codigo: 'PARAMETRO_INVALIDO', campo: 'chave', mensagem: 'A chave do Resend começa com re_, tem de 20 a 200 caracteres e não tem espaços.' }), { status: 400 });
    render(<EmailEmpresa />);
    await u.type(await screen.findByLabelText('Chave do Resend'), 'errada');
    await u.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    const campo = screen.getByLabelText('Chave do Resend').parentElement!;
    expect((await within(campo).findByRole('alert')).textContent).toContain('começa com re_');

    respostaDoPut = () => new Response(JSON.stringify({ codigo: 'CONFIGURACAO_INDISPONIVEL', mensagem: 'O servidor não está pronto para guardar a chave com segurança. Avise o suporte.' }), { status: 503 });
    await u.click(screen.getByRole('button', { name: 'Salvar configuração' }));
    expect((await screen.findAllByRole('alert')).some((a) => a.textContent!.includes('não está pronto para guardar a chave'))).toBe(true);
  });

  test('"Remover chave" manda chave nula e confirma @spec:AC-694', async () => {
    const u = userEvent.setup();
    respostaDoPut = () => new Response(JSON.stringify({ chaveConfigurada: false, chaveFinal: null, remetente: 'Clínica <contato@clinica.com>' }));
    render(<EmailEmpresa />);
    await u.click(await screen.findByRole('button', { name: 'Remover chave' }));
    expect(await screen.findByText('Chave removida')).toBeTruthy();
    expect(put()).toEqual({ chave: null });
    expect(screen.getByText('Chave não configurada')).toBeTruthy();
  });
});
