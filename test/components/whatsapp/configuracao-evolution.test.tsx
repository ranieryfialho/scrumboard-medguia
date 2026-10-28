// T-194 (fase4-whatsapp, US-127): a tela de configuração
// (src/components/whatsapp/configuracao-evolution.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfiguracaoEvolution } from '../../../src/components/whatsapp/configuracao-evolution';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const CONFIG = {
  empresaId: 'e1',
  config: { evolution_instance_name: 'clinica-matriz' },
  servidor: { urlBase: 'https://evolution.medguia.test', chaveConfigurada: true },
  webhookUrl: 'https://crm.medguia.test/api/whatsapp/webhook?empresa_id=e1&secret=••••••••',
  eventos: ['MESSAGES_UPSERT'],
};

describe('T-194: ConfiguracaoEvolution', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let papel: string;
  let salvarResposta: () => Promise<unknown>;
  let statusResposta: () => Promise<unknown>;
  let configStatus: number;

  const posts = () => fetchFalso.mock.calls.filter((c) => c[0] === '/api/whatsapp/config' && c[1]?.method === 'POST');
  const campo = () => screen.getByLabelText('Nome da instância ativa') as HTMLInputElement;

  beforeEach(() => {
    papel = 'GERENTE';
    configStatus = 200;
    salvarResposta = () => resposta(200, { success: true });
    statusResposta = () => resposta(200, { state: 'open', instance: 'clinica-matriz' });
    fetchFalso = vi.fn((url: string, init?: { method?: string }) => {
      if (url === '/api/whatsapp/config' && init?.method === 'POST') return salvarResposta();
      if (url === '/api/whatsapp/config') return configStatus === 200 ? resposta(200, CONFIG) : resposta(configStatus, {});
      if (url === '/api/whatsapp/status') return statusResposta();
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título e as três seções, dentro do grupo (app) @spec:AC-523', async () => {
    render(<ConfiguracaoEvolution />);
    expect(await screen.findByRole('heading', { name: 'Configurações Técnicas da Evolution API' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Conexão com o Servidor Evolution API' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Configuração de Webhooks & Eventos' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Diretrizes de Segurança Anti-Ban & Cadência' })).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/whatsapp/configuracao/page.tsx'))).toBe(true);
  });

  test('salva o nome da instância, valida o formato e trata o nome em uso e o atendente @spec:AC-525', async () => {
    const u = userEvent.setup();
    render(<ConfiguracaoEvolution />);
    await waitFor(() => expect(campo().value).toBe('clinica-matriz'));

    fireEvent.change(campo(), { target: { value: 'nome inválido!' } });
    await u.click(screen.getByRole('button', { name: 'Salvar Alterações' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/1 a 64 letras/);
    expect(posts()).toHaveLength(0);

    fireEvent.change(campo(), { target: { value: 'nova-instancia' } });
    await u.click(screen.getByRole('button', { name: 'Salvar Alterações' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ evolution_instance_name: 'nova-instancia' });
    expect(await screen.findByText('Configuração salva.')).toBeTruthy();

    salvarResposta = () => resposta(409, { codigo: 'INSTANCIA_EM_USO' });
    await u.click(screen.getByRole('button', { name: 'Salvar Alterações' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Esse nome de instância já está em uso.'));
    cleanup();

    papel = 'ATENDENTE';
    render(<ConfiguracaoEvolution />);
    await waitFor(() => expect(campo().value).toBe('clinica-matriz'));
    await waitFor(() => expect(campo().disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Salvar Alterações' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('a URL base e a chave aparecem só como informação, sem revelar a chave @spec:AC-526', async () => {
    render(<ConfiguracaoEvolution />);
    const secao = await screen.findByRole('region', { name: 'Conexão com o Servidor Evolution API' });
    expect(within(secao).getByText('https://evolution.medguia.test')).toBeTruthy();
    expect(within(secao).getByText(/Configurada no servidor/)).toBeTruthy();
    expect(within(secao).queryByRole('button', { name: /revelar|mostrar/i })).toBeFalsy();
    expect(within(secao).getByRole('button', { name: 'Regenerar Chave (em breve)' }).getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).not.toContain('chave-super-secreta');
  });

  test('"Verificar Conexão" mede o tempo da resposta ou avisa a falha @spec:AC-527', async () => {
    const u = userEvent.setup();
    render(<ConfiguracaoEvolution />);
    await u.click(await screen.findByRole('button', { name: 'Verificar Conexão com o Servidor' }));
    expect(await screen.findByText(/Servidor respondeu em \d+ ms \(instância conectada\)/)).toBeTruthy();

    statusResposta = () => resposta(500, {});
    await u.click(screen.getByRole('button', { name: 'Verificar Conexão com o Servidor' }));
    expect(await screen.findByText('Não foi possível verificar a conexão.')).toBeTruthy();
  });

  test('o webhook aparece somente leitura com os eventos registrados e os de teste "em breve" @spec:AC-528', async () => {
    const u = userEvent.setup();
    const escrever = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    render(<ConfiguracaoEvolution />);
    const secao = await screen.findByRole('region', { name: 'Configuração de Webhooks & Eventos' });
    expect(within(secao).getByText(CONFIG.webhookUrl)).toBeTruthy();
    expect(within(secao).getByText('MESSAGES_UPSERT')).toBeTruthy();
    expect(within(secao).getByText('Essencial')).toBeTruthy();
    expect(within(secao).queryByText(/MESSAGES_UPDATE|CONNECTION_UPDATE|SEND_MESSAGE/)).toBeFalsy();
    expect(within(secao).queryAllByRole('checkbox')).toHaveLength(0);
    await u.click(within(secao).getByRole('button', { name: 'Copiar' }));
    expect(escrever).toHaveBeenCalledWith(CONFIG.webhookUrl);
    for (const rotulo of ['Testar Disparo de Webhook', 'Simular Evento de Teste (Ping)']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
  });

  test('as diretrizes anti-ban e restaurar padrões aparecem "em breve", sem versão nem manutenção @spec:AC-529', async () => {
    render(<ConfiguracaoEvolution />);
    await screen.findByRole('region', { name: 'Diretrizes de Segurança Anti-Ban & Cadência' });
    for (const rotulo of ['Intervalo mínimo entre mensagens', 'Limite de disparos por hora', 'Digitação humana simulada', 'Auto-reconexão inteligente', 'Restaurar Padrões de Fábrica']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.queryByText(/Evolution Adapter|janela de manutenção/i)).toBeFalsy();
  });

  test('carregando mostra esqueleto e falha mostra erro com "Tentar de novo" @spec:AC-531', async () => {
    render(<ConfiguracaoEvolution />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByRole('region', { name: 'Conexão com o Servidor Evolution API' });
    cleanup();

    configStatus = 500;
    render(<ConfiguracaoEvolution />);
    expect(await screen.findByText(/Não foi possível carregar a configuração/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});
