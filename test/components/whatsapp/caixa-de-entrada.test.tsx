// T-190 (fase4-whatsapp, US-124): a caixa de entrada
// (src/components/whatsapp/caixa-de-entrada.tsx) — selo da conexão, abas, busca,
// conversa aberta, envio, marcar como lida, contexto do card e tempo real.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let paramsDaUrl = '';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(paramsDaUrl) }));

import { CaixaDeEntrada } from '../../../src/components/whatsapp/caixa-de-entrada';

type Ouvinte = (evento: unknown) => void;
class FakeEventSource {
  static instancias: FakeEventSource[] = [];
  private ouvintes = new Map<string, Set<Ouvinte>>();
  constructor(public url: string) {
    FakeEventSource.instancias.push(this);
  }
  addEventListener(tipo: string, o: Ouvinte) {
    if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, new Set());
    this.ouvintes.get(tipo)!.add(o);
  }
  removeEventListener(tipo: string, o: Ouvinte) {
    this.ouvintes.get(tipo)?.delete(o);
  }
  close() {}
  disparar(tipo: string, evento: unknown = {}) {
    for (const o of this.ouvintes.get(tipo) ?? []) o(evento);
  }
}

const agoraISO = new Date().toISOString();
const MARCOS = {
  chave: 'lead-1', leadId: 'lead-1', numero: '5511987654321', nome: 'Dr. Marcos Albuquerque', ultimaMensagem: 'Perfeito! Fico no aguardo', ultimaEm: agoraISO,
  ultimaDirecao: 'recebida', naoLidas: 2, respondida: true,
  card: { id: 'op-1', etapaId: 9, valor: '6800.00', responsavel: { id: 'u9', nome: 'Dra. Juliana Rocha' } },
};
const CARLA = {
  chave: 'lead-2', leadId: 'lead-2', numero: '5511911112222', nome: 'Dra. Carla Esteves', ultimaMensagem: 'Confirmado o horário', ultimaEm: agoraISO,
  ultimaDirecao: 'recebida', naoLidas: 1, respondida: true,
  card: { id: 'op-2', etapaId: 7, valor: null, responsavel: null },
};
const AVULSA = {
  chave: '5511988880001', leadId: null, numero: '5511988880001', nome: null, ultimaMensagem: 'Olá avulso', ultimaEm: agoraISO,
  ultimaDirecao: 'enviada', naoLidas: 0, respondida: false, card: null,
};

function resposta(status: number, corpo: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) });
}

