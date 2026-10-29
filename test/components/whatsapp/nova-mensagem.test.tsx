// T-191 (fase4-whatsapp, US-125): a tela de nova mensagem avulsa
// (src/components/whatsapp/nova-mensagem.tsx).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NovaMensagem } from '../../../src/components/whatsapp/nova-mensagem';

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

const DISPARO = (n: number, respondida: boolean) => ({
  chave: `55119888800${n}`, leadId: null, numero: `55119888800${n}`, nome: null, ultimaMensagem: `Mensagem ${n}`, ultimaEm: new Date().toISOString(),
  ultimaDirecao: 'enviada', naoLidas: 0, respondida, card: null,
});

describe('T-191: NovaMensagem', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let config: Record<string, string>;
  let disparos: ReturnType<typeof DISPARO>[];
  let envio: () => Promise<unknown>;

  const envios = () => fetchFalso.mock.calls.filter((c) => c[0] === '/api/whatsapp/send');
  const campoNumero = () => screen.getByLabelText('Número de telefone destinatário');
  const campoMensagem = () => screen.getByLabelText('Mensagem inicial') as HTMLTextAreaElement;
  const botao = () => screen.getByRole('button', { name: 'Enviar Mensagem pelo WhatsApp' }) as HTMLButtonElement;

  beforeEach(() => {
    config = { evolution_auto_msg_em_contato: 'Olá! Aqui é da MedGuia.', evolution_auto_msg_recontato: 'Voltando ao contato.' };
    disparos = [DISPARO(1, true), DISPARO(2, false)];
    envio = () => resposta(200, { ok: true });
    fetchFalso = vi.fn((url: string) => {
      if (url === '/api/whatsapp/config') return resposta(200, { empresaId: 'e', config });
      if (url === '/api/whatsapp/status') return resposta(200, { state: 'open', instance: 'matriz' });
      if (url.startsWith('/api/whatsapp/conversas')) return resposta(200, { conversas: disparos });
      if (url === '/api/whatsapp/send') return envio();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título, o aviso de governança e a volta para a caixa de entrada @spec:AC-510', async () => {
    render(<NovaMensagem />);
    expect(screen.getByRole('heading', { name: 'Nova Mensagem Avulsa (Número Externo)' })).toBeTruthy();
    const aviso = screen.getByRole('region', { name: 'Aviso de governança' });
    expect(within(aviso).getByText(/não geram card no pipeline/)).toBeTruthy();
    expect(within(aviso).getByText(/18 toques/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voltar para Caixa de Entrada/ }).getAttribute('href')).toBe('/whatsapp');
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/whatsapp/nova/page.tsx'))).toBe(true);
    await screen.findByText('matriz');
  });

  test('valida o número, mostra o contador e só habilita enviar com número válido e mensagem @spec:AC-511', async () => {
    const u = userEvent.setup();
    render(<NovaMensagem />);
    expect(botao().disabled).toBe(true);
    await u.type(campoNumero(), '123');
    expect(screen.getByText('Número inválido')).toBeTruthy();
    expect(botao().disabled).toBe(true);
    await u.clear(campoNumero());
    await u.type(campoNumero(), '(11) 98721-4490');
    expect(screen.getByText('Formato WhatsApp válido')).toBeTruthy();
    expect(botao().disabled).toBe(true);
    await u.type(campoMensagem(), 'Olá');
    expect(screen.getByText('3 caracteres')).toBeTruthy();
    expect(botao().disabled).toBe(false);
  });

  test('os modelos são as mensagens configuradas e preenchem a mensagem sem apagar o número; sem modelos, avisa @spec:AC-512', async () => {
    const u = userEvent.setup();
    render(<NovaMensagem />);
    await u.type(campoNumero(), '11987214490');
    await u.click(await screen.findByRole('button', { name: 'Em contato' }));
    expect(campoMensagem().value).toBe('Olá! Aqui é da MedGuia.');
    expect((campoNumero() as HTMLInputElement).value).toBe('11987214490');
    expect(screen.getByRole('button', { name: 'Recontato' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Logins ativados' })).toBeFalsy();
    cleanup();

    config = {};
    render(<NovaMensagem />);
    expect(await screen.findByText(/Nenhum modelo configurado/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Configurar o WhatsApp' })[0].getAttribute('href')).toBe('/whatsapp/configuracao');
  });

  test('enviar manda o número normalizado, mostra "Mensagem enviada" com o atalho e limpa o formulário @spec:AC-513', async () => {
    const u = userEvent.setup();
    render(<NovaMensagem />);
    await u.type(campoNumero(), '(11) 98721-4490');
    await u.type(campoMensagem(), '  Olá, tudo bem?  ');
    await u.click(botao());
    await waitFor(() => expect(envios()).toHaveLength(1));
    expect(JSON.parse(envios()[0][1].body)).toEqual({ numero: '5511987214490', mensagem: 'Olá, tudo bem?' });
    expect(await screen.findByText(/Mensagem enviada/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir conversa' }).getAttribute('href')).toBe('/whatsapp?numero=5511987214490');
    expect((campoNumero() as HTMLInputElement).value).toBe('');
    expect(campoMensagem().value).toBe('');
  });

  test('o envio recusado explica o motivo e mantém o número e a mensagem @spec:AC-514', async () => {
    const u = userEvent.setup();
    render(<NovaMensagem />);
    await u.type(campoNumero(), '11987214490');
    await u.type(campoMensagem(), 'Olá');

    envio = () => resposta(409, { codigo: 'WHATSAPP_NAO_CONFIGURADO' });
    await u.click(botao());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/não está configurado/);
    expect(within(alerta).getByRole('link', { name: 'Configurar o WhatsApp' }).getAttribute('href')).toBe('/whatsapp/configuracao');
    expect(screen.queryByText(/Mensagem enviada/)).toBeFalsy();

    envio = () => resposta(502, { codigo: 'FALHA_ENVIO' });
    await u.click(botao());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Falha no envio/));

    envio = () => Promise.reject(new Error('offline'));
    await u.click(botao());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Não foi possível enviar/));
    expect((campoNumero() as HTMLInputElement).value).toBe('11987214490');
    expect(campoMensagem().value).toBe('Olá');
  });

  test('a pré-visualização mostra o texto e os últimos disparos vêm das conversas avulsas @spec:AC-515', async () => {
    const u = userEvent.setup();
    render(<NovaMensagem />);
    const previa = screen.getByRole('region', { name: 'Pré-visualização no Destinatário' });
    await u.type(campoMensagem(), 'Texto de teste');
    expect(within(previa).getByText('Texto de teste')).toBeTruthy();

    const lista = await screen.findByRole('region', { name: 'Últimos Disparos Avulsos' });
    await within(lista).findByText('Mensagem 1');
    expect(fetchFalso.mock.calls.some((c) => c[0] === '/api/whatsapp/conversas?filtro=avulsas&limite=4')).toBe(true);
    expect(within(lista).getByText('Respondido')).toBeTruthy();
    expect(within(lista).getByText('Aguardando')).toBeTruthy();
    expect(within(lista).getAllByRole('link', { name: 'Abrir Chat' })[0].getAttribute('href')).toBe('/whatsapp?numero=551198888001');
    cleanup();

    disparos = [];
    render(<NovaMensagem />);
    expect(await screen.findByText('Nenhum disparo avulso ainda')).toBeTruthy();
  });

  test('os itens sem backend aparecem "em breve" e a instância é só leitura @spec:AC-516', async () => {
    render(<NovaMensagem />);
    await screen.findByText('matriz');
    for (const rotulo of ['Nome do destinatário', 'Motivo / Categoria', 'Anexo complementar', 'Criar lead se houver resposta', 'Salvar como Rascunho', 'Reenviar']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getByRole('region', { name: 'Parâmetros do Envio' }).querySelector('select')).toBeFalsy();
    // @spec:AC-650: o item genérico "em breve" foi trocado pelo botão de promover em cada disparo avulso
    expect(screen.queryByRole('button', { name: 'Promover a Lead (em breve)' })).toBeNull();
  });

  test('sem disparos mostra o vazio e a falha da lista não derruba a tela @spec:AC-531', async () => {
    fetchFalso.mockImplementation((url: string) =>
      url.startsWith('/api/whatsapp/conversas') ? resposta(500, {}) : url === '/api/whatsapp/status' ? resposta(200, { state: 'open', instance: 'm' }) : resposta(200, { config: {} })
    );
    render(<NovaMensagem />);
    expect(await screen.findByText('Nenhum disparo avulso ainda')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar Mensagem pelo WhatsApp' })).toBeTruthy();
  });
});