describe('T-190: CaixaDeEntrada', () => {
  const fetchOriginal = globalThis.fetch;
  let fetchFalso: ReturnType<typeof vi.fn>;
  let papel: string;
  let statusWhatsapp: { state: string; instance: string | null };
  let conversasStatus: number;
  let vazio: boolean;
  let envioResposta: () => Promise<unknown>;

  const chamadas = (inicio: string, metodo?: string) =>
    fetchFalso.mock.calls.filter((c) => String(c[0]).startsWith(inicio) && (metodo ? c[1]?.method === metodo : true));
  const usuario = () => userEvent.setup();

  beforeEach(() => {
    paramsDaUrl = '';
    FakeEventSource.instancias = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    papel = 'GERENTE';
    statusWhatsapp = { state: 'open', instance: 'matriz' };
    conversasStatus = 200;
    vazio = false;
    envioResposta = () => resposta(200, { ok: true });
    fetchFalso = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (url.startsWith('/api/whatsapp/conversas')) {
        if (conversasStatus !== 200) return resposta(conversasStatus, {});
        const p = new URL(url, 'http://x').searchParams;
        const todas = vazio ? [] : [MARCOS, CARLA, AVULSA];
        let lista = todas;
        if (p.get('filtro') === 'nao_lidas') lista = todas.filter((c) => c.naoLidas > 0);
        if (p.get('filtro') === 'minhas') lista = todas.filter((c) => c.chave === 'lead-2');
        const busca = p.get('busca')?.toLowerCase();
        if (busca) lista = lista.filter((c) => (c.nome ?? '').toLowerCase().includes(busca));
        return resposta(200, {
          conversas: lista,
          contagens: { naoLidas: vazio ? 0 : 2, minhas: vazio ? 0 : 1, todas: todas.length },
          resumo: { ativasHoje: vazio ? 0 : 3, naoLidas: vazio ? 0 : 3, mensagensHoje: { recebidas: 3, enviadas: 1 } },
          indicadores: { tempoPrimeiraRespostaSeg: 160, taxaResposta: 96.2, novasHoje: 2 },
        });
      }
      if (url === '/api/whatsapp/status') return resposta(200, statusWhatsapp);
      if (url === '/api/me') return resposta(200, { papel, isSuperAdmin: false });
      if (url === '/api/pipeline/responsaveis') return resposta(200, { responsaveis: [{ id: 'u9', nome: 'Dra. Juliana Rocha' }] });
      if (url.startsWith('/api/whatsapp/messages')) {
        return resposta(200, {
          mensagens: [
            { id: 'm1', mensagem: 'Boa tarde, doutor!', direcao: 'enviada', created_at: agoraISO, numero: '5511987654321', status: 'entregue' },
            { id: 'm2', mensagem: 'Perfeito! Fico no aguardo', direcao: 'recebida', created_at: agoraISO, numero: '5511987654321', status: 'entregue' },
          ],
        });
      }
      if (url === '/api/whatsapp/lidas' && init?.method === 'POST') return resposta(200, { marcadas: 1 });
      if (url === '/api/whatsapp/send' && init?.method === 'POST') return envioResposta();
      return resposta(404, {});
    });
    globalThis.fetch = fetchFalso as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.fetch = fetchOriginal;
  });

  test('abre com o título e o selo da conexão (conectada, desconectada ou não configurada) @spec:AC-499', async () => {
    render(<CaixaDeEntrada />);
    expect(await screen.findByRole('heading', { name: 'Central de Atendimento WhatsApp' })).toBeTruthy();
    expect(await screen.findByText('Evolution API Conectada (Instância matriz)')).toBeTruthy();
    expect(existsSync(join(__dirname, '..', '..', '..', 'src/app/(app)/whatsapp/page.tsx'))).toBe(true);
    cleanup();

    statusWhatsapp = { state: 'close', instance: 'matriz' };
    render(<CaixaDeEntrada />);
    expect(await screen.findByText('Evolution API desconectada')).toBeTruthy();
    cleanup();

    statusWhatsapp = { state: 'not_configured', instance: null };
    render(<CaixaDeEntrada />);
    expect(await screen.findByText('WhatsApp não configurado')).toBeTruthy();
  });

  test('as abas mostram as contagens e o filtro; a busca restringe; cada linha mostra os dados da conversa @spec:AC-502', async () => {
    const u = usuario();
    render(<CaixaDeEntrada />);
    const lista = await screen.findByRole('region', { name: 'Conversas' });
    await within(lista).findByText('Dr. Marcos Albuquerque');
    expect(within(lista).getByRole('tab', { name: 'Não Lidas (2)' })).toBeTruthy();
    expect(within(lista).getByRole('tab', { name: 'Minhas (1)' })).toBeTruthy();
    expect(within(lista).getByRole('tab', { name: 'Todas (3)' })).toBeTruthy();
    expect(within(lista).getByLabelText('2 não lidas')).toBeTruthy();
    expect(within(lista).getByText('Perfeito! Fico no aguardo')).toBeTruthy();
    expect(within(lista).getByText('No-show')).toBeTruthy();
    expect(within(lista).getByText('+55 (11) 98888-0001')).toBeTruthy();

    await u.click(within(lista).getByRole('tab', { name: /Minhas/ }));
    await waitFor(() => expect(chamadas('/api/whatsapp/conversas?filtro=minhas').length).toBeGreaterThan(0));
    await waitFor(() => expect(within(lista).queryByText('Dr. Marcos Albuquerque')).toBeFalsy());
    expect(within(lista).getByText('Dra. Carla Esteves')).toBeTruthy();

    await u.click(within(lista).getByRole('tab', { name: /Todas/ }));
    await u.type(screen.getByLabelText('Buscar conversas'), 'zzz');
    expect(await within(lista).findByText('Nenhuma conversa encontrada')).toBeTruthy();
    expect(screen.getByLabelText('Atendente')).toBeTruthy();
    cleanup();

    papel = 'ATENDENTE';
    render(<CaixaDeEntrada />);
    await screen.findByText('Central de Atendimento WhatsApp');
    await waitFor(() => expect(chamadas('/api/me').length).toBeGreaterThan(1));
    expect(screen.queryByLabelText('Atendente')).toBeFalsy();
  });

  test('abrir uma conversa mostra o histórico, marca como lida e avisa o menu @spec:AC-503', async () => {
    const aviso = vi.fn();
    window.addEventListener('crm:contadores-mudaram', aviso);
    const u = usuario();
    render(<CaixaDeEntrada />);
    await u.click(await screen.findByRole('button', { name: /Dr\. Marcos Albuquerque/ }));
    const painel = await screen.findByRole('region', { name: 'Conversa aberta' });
    expect(await within(painel).findByText('Boa tarde, doutor!')).toBeTruthy();
    expect(within(painel).getByText('+55 (11) 98765-4321')).toBeTruthy();
    expect(painel.querySelector('[data-direcao="enviada"]')).toBeTruthy();
    expect(painel.querySelector('[data-direcao="recebida"]')).toBeTruthy();
    expect(chamadas('/api/whatsapp/messages?leadId=lead-1').length).toBeGreaterThan(0);
    await waitFor(() => expect(chamadas('/api/whatsapp/lidas', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/whatsapp/lidas', 'POST')[0][1].body)).toEqual({ leadId: 'lead-1' });
    expect(aviso).toHaveBeenCalled();
    window.removeEventListener('crm:contadores-mudaram', aviso);
  });

  test('Enter envia (com leadId ou número), Shift+Enter quebra a linha e o erro mantém o texto @spec:AC-504', async () => {
    const u = usuario();
    render(<CaixaDeEntrada />);
    await u.click(await screen.findByRole('button', { name: /Dr\. Marcos Albuquerque/ }));
    const campo = await screen.findByLabelText('Mensagem');
    const enviar = screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);

    await u.type(campo, 'linha 1{Shift>}{Enter}{/Shift}linha 2');
    expect((campo as HTMLTextAreaElement).value).toBe('linha 1\nlinha 2');
    expect(chamadas('/api/whatsapp/send', 'POST')).toHaveLength(0);

    envioResposta = () => resposta(409, { codigo: 'WHATSAPP_NAO_CONFIGURADO' });
    await u.type(campo, '{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('O WhatsApp da empresa não está configurado.');
    expect((campo as HTMLTextAreaElement).value).toBe('linha 1\nlinha 2');

    envioResposta = () => resposta(200, { ok: true });
    await u.click(enviar);
    await waitFor(() => expect((campo as HTMLTextAreaElement).value).toBe(''));
    expect(JSON.parse(chamadas('/api/whatsapp/send', 'POST')[1][1].body)).toEqual({ mensagem: 'linha 1\nlinha 2', leadId: 'lead-1' });

    // conversa avulsa: vai pelo número
    await u.click(screen.getByRole('button', { name: /\+55 \(11\) 98888-0001/ }));
    await u.type(await screen.findByLabelText('Mensagem'), 'oi{Enter}');
    await waitFor(() => expect(chamadas('/api/whatsapp/send', 'POST')).toHaveLength(3));
    expect(JSON.parse(chamadas('/api/whatsapp/send', 'POST')[2][1].body)).toEqual({ mensagem: 'oi', numero: '5511988880001' });
  });

  test('"Marcar todas como lidas" chama a API com { todas: true } @spec:AC-505', async () => {
    const u = usuario();
    render(<CaixaDeEntrada />);
    await u.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));
    await waitFor(() => expect(chamadas('/api/whatsapp/lidas', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/whatsapp/lidas', 'POST')[0][1].body)).toEqual({ todas: true });
  });

  test('os quatro indicadores: ativas hoje, não lidas, tempo da 1ª resposta e taxa de resposta, calculados no servidor @spec:AC-506', async () => {
    render(<CaixaDeEntrada />);
    await screen.findByText('Conversas ativas hoje');
    expect(screen.getByText('+2 novas')).toBeTruthy();
    expect(screen.getByText('Mensagens não lidas')).toBeTruthy();
    expect(screen.getByText('Aguardando resposta imediata')).toBeTruthy();
    expect(screen.getByText('Tempo 1ª resposta')).toBeTruthy();
    expect(screen.getByText('2m 40s')).toBeTruthy();
    expect(screen.getByText('Taxa de resposta')).toBeTruthy();
    expect(screen.getByText('96,2%')).toBeTruthy();
  });

  test('o contexto mostra o card (valor, responsável, etapa, Abrir card) ou "Sem card no pipeline" @spec:AC-507', async () => {
    const u = usuario();
    render(<CaixaDeEntrada />);
    await u.click(await screen.findByRole('button', { name: /Dr\. Marcos Albuquerque/ }));
    const contexto = await screen.findByRole('region', { name: 'Contexto do Pipeline' });
    expect(within(contexto).getByText(/6\.800/)).toBeTruthy();
    expect(within(contexto).getByText('Dra. Juliana Rocha')).toBeTruthy();
    expect(within(contexto).getByText(/No-show/)).toBeTruthy();
    expect(within(contexto).getByRole('link', { name: 'Abrir card' }).getAttribute('href')).toBe('/pipeline/op-1');
    expect(screen.queryByText(/CNPJ/i)).toBeFalsy();
    expect(within(contexto).getByText('A cadência deste card ainda não foi iniciada.')).toBeTruthy();

    await u.click(screen.getByRole('button', { name: /\+55 \(11\) 98888-0001/ }));
    expect(await screen.findByText('Sem card no pipeline')).toBeTruthy();
  });

  test('a caixa relê ao chegar mensagem recebida e a cada 15 segundos @spec:AC-508', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<CaixaDeEntrada />);
    await screen.findByText('Dr. Marcos Albuquerque');
    const antes = chamadas('/api/whatsapp/conversas').length;
    await act(async () => {
      FakeEventSource.instancias.at(-1)!.disparar('mensagem.recebida', { data: '{}' });
    });
    await waitFor(() => expect(chamadas('/api/whatsapp/conversas').length).toBeGreaterThan(antes));
    const meio = chamadas('/api/whatsapp/conversas').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(chamadas('/api/whatsapp/conversas').length).toBeGreaterThan(meio);
  });

  test('anexo, emoji, microfone e filtro de status aparecem "em breve" e as respostas rápidas são os templates @spec:AC-509', async () => {
    const u = usuario();
    render(<CaixaDeEntrada />);
    await u.click(await screen.findByRole('button', { name: /Dr\. Marcos Albuquerque/ }));
    await screen.findByLabelText('Mensagem');
    for (const rotulo of ['Anexar arquivo', 'Emoji', 'Microfone']) {
      expect(screen.getByRole('button', { name: `${rotulo} (em breve)` }).getAttribute('aria-disabled')).toBe('true');
    }
    expect(screen.getByRole('button', { name: 'Filtrar por status do pipeline (em breve)' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Respostas rápidas:')).toBeTruthy();
  });

  test('carregando mostra esqueleto, sem conversas mostra o vazio e falha mostra erro com "Tentar de novo" @spec:AC-531', async () => {
    render(<CaixaDeEntrada />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    await screen.findByText('Dr. Marcos Albuquerque');
    cleanup();

    vazio = true;
    render(<CaixaDeEntrada />);
    expect(await screen.findByText('Nenhuma conversa ainda')).toBeTruthy();
    cleanup();

    vazio = false;
    conversasStatus = 500;
    render(<CaixaDeEntrada />);
    expect(await screen.findByText(/Não foi possível carregar as conversas/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  });
});
